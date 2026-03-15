# rlm

A [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that injects structured state observations into the system prompt and gates autonomous iteration on requirements closure.

Inspired by the bounded-observation idea in [Recursive Language Models (arXiv:2512.24601)](https://arxiv.org/abs/2512.24601) by Zhang, Kraska & Khattab — though this extension does not implement the paper's recursive self-invocation mechanism.

## What it does

1. **Observation injection** — Before each agent turn, reads session state (strategy, task context, requirements summary, state file index) and injects a bounded observation into the system prompt.
2. **Requirements-gated auto-continue** — The agent can enable multi-step iteration via `loop.json`. If `requirements.json` has unresolved critical requirements, iteration halts and the user is prompted.
3. **Opt-in mode** — `/rlm-on` and `/rlm-off` toggle observation injection per repo, so the extension doesn't interfere with normal pi-agent use.

The extension registers **no custom tools**. The agent reads and writes state files using pi-agent's native file access.

## Installation

```bash
git clone https://github.com/gatomalbec/ai-tools.git
cd ai-tools/packages/rlm
npm install

# Symlink into pi-agent extensions
ln -s "$(pwd)" ~/.pi/agent/extensions/rlm
```

### Set up a seed strategy

```bash
mkdir -p ~/.tdarlm/strategies
cp strategies/program_idea_to_impl.md ~/.tdarlm/strategies/
```

Seeds are templates. `/rlm-init` copies one into the active session's `strategy.md`.

## Usage

```
/rlm-init                           # Initialize with default seed
/rlm-init --seed bug_investigation  # Use a specific seed
/rlm-init --force                   # Reinitialize (overwrites existing)
/rlm-on                             # Enable observation injection
/rlm-off                            # Disable observation injection
/rlm-status                         # Show current status
```

RLM mode is **opt-in** and repo-scoped.

### CLI flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--rlm-max-iterations` | string | `10` | Hard ceiling on auto-continue iterations |

### Observation contents

| Component | Source | Bound |
|-----------|--------|-------|
| Strategy | `strategy.md` | Full file |
| Task context | `td usage --json` | 2000 chars |
| Requirements | `state/requirements.json` | Summary line (counts) |
| State files | `state/` directory listing | File names only |

### Requirements contract

Track requirements in `.tdarlm/sessions/<session-id>/state/requirements.json`:

```json
{
  "requirements": [
    {
      "id": "REQ-001",
      "statement": "One-sentence requirement",
      "priority": "critical",
      "status": "open",
      "verification": "command/test proving completion"
    }
  ]
}
```

When any requirement has `priority: "critical"` and `status: "open"`, auto-continue halts.

### Auto-continue

The agent enables iteration by writing `state/loop.json`:

```json
{ "enabled": true, "remaining": 5, "max": 5 }
```

After each agent turn, the extension decrements `remaining` and injects a continuation prompt. Stops when `remaining` hits 0, `enabled` is false, or critical requirements are unresolved. Bounded by `--rlm-max-iterations`.

### Per-project state layout

```
repo/
  .tdarlm/
    mode.json              # Repo-scoped ON/OFF toggle
    sessions/
      <session-id>/
        strategy.md        # Reasoning policy (plain markdown)
        state/             # Arbitrary state files (requirements.json, loop.json, etc.)
  .todos/                  # td task state (separate system)
```

## Writing seed strategies

Seeds live in `~/.tdarlm/strategies/`. See `strategies/program_idea_to_impl.md` for an example.

## References

- Zhang, Kraska & Khattab (2025). *Recursive Language Models*. arXiv:2512.24601. Inspiration for bounded observation over external state.
- Shinn et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning*. NeurIPS 2023.

## License

[MIT](LICENSE)
