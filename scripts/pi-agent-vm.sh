#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${PI_AGENT_VM_INSTANCE:-pi-agent}"
PROJECT_DIR="${PI_AGENT_VM_PROJECT_DIR:-$(pwd -P)}"
HOST_PI_DIR="${PI_AGENT_VM_PI_DIR:-$HOME/.pi}"
TEMPLATE_URL="${PI_AGENT_VM_TEMPLATE_URL:-github:nixos-lima}"

VM_CPUS="${PI_AGENT_VM_CPUS:-4}"
VM_MEMORY_GIB="${PI_AGENT_VM_MEMORY_GIB:-8}"
VM_DISK_GIB="${PI_AGENT_VM_DISK_GIB:-40}"

VM_WORKSPACE="/workspace"

PI_AGENT_BIN="${PI_AGENT_BIN:-pi}"

usage() {
  cat <<EOF
Usage:
  $0 up
  $0 shell
  $0 run [pi args...]
  $0 stop
  $0 destroy
  $0 status

Environment overrides:
  PI_AGENT_VM_INSTANCE        Instance name (default: pi-agent)
  PI_AGENT_VM_PROJECT_DIR     Host project path to mount at /workspace (default: cwd)
  PI_AGENT_VM_PI_DIR          Host ~/.pi path to mount at /home/agent/.pi (default: ~/.pi)
  PI_AGENT_VM_TEMPLATE_URL    Lima template URL (default: github:nixos-lima)
  PI_AGENT_VM_CPUS            vCPU count on first create (default: 4)
  PI_AGENT_VM_MEMORY_GIB      RAM GiB on first create (default: 8)
  PI_AGENT_VM_DISK_GIB        Disk GiB on first create (default: 40)
  PI_AGENT_BIN                Agent command binary inside VM (default: pi)
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

start_instance() {
  ensure_mount_prereqs

  if lima_instance_exists; then
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
    --mount-none \
    --mount "$PROJECT_DIR:w" \
    --mount "$HOST_PI_DIR:w" \
    --set '.mounts[0].mountPoint = "/workspace"' \
    --set '.mounts[1].mountPoint = "/home/agent/.pi"' \
    --set '.user.name = "agent"' \
    --set '.user.home = "/home/agent"' \
    --set '.user.shell = "/run/current-system/sw/bin/bash"' \
    "$TEMPLATE_URL"
}

build_agent_remote_cmd() {
  local agent_bin_q args_q arg q
  printf -v agent_bin_q '%q' "$PI_AGENT_BIN"
  args_q=""

  for arg in "$@"; do
    printf -v q '%q' "$arg"
    args_q+=" $q"
  done

  cat <<EOF
cd $VM_WORKSPACE
if [[ -f $VM_WORKSPACE/flake.nix ]]; then
  exec nix develop $VM_WORKSPACE --command $agent_bin_q$args_q
else
  exec $agent_bin_q$args_q
fi
EOF
}

run_vm_shell() {
  start_instance
  limactl shell "$INSTANCE_NAME" -- bash -lc "cd $VM_WORKSPACE && exec bash -l"
}

run_agent() {
  start_instance

  local remote_cmd
  remote_cmd="$(build_agent_remote_cmd "$@")"

  limactl shell "$INSTANCE_NAME" -- bash -lc "$remote_cmd"
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
