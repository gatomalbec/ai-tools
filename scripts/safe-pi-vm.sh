#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${SAFE_PI_VM_INSTANCE:-${PI_AGENT_VM_INSTANCE:-safe-pi}}"
PROJECT_DIR="${SAFE_PI_VM_PROJECT_DIR:-${PI_AGENT_VM_PROJECT_DIR:-$(pwd -P)}}"
HOST_PI_DIR="${SAFE_PI_VM_PI_DIR:-${PI_AGENT_VM_PI_DIR:-$HOME/.pi}}"
TEMPLATE_URL="${SAFE_PI_VM_TEMPLATE_URL:-${PI_AGENT_VM_TEMPLATE_URL:-https://raw.githubusercontent.com/nixos-lima/nixos-lima/master/nixos.yaml}}"

VM_CPUS="${SAFE_PI_VM_CPUS:-${PI_AGENT_VM_CPUS:-4}}"
VM_MEMORY_GIB="${SAFE_PI_VM_MEMORY_GIB:-${PI_AGENT_VM_MEMORY_GIB:-8}}"
VM_DISK_GIB="${SAFE_PI_VM_DISK_GIB:-${PI_AGENT_VM_DISK_GIB:-40}}"

VM_WORKSPACE="/workspace"

PI_BIN="${SAFE_PI_BIN:-${PI_AGENT_BIN:-pi}}"
NIX_FALLBACK_APP="${SAFE_PI_NIX_FALLBACK_APP:-${PI_AGENT_NIX_FALLBACK_APP:-nixpkgs#nodejs}}"
NPM_PACKAGE="${SAFE_PI_NPM_PACKAGE:-${PI_AGENT_NPM_PACKAGE:-@mariozechner/pi-coding-agent}}"

usage() {
  cat <<EOF
Usage:
  $0 up
  $0 shell
  $0 run [pi args...]
  $0 stop
  $0 destroy
  $0 status

Environment overrides (preferred):
  SAFE_PI_VM_INSTANCE         Instance name (default: safe-pi)
  SAFE_PI_VM_PROJECT_DIR      Host project path to mount at /workspace (default: cwd)
  SAFE_PI_VM_PI_DIR           Host ~/.pi path to mount at /home/agent/.pi (default: ~/.pi)
  SAFE_PI_VM_TEMPLATE_URL     Lima template URL (default: https://raw.githubusercontent.com/nixos-lima/nixos-lima/master/nixos.yaml)
  SAFE_PI_VM_CPUS             vCPU count on first create (default: 4)
  SAFE_PI_VM_MEMORY_GIB       RAM GiB on first create (default: 8)
  SAFE_PI_VM_DISK_GIB         Disk GiB on first create (default: 40)
  SAFE_PI_BIN                 Agent command binary inside VM (default: pi)
  SAFE_PI_NIX_FALLBACK_APP    nix app providing node+npx fallback (default: nixpkgs#nodejs)
  SAFE_PI_NPM_PACKAGE         npm package used when SAFE_PI_BIN is missing (default: @mariozechner/pi-coding-agent)

Legacy aliases still supported:
  PI_AGENT_VM_*, PI_AGENT_BIN, PI_AGENT_NIX_FALLBACK_APP, PI_AGENT_NPM_PACKAGE
EOF
}

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

ensure_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This workflow supports macOS hosts only." >&2
    exit 1
  fi
}

ensure_basic_prereqs() {
  ensure_macos
  need_cmd limactl
}

ensure_mount_prereqs() {
  ensure_basic_prereqs

  if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "Project directory does not exist: $PROJECT_DIR" >&2
    exit 1
  fi

  mkdir -p "$HOST_PI_DIR"
}

lima_instance_exists() {
  local lima_home
  lima_home="${LIMA_HOME:-$HOME/.lima}"
  [[ -d "$lima_home/$INSTANCE_NAME" ]]
}

lima_instance_running() {
  # Use a cheap no-op shell probe. If this succeeds, the instance is already up.
  limactl shell "$INSTANCE_NAME" -- true >/dev/null 2>&1
}

start_instance() {
  ensure_mount_prereqs

  if lima_instance_exists; then
    if lima_instance_running; then
      echo "Instance already running: $INSTANCE_NAME"
      return
    fi

    echo "Starting existing instance: $INSTANCE_NAME"
    limactl start --yes "$INSTANCE_NAME"
    return
  fi

  echo "Creating and starting instance: $INSTANCE_NAME"
  limactl start --yes \
    --name "$INSTANCE_NAME" \
    --cpus "$VM_CPUS" \
    --memory "$VM_MEMORY_GIB" \
    --disk "$VM_DISK_GIB" \
    --mount "$PROJECT_DIR:w" \
    --mount "$HOST_PI_DIR:w" \
    --set '.mounts[2].mountPoint = "/workspace"' \
    --set '.mounts[3].mountPoint = "/home/agent/.pi"' \
    --set '.user.name = "agent"' \
    --set '.user.home = "/home/agent"' \
    --set '.user.shell = "/run/current-system/sw/bin/bash"' \
    "$TEMPLATE_URL"
}

build_workspace_remote_prelude() {
  local workspace_q legacy_project_q legacy_pi_q instance_q
  printf -v workspace_q '%q' "$VM_WORKSPACE"
  printf -v legacy_project_q '%q' "$PROJECT_DIR"
  printf -v legacy_pi_q '%q' "$HOST_PI_DIR"
  printf -v instance_q '%q' "$INSTANCE_NAME"

  cat <<EOF
workspace_candidate=$workspace_q
legacy_project_candidate=$legacy_project_q
legacy_pi_candidate=$legacy_pi_q
export PI_SAFE_VM=1
export PI_SAFE_VM_INSTANCE=$instance_q

if [[ -d "\$workspace_candidate" ]]; then
  WORKSPACE="\$workspace_candidate"
elif [[ -d "\$legacy_project_candidate" ]]; then
  WORKSPACE="\$legacy_project_candidate"
else
  echo "safe-pi VM error: project mount not found inside VM." >&2
  echo "Expected either \$workspace_candidate (new mountpoint) or \$legacy_project_candidate (legacy mountpoint)." >&2
  echo "Hint: recreate instance '$INSTANCE_NAME' (destroy + run again)." >&2
  exit 1
fi

# Legacy instances may mount host ~/.pi at the host absolute path (e.g. /Users/<user>/.pi)
# instead of HOME/.pi. Prefer that shared config if present.
if [[ -d "\$legacy_pi_candidate/agent" ]]; then
  export PI_CODING_AGENT_DIR="\$legacy_pi_candidate/agent"
fi

cd "\$WORKSPACE"
EOF
}

build_agent_remote_cmd() {
  local agent_bin_q fallback_app_q npm_package_q args_q arg q
  printf -v agent_bin_q '%q' "$PI_BIN"
  printf -v fallback_app_q '%q' "$NIX_FALLBACK_APP"
  printf -v npm_package_q '%q' "$NPM_PACKAGE"
  args_q=""

  for arg in "$@"; do
    printf -v q '%q' "$arg"
    args_q+=" $q"
  done

  cat <<EOF
$(build_workspace_remote_prelude)

agent_bin=$agent_bin_q
fallback_app=$fallback_app_q
npm_package=$npm_package_q

if [[ -f "\$WORKSPACE/flake.nix" ]] && command -v nix >/dev/null 2>&1; then
  exec nix develop "\$WORKSPACE" --command "\$agent_bin"$args_q
fi

if command -v "\$agent_bin" >/dev/null 2>&1; then
  exec "\$agent_bin"$args_q
fi

if command -v npx >/dev/null 2>&1; then
  exec npx -y "\$npm_package"$args_q
fi

if command -v nix >/dev/null 2>&1; then
  exec nix shell "\$fallback_app" --command npx -y "\$npm_package"$args_q
fi

echo "safe-pi VM error: '\$agent_bin' not found; npx missing; nix fallback unavailable." >&2
exit 127
EOF
}

restore_host_tty() {
  local tty_state="${1:-}"

  if [[ -z "$tty_state" ]]; then
    return
  fi

  # Restore line discipline and turn off common terminal private modes that
  # TUIs can leave enabled when the VM connection drops abruptly.
  stty "$tty_state" < /dev/tty > /dev/tty 2>/dev/null \
    || stty sane < /dev/tty > /dev/tty 2>/dev/null \
    || true
  printf '\033[0m\033[?25h\033[?1000l\033[?1002l\033[?1003l\033[?1005l\033[?1006l\033[?1015l\033[?2004l\033[>4;0m' > /dev/tty 2>/dev/null || true
}

run_with_tty_guard() {
  local tty_state=""
  local rc=0

  if [[ -t 0 ]] && [[ -t 1 ]] && command -v stty >/dev/null 2>&1; then
    tty_state="$(stty -g < /dev/tty 2>/dev/null || true)"
  fi

  if ! "$@"; then
    rc=$?
  fi

  restore_host_tty "$tty_state"
  return "$rc"
}

run_vm_shell() {
  start_instance

  local remote_cmd
  remote_cmd="$(build_workspace_remote_prelude)"
  remote_cmd+=$'\nexec bash -l'

  run_with_tty_guard limactl shell "$INSTANCE_NAME" -- bash -lc "$remote_cmd"
}

run_agent() {
  start_instance

  local remote_cmd
  remote_cmd="$(build_agent_remote_cmd "$@")"

  run_with_tty_guard limactl shell "$INSTANCE_NAME" -- bash -lc "$remote_cmd"
}

stop_instance() {
  ensure_basic_prereqs
  limactl stop "$INSTANCE_NAME" >/dev/null 2>&1 || true
  echo "Stopped (if running): $INSTANCE_NAME"
}

destroy_instance() {
  ensure_basic_prereqs
  limactl stop "$INSTANCE_NAME" >/dev/null 2>&1 || true
  limactl delete -f "$INSTANCE_NAME" >/dev/null 2>&1 || true
  echo "Destroyed (if present): $INSTANCE_NAME"
}

show_status() {
  ensure_basic_prereqs
  echo "Instance: $INSTANCE_NAME"
  limactl list
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    up)
      start_instance
      ;;
    shell)
      run_vm_shell
      ;;
    run)
      run_agent "$@"
      ;;
    stop)
      stop_instance
      ;;
    destroy)
      destroy_instance
      ;;
    status)
      show_status
      ;;
    ""|help|-h|--help)
      usage
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
