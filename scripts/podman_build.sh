#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-localhost/asciline-remix-dev:latest}"
NODE_MAJOR="${NODE_MAJOR:-24}"

source "$ROOT/scripts/podman_env.sh"

cd "$ROOT"
ensure_podman_ready
podman build --build-arg "NODE_MAJOR=$NODE_MAJOR" -t "$IMAGE" -f Containerfile .
echo "built $IMAGE with Node $NODE_MAJOR"
