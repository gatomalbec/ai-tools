# ai-tools

Agent tools and extensions for [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Pi-agent sync across machines

This repo can be your canonical `~/.pi/agent` source.

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

## Repo layout

- `skills/pi-skills/*` — skill directories
- `extensions/*` — extension directories
- `packages/rlm` — package source code (kept under `packages` as a monorepo convention)

## Packages

| Package | Description |
|---------|-------------|
| [`packages/rlm`](packages/rlm) | Recursive Language Model state management for structured coding tasks |
