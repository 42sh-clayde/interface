#!/usr/bin/env bash
# Fonctions partagées — source depuis init.sh / scripts/run.sh

set -euo pipefail

detect_container_cmd() {
  if command -v podman >/dev/null 2>&1; then
    echo podman
  elif command -v docker >/dev/null 2>&1; then
    echo docker
  else
    return 1
  fi
}

volume_suffix() {
  if [[ "$(uname -s)" == "Linux" ]]; then
    echo ":Z"
  else
    echo ""
  fi
}

load_config() {
  local root="$1"
  local config_file="${CONFIG_FILE:-$root/config.env}"
  if [[ ! -f "$config_file" ]]; then
    echo "Erreur: fichier de config introuvable: $config_file" >&2
    echo "Lancez ./init.sh pour le créer depuis config.env.example" >&2
    return 1
  fi
  # shellcheck disable=SC1090
  set -a
  source "$config_file"
  set +a
}

validate_repo_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    echo "Erreur: REPO_PATH est vide dans config.env" >&2
    return 1
  fi
  if [[ ! -d "$path" ]]; then
    echo "Erreur: REPO_PATH n'existe pas: $path" >&2
    return 1
  fi
  if [[ ! -d "$path/.git" ]]; then
    echo "Erreur: REPO_PATH n'est pas un dépôt git (pas de .git): $path" >&2
    return 1
  fi
  return 0
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$port" >/dev/null 2>&1
    return
  fi
  return 1
}

print_port_help() {
  local port="$1"
  echo "Erreur: le port $port est déjà utilisé." >&2
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null >&2 || true
  fi
  echo "  → Changer PORT dans config.env ou arrêter l'instance existante." >&2
}

build_image() {
  local cmd="$1"
  local root="$2"
  local image="${IMAGE_NAME:-localhost/interface-redirects:latest}"
  echo "→ Construction de l'image $image ..."
  "$cmd" build -t "$image" -f "$root/Containerfile" "$root"
}

run_container() {
  local cmd="$1"
  local vol_suffix
  vol_suffix="$(volume_suffix)"

  local image="${IMAGE_NAME:-localhost/interface-redirects:latest}"
  local port="${PORT:-3100}"

  validate_repo_path "${REPO_PATH:?REPO_PATH requis dans config.env}"

  if port_in_use "$port"; then
    print_port_help "$port"
    return 1
  fi

  echo "→ Démarrage sur http://localhost:$port"
  echo "  Repo monté : $REPO_PATH → /workspace/repo"
  echo "  Ctrl+C pour arrêter"
  echo ""

  "$cmd" run --rm -p "${port}:${port}" \
    -e PORT="$port" \
    -e AZDO_ORG="${AZDO_ORG:?AZDO_ORG requis}" \
    -e AZDO_PROJECT="${AZDO_PROJECT:?AZDO_PROJECT requis}" \
    -e AZDO_REPO="${AZDO_REPO:?AZDO_REPO requis}" \
    -e DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}" \
    -e TARGET_FOLDER="${TARGET_FOLDER:-config/apache/redirects}" \
    -e REPO_MOUNT_PATH=/workspace/repo \
    -v "${REPO_PATH}:/workspace/repo${vol_suffix}" \
    "$image"
}
