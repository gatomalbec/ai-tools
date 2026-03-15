#!/usr/bin/env bash
set -euo pipefail

# Backward-compatibility shim for older docs/scripts.
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/safe-pi-vm.sh" "$@"
