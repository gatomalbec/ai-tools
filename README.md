# ai-tools

Agent tools and extensions for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Pi sync across machines

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

## macOS disposable NixOS VM workflow for `safe-pi`

This repo includes a macOS-only wrapper command, `safe-pi`, that runs `pi` inside a disposable NixOS VM using [Lima](https://lima-vm.io/) and `nixos-lima`.

### Prerequisite

```bash
brew install lima
```

### Install the `safe-pi` command

`make install` and `make bootstrap` now install a `safe-pi` symlink to:

```bash
~/.local/bin/safe-pi
```

If `~/.local/bin` is not in your `PATH`, add it in your shell config.

### Usage

```bash
safe-pi --help
safe-pi "your prompt"
safe-pi --model gpt-5
```

### In-session kill command

Inside `safe-pi`, you can stop the VM and exit `pi` with:

```text
/kill
```

Alias:

```text
/kill-vm
```

If the command is newly installed, run `/reload` inside `pi` first.

If a VM shutdown ever drops you back to a garbled host terminal, run:

```bash
reset
# or: stty sane
```

Recent `safe-pi` updates also attempt to auto-restore host TTY settings after VM disconnect.

### Optional VM lifecycle commands

If you want direct VM control, use:

```bash
./scripts/safe-pi-vm.sh up
./scripts/safe-pi-vm.sh shell
./scripts/safe-pi-vm.sh stop
./scripts/safe-pi-vm.sh destroy
./scripts/safe-pi-vm.sh status
```

(Older `./scripts/pi-agent-vm.sh ...` invocations still work via a compatibility shim.)

Notes:
- `logout` exits the interactive VM shell session, but does **not** stop the VM.
- Stop the VM explicitly with `./scripts/safe-pi-vm.sh stop` (or destroy it with `destroy`).
- `pi` is not required to be globally installed in the VM shell; `safe-pi` can run it via `nix develop` or `npx` fallback.

### Mounts

On create, the workflow mounts:

- host project directory (current working directory by default)
- host `~/.pi`

The wrapper prefers these guest paths:

- project at `/workspace`
- pi config at `$HOME/.pi`

If an older instance uses host-absolute mount paths (for example `/Users/<you>/...`), `safe-pi` auto-detects that layout and continues to work.

### Agent environment detection

When running `safe-pi`:

- if `<workspace>/flake.nix` exists and `nix` is available: runs `pi` via
  `nix develop <workspace> --command pi ...`
- otherwise, if `pi` is already in PATH in the VM: runs `pi` directly
- otherwise: falls back to `nix shell nixpkgs#nodejs --command npx -y @mariozechner/pi-coding-agent ...`

`<workspace>` is resolved dynamically:

- preferred: `/workspace` (new instance layout)
- fallback: the host project absolute path mount (legacy instances)

For legacy `~/.pi` mounts, `safe-pi` also exports `PI_CODING_AGENT_DIR` to the mounted host path so auth/config are reused.

### Configuration overrides

You can customize behavior via environment variables:

- `SAFE_PI_VM_INSTANCE` (default `safe-pi`)
- `SAFE_PI_VM_PROJECT_DIR` (default current directory)
- `SAFE_PI_VM_PI_DIR` (default `~/.pi`)
- `SAFE_PI_VM_TEMPLATE_URL` (default `https://raw.githubusercontent.com/nixos-lima/nixos-lima/master/nixos.yaml`)
- `SAFE_PI_VM_CPUS`, `SAFE_PI_VM_MEMORY_GIB`, `SAFE_PI_VM_DISK_GIB`
- `SAFE_PI_BIN` (default `pi`)
- `SAFE_PI_NIX_FALLBACK_APP` (default `nixpkgs#nodejs`)
- `SAFE_PI_NPM_PACKAGE` (default `@mariozechner/pi-coding-agent`)

Legacy `PI_AGENT_*` VM variable names are still accepted for backward compatibility.

## Repo layout

- `skills/pi-skills/*` — skill directories
- `extensions/*` — extension directories
- `packages/rlm` — package source code (kept under `packages` as a monorepo convention)

## Packages

| Package | Description |
|---------|-------------|
| [`packages/rlm`](packages/rlm) | Recursive Language Model state management for structured coding tasks |
