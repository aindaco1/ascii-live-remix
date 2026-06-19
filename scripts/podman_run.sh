#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-localhost/asciline-remix-dev:latest}"
ASCILINE_RESTART="${ASCILINE_RESTART:-${RESTART:-0}}"
ASCILINE_RESTART_DELAY="${ASCILINE_RESTART_DELAY:-${RESTART_DELAY:-2}}"
ASCILINE_RESTART_ON_SUCCESS="${ASCILINE_RESTART_ON_SUCCESS:-${RESTART_ON_SUCCESS:-0}}"
CONTAINER_NAME="${CONTAINER_NAME:-asciline-remix-run-$$}"
PORT="${PORT:-8000}"
HOST_PORT="${HOST_PORT:-$PORT}"
CONTAINER_PORT="${CONTAINER_PORT:-$PORT}"
ASCILINE_PORT_CHECK="${ASCILINE_PORT_CHECK:-1}"

source "$ROOT/scripts/podman_env.sh"

cd "$ROOT"

if [ "$#" -eq 0 ]; then
  set -- bash
fi
COMMAND=("$@")

restart_requested() {
  case "$ASCILINE_RESTART" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

port_check_requested() {
  case "$ASCILINE_PORT_CHECK" in
    0|false|FALSE|no|NO|off|OFF) return 1 ;;
    *) return 0 ;;
  esac
}

ensure_host_port_available() {
  if ! port_check_requested; then
    return 0
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  listeners="$(lsof -nP -iTCP:"$HOST_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$listeners" ]; then
    printf 'podman: host port %s is already in use; stop that process/container or set HOST_PORT to another port.\n' "$HOST_PORT" >&2
    printf '%s\n' "$listeners" >&2
    exit 1
  fi
}

ensure_host_port_available
ensure_podman_ready

if ! podman image exists "$IMAGE"; then
  "$ROOT/scripts/podman_build.sh"
fi

RUN_ARGS=(--rm)
if restart_requested; then
  :
elif [ -t 0 ] && [ -t 1 ]; then
  RUN_ARGS+=(-it)
elif [ -t 0 ]; then
  RUN_ARGS+=(-i)
fi

stop_podman_container() {
  podman stop -t 2 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [ -n "${podman_pid:-}" ]; then
    wait "$podman_pid" 2>/dev/null || true
  fi
}

trap 'stop_podman_container; exit 130' INT TERM

restart_on_success_requested() {
  case "$ASCILINE_RESTART_ON_SUCCESS" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

run_podman_container() {
  podman run "${RUN_ARGS[@]}" \
    --name "$CONTAINER_NAME" \
    -v "$ROOT:/workspace" \
    -w /workspace \
    -p "$HOST_PORT:$CONTAINER_PORT" \
    -e PYTHONUNBUFFERED=1 \
    -e "ASCILINE_RESTART=$ASCILINE_RESTART" \
    -e "ASCILINE_RESTART_DELAY=$ASCILINE_RESTART_DELAY" \
    -e "ASCILINE_RESTART_ON_SUCCESS=$ASCILINE_RESTART_ON_SUCCESS" \
    "$IMAGE" \
    bash -lc '
    if [ -x .venv-linux/bin/python ]; then
      . .venv-linux/bin/activate
    else
      . /opt/venv/bin/activate
    fi

    restart_requested() {
      case "${ASCILINE_RESTART:-0}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
      esac
    }

    restart_on_success_requested() {
      case "${ASCILINE_RESTART_ON_SUCCESS:-0}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
      esac
    }

    if ! restart_requested; then
      exec "$@"
    fi

    delay="${ASCILINE_RESTART_DELAY:-2}"
    case "$delay" in
      ""|*[!0-9.]*)
        delay=2
        ;;
    esac

    printf "podman: supervisor enabled; stop this wrapper to stop restarting the command.\n" >&2
    child_pid=""
    stop_supervisor() {
      trap - INT TERM
      if [ -n "$child_pid" ]; then
        kill -TERM "$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
      fi
      exit 0
    }
    trap stop_supervisor INT TERM

    while true; do
      "$@" &
      child_pid=$!
      wait "$child_pid"
      status=$?
      child_pid=""
      if [ "$status" -eq 0 ] && ! restart_on_success_requested; then
        exit 0
      fi
      printf "podman: command exited with status %s; restarting in %ss\n" "$status" "$delay" >&2
      sleep "$delay"
    done
  ' _ "$@"
}

while true; do
  set +e
  run_podman_container "${COMMAND[@]}" &
  podman_pid=$!
  wait "$podman_pid"
  status=$?
  podman_pid=""
  set -e

  if ! restart_requested; then
    break
  fi

  if [ "$status" -eq 0 ] && ! restart_on_success_requested; then
    break
  fi

  printf "podman: container runner exited with status %s; checking Podman before restart.\n" "$status" >&2
  ensure_podman_ready
  podman rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  printf "podman: restarting container in %ss\n" "$ASCILINE_RESTART_DELAY" >&2
  sleep "$ASCILINE_RESTART_DELAY"
done

trap - INT TERM
exit "$status"
