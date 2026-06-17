#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-localhost/asciline-remix-dev:latest}"

source "$ROOT/scripts/podman_env.sh"

cd "$ROOT"
ensure_podman_ready

if ! podman image exists "$IMAGE"; then
  "$ROOT/scripts/podman_build.sh"
fi

if [ "$#" -eq 0 ]; then
  set -- bash
fi

RUN_ARGS=(--rm)
if [ -t 0 ] && [ -t 1 ]; then
  RUN_ARGS+=(-it)
elif [ -t 0 ]; then
  RUN_ARGS+=(-i)
fi

podman run "${RUN_ARGS[@]}" \
  -v "$ROOT:/workspace" \
  -w /workspace \
  -p "${PORT:-8000}:${PORT:-8000}" \
  -e PYTHONUNBUFFERED=1 \
  "$IMAGE" \
  bash -lc '
    if [ -x .venv-linux/bin/python ]; then
      . .venv-linux/bin/activate
    else
      . /opt/venv/bin/activate
    fi
    exec "$@"
  ' _ "$@"
