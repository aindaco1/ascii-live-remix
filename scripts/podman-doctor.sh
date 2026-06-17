#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/podman_env.sh"

echo "Podman doctor"
echo "OS family: $(detect_os_family)"
echo ""

ensure_podman_ready true

echo "ok: Podman CLI, machine, engine, rootless mode, and container execution are ready."
echo ""
echo "Next:"
echo "  scripts/podman_build.sh"
echo "  scripts/podman_venv.sh"
echo "  scripts/podman_codec_tests.sh"
