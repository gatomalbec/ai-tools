# rlm

A [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension implementing a Recursive Language Model for structured coding tasks.

Based on [Recursive Language Models (arXiv:2512.24601)](https://arxiv.org/abs/2512.24601) by Zhang, Kraska & Khattab.

## How it works

The agent operates on **bounded observations** of external state rather than accumulating prompt history. When a sub-problem is too complex for the current context, the agent **recursively invokes itself** on a scoped sub-task via an isolated `pi` subprocess. Each recursive call gets the strategy injected as its system prompt and a fresh context window.

1. **Observation injection** — Before each agent turn, reads session state (strategy, task context, recursion depth, requirements, state file index) and injects it into the system prompt.
2. **Recursive self-invocation** — The `rlm_recurse` tool spawns an isolated `pi` subprocess for a sub-task. The child gets the current strategy as system prompt, full tool access, and can itself recurse up to a configurable depth limit.
3. **Requirements-gated auto-continue** — `/rlm-loop` enables autonomous multi-step iteration. `/rlm-require` tracks critical requirements. When any critical requirement is unresolved, iteration halts.
4. **Opt-in mode** — `/rlm-on` and `/rlm-off` toggle per repo so the extension doesn't interfere with normal pi-agent use.

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

## Commands

```
/rlm-init                           # Initialize with default seed
/rlm-init --seed bug_investigation  # Use a specific seed
/rlm-init --force                   # Reinitialize (overwrites existing)
/rlm-on                             # Enable RLM mode
/rlm-off                            # Disable RLM mode
/rlm-status                         # Show current status
/rlm-loop 5                         # Enable auto-continue (5 iterations)
/rlm-loop off                       # Disable auto-continue
/rlm-require Must support OAuth     # Add a critical requirement
/rlm-require done REQ-001           # Mark requirement confirmed
/rlm-require clear                  # Clear all requirements
/rlm-require                        # List requirements
```

## Tools

| Tool | Description |
|------|-------------|
| `rlm_recurse` | Spawn an isolated sub-agent on a scoped sub-task. The child gets the current strategy as system prompt and full tool access. Recursion depth is tracked and capped. |

## CLI flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--rlm-max-iterations` | string | `10` | Hard ceiling on auto-continue iterations |

## Observation contents

Injected into the system prompt before each agent turn:

| Component | Source | Bound |
|-----------|--------|-------|
| Recursion depth | `RLM_DEPTH` env var | Single number |
| Strategy | `strategy.md` | Full file |
| Task context | `td usage --json` | 2000 chars |
| Requirements | `state/requirements.json` | Summary line (counts) |
| State files | `state/` directory listing | File names only |

## Per-project state layout

```
repo/
  .tdarlm/
    mode.json              # Repo-scoped ON/OFF toggle
    sessions/
      <session-id>/
        strategy.md        # Reasoning policy (plain markdown)
        state/             # State files (requirements.json, loop.json, etc.)
  .todos/                  # td task state (separate system)
```

## Writing seed strategies

Seeds live in `~/.tdarlm/strategies/`. The default seed includes phased guidance (Orient → Decompose → Implement → Verify) and documents when to use `rlm_recurse`.

## References

- Zhang, Kraska & Khattab (2025). *Recursive Language Models*. arXiv:2512.24601.
- Shinn et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning*. NeurIPS 2023.

## License

[MIT](LICENSE)
