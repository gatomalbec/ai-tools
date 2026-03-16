# ai-tools

Focused repo for two components only:

- `rlm` — Recursive Language Model extension for `pi`
- `safe-pi` — macOS disposable NixOS VM wrapper for running `pi`

## Quick setup

### 1) Link the `rlm` extension into `~/.pi`

```bash
mkdir -p ~/.pi/agent/extensions
ln -snf "$PWD/extensions/rlm" ~/.pi/agent/extensions/rlm
```

### 2) Install `safe-pi` into `~/.local/bin`

```bash
make install-safe-pi
```

If `~/.local/bin` is not in your `PATH`, add it in your shell profile.

## `safe-pi` (macOS)

`safe-pi` runs `pi` inside a disposable NixOS VM via Lima.

### Prerequisite

```bash
brew install lima
```

### Usage

```bash
safe-pi --help
safe-pi "your prompt"
safe-pi --model gpt-5
```

By default, `safe-pi` prepends `--new-session` unless you pass an explicit session/resume flag.

For direct VM lifecycle control:

```bash
./scripts/safe-pi-vm.sh up
./scripts/safe-pi-vm.sh shell
./scripts/safe-pi-vm.sh stop
./scripts/safe-pi-vm.sh destroy
./scripts/safe-pi-vm.sh status
```

## Repo layout

- `packages/rlm` — RLM extension source
- `extensions/rlm` — extension entry (symlink to `packages/rlm`)
- `scripts/safe-pi` — host wrapper command
- `scripts/safe-pi-vm.sh` — VM lifecycle/runner script
- `strategies/program_idea_to_impl.md` — default strategy seed used by RLM

## Packages

| Package | Description |
|---------|-------------|
| [`packages/rlm`](packages/rlm) | Recursive Language Model state management for structured coding tasks |
