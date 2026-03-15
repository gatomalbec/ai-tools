# ai-tools

Agent tools and extensions for [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Pi-agent sync across machines

### 1) Choose what to enable

```bash
make configure SKILLS="all" EXTENSIONS="all"
# or
make configure SKILLS="brave-search browser-tools" EXTENSIONS="web-access rlm"
```

This writes `.pi-agent-selection.mk` with your enabled skills/extensions.

### 2) Bootstrap a new machine (recommended first run)

```bash
make bootstrap
```

`bootstrap` checks required tools (`git`, `node`, `npm`, `make`), creates a default selection config if missing, and runs install.

### 3) Install/update links and deps (idempotent)

```bash
make install
```

What `make install` does:
- Creates `~/.pi/agent/skills` and `~/.pi/agent/extensions` if missing
- Symlinks selected entries from this repo into those folders
- Installs npm dependencies (`npm ci` when lockfile exists, otherwise `npm install`) for selected items that have a `package.json`
- Is safe to run repeatedly

Safety defaults (all false):
- `PRUNE_UNSELECTED=false` — do **not** remove unselected repo-managed links
- `REPLACE_TOP_LEVEL_LINKS=false` — do **not** replace `~/.pi/agent/skills` or `extensions` if they are symlinks
- `OVERWRITE_FOREIGN_LINKS=false` — do **not** replace symlinks that point outside this repo

Optional examples:
```bash
# prune unselected repo-managed links
make install PRUNE_UNSELECTED=true

# allow migration if top-level skills/extensions are symlinks
make install REPLACE_TOP_LEVEL_LINKS=true
```

### 4) Check current state

```bash
make status
```

## macOS disposable NixOS VM workflow for `pi-agent`

This repo also includes a macOS-only workflow that runs `pi-agent` in a disposable NixOS VM using [Lima](https://lima-vm.io/) and the `nixos-lima` template.

### Prerequisites

```bash
brew install lima
```

### Lifecycle

```bash
# create/start VM
make vm-up

# open interactive shell (starts in /workspace)
make vm-shell

# run pi in VM (supports extra args)
make vm-run
make vm-run VM_ARGS="--help"

# equivalent wrapper target
make safe-pi VM_ARGS="--help"

# stop VM
make vm-stop

# destroy VM for clean recreate
make vm-destroy

# inspect Lima instances
make vm-status
```

### Host `safe-pi` command

A wrapper script is provided at `scripts/safe-pi`. It runs `pi` inside the VM workflow.

If you want to invoke it as a normal shell command:

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/scripts/safe-pi" ~/.local/bin/safe-pi
# ensure ~/.local/bin is in PATH
```

Then use:

```bash
safe-pi --help
safe-pi "your prompt"
```

### Mounts

On create, the workflow mounts:

- host project directory (current working directory by default) → `/workspace`
- host `~/.pi` → `/home/agent/.pi`

So edits inside the VM at `/workspace` directly affect host files.

### Agent environment detection

When running `make vm-run`:

- if `/workspace/flake.nix` exists: runs `pi` via
  `nix develop /workspace --command pi ...`
- otherwise: runs `pi` directly in `/workspace`

### Configuration overrides

You can customize behavior via environment variables:

- `PI_AGENT_VM_INSTANCE` (default `pi-agent`)
- `PI_AGENT_VM_PROJECT_DIR` (default current directory)
- `PI_AGENT_VM_PI_DIR` (default `~/.pi`)
- `PI_AGENT_VM_TEMPLATE_URL` (default `github:nixos-lima`)
- `PI_AGENT_VM_CPUS`, `PI_AGENT_VM_MEMORY_GIB`, `PI_AGENT_VM_DISK_GIB`
- `PI_AGENT_BIN` (default `pi`)

## Repo layout

- `skills/pi-skills/*` — skill directories
- `extensions/*` — extension directories
- `packages/rlm` — package source code (kept under `packages` as a monorepo convention)

## Packages

| Package | Description |
|---------|-------------|
| [`packages/rlm`](packages/rlm) | Recursive Language Model state management for structured coding tasks |
