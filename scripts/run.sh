#!/usr/bin/env bash
# Relance rapide (config.env déjà prêt) — build + run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"

CONTAINER_CMD="$(detect_container_cmd)" || {
  echo "Erreur: Podman ou Docker requis." >&2
  exit 1
}

load_config "$ROOT"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  build_image "$CONTAINER_CMD" "$ROOT"
fi

run_container "$CONTAINER_CMD"
