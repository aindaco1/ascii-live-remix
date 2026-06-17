#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/scripts/podman_run.sh" bash -c '
  set -euo pipefail
  bash experiments/make_test_clips.sh
  python experiments/gen_vectors.py
  node experiments/check_vectors.js
'
