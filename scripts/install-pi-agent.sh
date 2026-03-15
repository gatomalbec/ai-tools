#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
CONFIG_FILE="${PI_AGENT_CONFIG:-$REPO_ROOT/.pi-agent-selection.mk}"
SKILLS_SRC="$REPO_ROOT/skills/pi-skills"
EXT_SRC="$REPO_ROOT/extensions"
SAFE_PI_BIN_DIR="${SAFE_PI_BIN_DIR:-$HOME/.local/bin}"

# Safety flags (all default to false)
PRUNE_UNSELECTED="${PI_AGENT_PRUNE_UNSELECTED:-false}"
REPLACE_TOP_LEVEL_LINKS="${PI_AGENT_REPLACE_TOP_LEVEL_LINKS:-false}"
OVERWRITE_FOREIGN_LINKS="${PI_AGENT_OVERWRITE_FOREIGN_LINKS:-false}"

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

contains_item() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "Missing skills source dir: $SKILLS_SRC" >&2
  exit 1
fi
if [[ ! -d "$EXT_SRC" ]]; then
  echo "Missing extensions source dir: $EXT_SRC" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required for install, but was not found in PATH." >&2
  exit 1
fi

AVAILABLE_SKILLS=()
while IFS= read -r d; do AVAILABLE_SKILLS+=("$(basename "$d")"); done < <(find "$SKILLS_SRC" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) | sort)
AVAILABLE_EXT=()
while IFS= read -r d; do AVAILABLE_EXT+=("$(basename "$d")"); done < <(find "$EXT_SRC" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) | sort)

ENABLED_SKILLS="all"
ENABLED_EXTENSIONS="all"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

choose_items() {
  local mode="$1"; shift
  local requested="$1"; shift
  local -a available=("$@")

  if [[ "$requested" == "all" ]]; then
    printf '%s\n' "${available[@]}"
    return
  fi

  local -a out=()
  local normalized="${requested//,/ }"
  local item
  for item in $normalized; do
    local found=0
    local a
    for a in "${available[@]}"; do
      if [[ "$a" == "$item" ]]; then
        found=1
        out+=("$item")
        break
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "Unknown $mode item in config: $item" >&2
      exit 1
    fi
  done

  if [[ "${#out[@]}" -eq 0 ]]; then
    echo "No $mode selected. Use 'all' or provide at least one name." >&2
    exit 1
  fi

  printf '%s\n' "${out[@]}"
}

SELECTED_SKILLS=()
while IFS= read -r item; do
  [[ -n "$item" ]] && SELECTED_SKILLS+=("$item")
done < <(choose_items "skill" "$ENABLED_SKILLS" "${AVAILABLE_SKILLS[@]}")

SELECTED_EXT=()
while IFS= read -r item; do
  [[ -n "$item" ]] && SELECTED_EXT+=("$item")
done < <(choose_items "extension" "$ENABLED_EXTENSIONS" "${AVAILABLE_EXT[@]}")

ensure_container_dir() {
  local dir="$1"
  if [[ -L "$dir" ]]; then
    local target
    target="$(readlink "$dir" || true)"
    if is_true "$REPLACE_TOP_LEVEL_LINKS"; then
      echo "Replacing top-level symlink: $dir -> $target"
      rm -f "$dir"
      mkdir -p "$dir"
    else
      echo "Refusing to replace top-level symlink: $dir -> $target" >&2
      echo "Set PI_AGENT_REPLACE_TOP_LEVEL_LINKS=true to allow this migration." >&2
      exit 1
    fi
  elif [[ -e "$dir" && ! -d "$dir" ]]; then
    echo "Refusing to overwrite non-directory path: $dir" >&2
    exit 1
  else
    mkdir -p "$dir"
  fi
}

prune_repo_symlinks() {
  local dir="$1"
  shift
  local -a selected=("$@")

  if ! is_true "$PRUNE_UNSELECTED"; then
    return
  fi

  if [[ ! -d "$dir" ]]; then
    return
  fi

  local link
  while IFS= read -r link; do
    local name target
    name="$(basename "$link")"
    target="$(readlink "$link" || true)"
    if [[ "$target" == "$REPO_ROOT"/* ]] && ! contains_item "$name" "${selected[@]}"; then
      rm -f "$link"
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type l)
}

link_selected() {
  local src_root="$1"
  local dst_root="$2"
  shift 2
  local -a items=("$@")

  local item
  for item in "${items[@]}"; do
    local src="$src_root/$item"
    local dst="$dst_root/$item"

    if [[ -e "$dst" && ! -L "$dst" ]]; then
      echo "Refusing to overwrite non-symlink path: $dst" >&2
      echo "Move/remove it first, then retry." >&2
      exit 1
    fi

    if [[ -L "$dst" ]]; then
      local current
      current="$(readlink "$dst" || true)"
      if [[ "$current" == "$src" ]]; then
        : # already correct
      elif [[ "$current" == "$REPO_ROOT"/* ]]; then
        ln -sfn "$src" "$dst"
      elif is_true "$OVERWRITE_FOREIGN_LINKS"; then
        ln -sfn "$src" "$dst"
      else
        echo "Refusing to replace non-repo symlink: $dst -> $current" >&2
        echo "Set PI_AGENT_OVERWRITE_FOREIGN_LINKS=true to allow replacing it." >&2
        exit 1
      fi
    else
      ln -s "$src" "$dst"
    fi

    if [[ -f "$src/package.json" ]]; then
      echo "Installing npm deps in $src"
      if [[ -f "$src/package-lock.json" ]]; then
        (cd "$src" && npm ci --no-audit --no-fund)
      else
        (cd "$src" && npm install --no-audit --no-fund)
      fi
    fi
  done
}

install_safe_pi_command() {
  local src="$REPO_ROOT/scripts/safe-pi"
  local dst_dir="$SAFE_PI_BIN_DIR"
  local dst="$dst_dir/safe-pi"

  mkdir -p "$dst_dir"
  ln -sfn "$src" "$dst"

  if [[ ":$PATH:" != *":$dst_dir:"* ]]; then
    echo "Installed safe-pi at: $dst"
    echo "NOTE: $dst_dir is not currently in PATH. Add it to use 'safe-pi' anywhere."
  else
    echo "Installed safe-pi command at: $dst"
  fi
}

ensure_container_dir "$PI_AGENT_DIR/skills"
ensure_container_dir "$PI_AGENT_DIR/extensions"

prune_repo_symlinks "$PI_AGENT_DIR/skills" "${SELECTED_SKILLS[@]}"
prune_repo_symlinks "$PI_AGENT_DIR/extensions" "${SELECTED_EXT[@]}"

link_selected "$SKILLS_SRC" "$PI_AGENT_DIR/skills" "${SELECTED_SKILLS[@]}"
link_selected "$EXT_SRC" "$PI_AGENT_DIR/extensions" "${SELECTED_EXT[@]}"
install_safe_pi_command

echo "Install complete."
echo "Skills enabled: ${SELECTED_SKILLS[*]}"
echo "Extensions enabled: ${SELECTED_EXT[*]}"
echo "PRUNE_UNSELECTED=$PRUNE_UNSELECTED"
