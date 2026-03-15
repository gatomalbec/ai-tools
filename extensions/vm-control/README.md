# vm-control extension (local)

Adds VM lifecycle convenience commands for safe-pi sessions:

- `/kill` — immediately power off the VM and exit `pi`
- `/kill-vm` — alias of `/kill`

Safety:
- Command only works when `PI_SAFE_VM=1` (set by `safe-pi`)
