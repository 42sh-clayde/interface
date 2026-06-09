#!/usr/bin/env bash
# Build l'image uniquement
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"

CONTAINER_CMD="$(detect_container_cmd)" || exit 1
load_config "$ROOT" 2>/dev/null || true
build_image "$CONTAINER_CMD" "$ROOT"
