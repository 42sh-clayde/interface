#!/usr/bin/env bash
# Démarre le conteneur sans rebuild
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"

CONTAINER_CMD="$(detect_container_cmd)" || exit 1
load_config "$ROOT"
run_container "$CONTAINER_CMD"
