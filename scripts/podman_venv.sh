#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-localhost/asciline-remix-dev:latest}"
VENV="${VENV:-.venv-linux}"

source "$ROOT/scripts/podman_env.sh"

cd "$ROOT"
ensure_podman_ready

if ! podman image exists "$IMAGE"; then
  "$ROOT/scripts/podman_build.sh"
fi

podman run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  -e VENV="$VENV" \
  "$IMAGE" \
  bash -lc 'python -m venv "$VENV" \
    && "$VENV/bin/python" -m pip install --upgrade pip \
    && "$VENV/bin/python" -m pip install -r requirements.txt \
    && "$VENV/bin/python" -m pip check'

echo "created container-local venv at $VENV"
echo "Use it via: scripts/podman_run.sh '$VENV/bin/python' ..."
