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

# Normalise un chemin Windows (C:\...) vers Git Bash / Podman (/c/...)
normalize_repo_path() {
  local p="$1"
  p="${p//\\//}"
  if [[ "$p" =~ ^/([A-Za-z])/(.*)$ ]] || [[ "$p" =~ ^/([A-Za-z]):/(.*)$ ]]; then
    local drive
    drive="$(echo "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    p="/${drive}/${BASH_REMATCH[2]}"
  elif [[ "$p" =~ ^([A-Za-z]):/(.*)$ ]]; then
    local drive
    drive="$(echo "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    p="/${drive}/${BASH_REMATCH[2]}"
  fi
  # Supprime un slash final (sauf racine)
  [[ "$p" != "/" ]] && p="${p%/}"
  printf '%s' "$p"
}

# Parse config.env sans interpréter les backslashes Windows ni couper sur les espaces
load_config() {
  local root="$1"
  local config_file="${CONFIG_FILE:-$root/config.env}"
  if [[ ! -f "$config_file" ]]; then
    echo "Erreur: fichier de config introuvable: $config_file" >&2
    echo "Lancez ./init.sh pour le créer depuis config.env.example" >&2
    return 1
  fi

  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue

    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"

    if [[ "$val" == \"*\" && "$val" == *\" ]]; then
      val="${val:1:${#val}-2}"
      val="${val//\\\"/\"}"
      val="${val//\\\\/\\}"
    elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
      val="${val:1:${#val}-2}"
    fi

    export "$key=$val"
  done < "$config_file"

  if [[ -n "${REPO_PATH:-}" ]]; then
    REPO_PATH="$(normalize_repo_path "$REPO_PATH")"
    export REPO_PATH
  fi
}

# Écrit une clé dans config.env (valeur toujours entre guillemets doubles)
set_config_var() {
  local file="$1" key="$2" value="$3"
  local tmp found=0
  tmp="$(mktemp)"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^${key}= ]]; then
      printf '%s="%s"\n' "$key" "$escaped"
      found=1
    else
      printf '%s\n' "$line"
    fi
  done < "$file" > "$tmp"

  if [[ "$found" -eq 0 ]]; then
    printf '%s="%s"\n' "$key" "$escaped" >> "$tmp"
  fi

  mv "$tmp" "$file"
}

validate_repo_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    echo "Erreur: REPO_PATH est vide dans config.env (ligne REPO_PATH=)" >&2
    echo "  Mettez le chemin entre guillemets, ex.:" >&2
    echo '  REPO_PATH="/c/Users/Vous/Mes Projets/mon-repo"' >&2
    return 1
  fi
  if [[ ! -d "$path" ]]; then
    echo "Erreur: REPO_PATH n'existe pas: $path" >&2
    echo "  Sous Git Bash / WSL, préférez: /c/Users/... plutôt que C:\\Users\\..." >&2
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
  local vol_suffix repo_mount
  vol_suffix="$(volume_suffix)"

  local image="${IMAGE_NAME:-localhost/interface-redirects:latest}"
  local port="${PORT:-3100}"

  if [[ -z "${REPO_PATH:-}" ]]; then
    echo "Erreur: REPO_PATH requis dans config.env" >&2
    return 1
  fi

  validate_repo_path "$REPO_PATH" || return 1

  if port_in_use "$port"; then
    print_port_help "$port"
    return 1
  fi

  repo_mount="$REPO_PATH"

  echo "→ Démarrage sur http://localhost:$port"
  echo "  Repo monté : $repo_mount → /workspace/repo"
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
    -v "${repo_mount}:/workspace/repo${vol_suffix}" \
    "$image"
}
