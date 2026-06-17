#!/usr/bin/env bash

prefer_podman_path() {
  local candidate=""
  for candidate in \
    "/opt/podman/bin" \
    "/usr/local/podman/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin"
  do
    if [ -x "$candidate/podman" ]; then
      export PATH="$candidate:$PATH"
      return 0
    fi
  done
  return 1
}

detect_os_family() {
  case "$(uname -s)" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      echo "linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

detect_podman_socket() {
  podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' podman-machine-default 2>/dev/null || true
}

configure_podman_connection() {
  local socket_path="${1:-}"

  if [ -z "$socket_path" ]; then
    socket_path="$(detect_podman_socket)"
  fi

  if [ -n "$socket_path" ]; then
    unset CONTAINER_CONNECTION
    export CONTAINER_HOST="unix://${socket_path}"
  fi
}

podman_machine_log_path() {
  local socket_path=""
  socket_path="$(detect_podman_socket)"
  if [ -n "$socket_path" ]; then
    echo "$(dirname "$socket_path")/podman-machine-default.log"
  fi
}

podman_env_fail() {
  printf 'podman: %s\n' "$1" >&2
  exit 1
}

podman_env_warn() {
  printf 'podman: %s\n' "$1" >&2
}

ensure_podman_ready() {
  local run_smoke="${1:-false}"
  local os_family=""
  local machine_state=""
  local log_path=""
  local rootless=""

  prefer_podman_path || true

  if ! command -v podman >/dev/null 2>&1; then
    podman_env_fail "Podman is not on PATH. Install Podman, then retry."
  fi

  os_family="$(detect_os_family)"

  if ! podman --version >/dev/null 2>&1; then
    podman_env_fail "Podman CLI is installed but not responding."
  fi

  if [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; then
    if ! podman machine inspect >/dev/null 2>&1; then
      podman_env_fail "No Podman machine found. Run: podman machine init --now"
    fi

    machine_state="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
    if [ "$machine_state" != "running" ]; then
      podman_env_warn "Podman machine is not running; starting podman-machine-default."
      podman machine start podman-machine-default >/tmp/asciline-remix-podman-start.log 2>&1 || true
      machine_state="$(podman machine inspect --format '{{.State}}' podman-machine-default 2>/dev/null || true)"
      if [ "$machine_state" != "running" ]; then
        log_path="$(podman_machine_log_path)"
        [ -f /tmp/asciline-remix-podman-start.log ] && printf 'podman: start log: /tmp/asciline-remix-podman-start.log\n' >&2
        [ -n "$log_path" ] && [ -f "$log_path" ] && printf 'podman: machine log: %s\n' "$log_path" >&2
        podman_env_fail "Podman machine did not stay running after startup."
      fi
    fi

    configure_podman_connection
  fi

  if ! podman info >/dev/null 2>&1; then
    if [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; then
      podman_env_warn "Podman API is stale; restarting podman-machine-default once."
      podman machine stop podman-machine-default >/tmp/asciline-remix-podman-stop.log 2>&1 || true
      podman machine start podman-machine-default >/tmp/asciline-remix-podman-start.log 2>&1 || true
      configure_podman_connection
    fi
  fi

  if ! podman info >/dev/null 2>&1; then
    podman_env_fail "Podman engine is not reachable. Try: podman machine stop && podman machine start"
  fi

  if [ "$os_family" = "macos" ] || [ "$os_family" = "windows" ]; then
    for _ in 1 2 3; do
      configure_podman_connection
      if ! podman info >/dev/null 2>&1; then
        log_path="$(podman_machine_log_path)"
        [ -n "$log_path" ] && [ -f "$log_path" ] && printf 'podman: machine log: %s\n' "$log_path" >&2
        podman_env_fail "Podman machine is not staying reachable after startup."
      fi
      sleep 1
    done
  fi

  rootless="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo false)"
  if [ "$rootless" != "true" ]; then
    podman_env_fail "Podman is not running rootless. This repo expects a rootless local setup."
  fi

  if [ "$run_smoke" = "true" ]; then
    if ! podman run --rm docker.io/library/alpine:3.20 echo ok >/tmp/asciline-remix-podman-alpine.log 2>&1; then
      cat /tmp/asciline-remix-podman-alpine.log >&2 || true
      podman_env_fail "Podman could not run a simple container."
    fi
  fi
}
