#!/usr/bin/env bash
# Point d'entrée plug-and-play : clone → ./init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$ROOT/config.env"
EXAMPLE="$ROOT/config.env.example"

# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"

echo "=== Assistant Redirections Apache / AzDO ==="
echo ""

CONTAINER_CMD="$(detect_container_cmd)" || {
  echo "Erreur: Podman (ou Docker) est requis." >&2
  echo "  macOS : https://podman.io/getting-started/installation" >&2
  echo "  Linux : sudo apt install podman  (ou équivalent)" >&2
  exit 1
}
echo "✓ $CONTAINER_CMD détecté"

# --- Première configuration ---
if [[ ! -f "$CONFIG" ]]; then
  if [[ ! -f "$EXAMPLE" ]]; then
    echo "Erreur: config.env.example introuvable." >&2
    exit 1
  fi
  cp "$EXAMPLE" "$CONFIG"
  echo "✓ config.env créé depuis config.env.example"
fi

load_config "$ROOT"

# REPO_PATH interactif si vide
if [[ -z "${REPO_PATH:-}" ]]; then
  echo ""
  echo "REPO_PATH n'est pas défini — chemin vers votre clone local AzDO."
  read -r -p "Chemin absolu du clone : " REPO_PATH
  REPO_PATH="${REPO_PATH/#\~/$HOME}"
  if [[ ! -d "$REPO_PATH" ]]; then
    echo "Erreur: chemin introuvable: $REPO_PATH" >&2
    exit 1
  fi
  # Persiste dans config.env
  if grep -q '^REPO_PATH=' "$CONFIG"; then
    sed -i.bak "s|^REPO_PATH=.*|REPO_PATH=$REPO_PATH|" "$CONFIG" && rm -f "$CONFIG.bak"
  else
    echo "REPO_PATH=$REPO_PATH" >> "$CONFIG"
  fi
  echo "✓ REPO_PATH enregistré dans config.env"
  load_config "$ROOT"
fi

validate_repo_path "$REPO_PATH" || exit 1
echo "✓ Repo git : $REPO_PATH"

# --- Build (skip si SKIP_BUILD=1) ---
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  build_image "$CONTAINER_CMD" "$ROOT"
else
  echo "→ Build ignoré (SKIP_BUILD=1)"
fi

# --- Run ---
run_container "$CONTAINER_CMD"
