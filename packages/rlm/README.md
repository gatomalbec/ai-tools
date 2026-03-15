# ai-tools

A [pi-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension implementing **Recursive Language Model (RLM)** state management for structured coding tasks.

Based on [Recursive Language Models (arXiv:2512.24601)](https://arxiv.org/abs/2512.24601).

## Architecture

The RLM formalism defines a recursive state machine where the LLM operates on bounded observations of external state rather than accumulating prompt history:

```
X_{t+1} = T(X_t, a_t)
O_t     = Obs(X_t)
a_t     = LLM(O_t)
```

`X` is the full external state. `O` is a bounded observation (the runtime prompt). `a` is the model's output (actions).

### State decomposition

We decompose `X` into concrete subsystems:

```
X = { workspace, strategy, tasks, log, state_files }
```

| Component | Location | Role |
|-----------|----------|------|
| **Workspace** | Repo files | The project itself — code, configs, artifacts |
| **Strategy** | `.tdarlm/strategy.md` | Reasoning policy that governs the agent's approach. Seeded from a template at init time. By default immutable; optionally mutable (see below) |
| **Tasks** | `.todos/` (via [`td`](https://github.com/marcus/td)) | Task decomposition and tracking. The agent queries `td` for current task state |
| **Log** | `.tdarlm/log.md` | Timestamped entries: observations, actions, reflections, errors. Provides memory across context windows |
| **State files** | `.tdarlm/state/` | Arbitrary persistent intermediate data (e.g., `orient.md`, `dependency-graph.json`) |

Each component serves a distinct function in the recursive loop:
- **Strategy** defines *what to do and how* — the agent's reasoning policy for the current project.
- **Log** records *what happened* — decisions, outcomes, errors. The observation function reads only the tail, keeping the prompt bounded.
- **Tasks** track *what remains* — the agent reads task state from `td` and includes a bounded slice in the prompt.
- **State files** hold *working data* — structured artifacts that need to persist across context compactions but don't belong in the log or strategy.

### Observation bounds

The prompt builder reads bounded slices of each component:

| Component | Bound | Rationale |
|-----------|-------|-----------|
| Strategy | Full file | Core policy; must be fully visible; kept small by convention |
| Task context | 2000 chars | `td usage --json` is already AI-optimized |
| Workspace | Git summary + 15 recent files | Spatial awareness without overload |
| Log | Last 20 entries | Recency bias; deeper access via `rlm_read_log` tool |
| State index | File names only | Content read on-demand via `rlm_read_state` tool |

### Mutable vs. immutable strategy

By default, the strategy is immutable — the agent reads it but cannot modify it. This matches the paper's original formalism where `Obs` is fixed.

The `--rlm-fixed-strategy=false` flag makes the strategy part of mutable state, allowing the agent to update its own reasoning policy as it learns about the problem. When enabled, the agent must provide a reason for each update, and all mutations are logged with a revision counter.

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

The seed is a template. `/rlm-init` copies it into `repo/.tdarlm/strategy.md` for that project.

## Usage

In pi-agent:

```
/rlm-init                           # Initialize .tdarlm/ with default seed
/rlm-init --seed bug_investigation  # Use a specific seed
/rlm-init --force                   # Reinitialize (overwrites existing)
```

### CLI flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--rlm-live-obs` | boolean | `false` | Refresh observation before every LLM call, not just per user prompt |
| `--rlm-fixed-strategy` | boolean | `true` | Strategy is immutable. Set to `false` to allow the agent to update it |
| `--rlm-max-iterations` | string | `10` | Hard ceiling on auto-continue iterations |

### Tools

8 tools registered for the LLM:

| Tool | Description |
|------|-------------|
| `rlm_read_strategy` | Read the current reasoning strategy with metadata |
| `rlm_read_log` | Read bounded log entries with optional level filtering |
| `rlm_read_state` | Read a named state file from `.tdarlm/state/` |
| `rlm_task_query` | Query `td` for task status, usage context, or specific issues |
| `rlm_update_strategy` | Update the strategy (requires a reason; blocked when `--rlm-fixed-strategy`) |
| `rlm_log` | Append an observation/action/reflection/error to the log |
| `rlm_write_state` | Write a named state file |
| `rlm_delete_state` | Delete a named state file |

### Auto-continue

The agent can enable autonomous multi-step iteration by writing a `loop.json` state file:

```json
{ "enabled": true, "remaining": 5, "max": 5 }
```

After each agent loop, the extension decrements `remaining` and injects a continuation prompt. Stops when `remaining` hits 0 or `enabled` is set to `false`. Bounded by `--rlm-max-iterations`.

### Per-project state layout

```
repo/
  .tdarlm/
    strategy.md         # Reasoning policy (read-only by default)
    log.md              # Timestamped log entries
    state/              # Named state files (orient.md, loop.json, etc.)
  .todos/               # td task state (separate system)
```

## Writing seed strategies

Seed strategies live in `~/.tdarlm/strategies/`. See [`strategies/program_idea_to_impl.md`](strategies/program_idea_to_impl.md) for an example covering:

- Phase 0: Orient (build mental model before planning)
- Phase 1: Decompose (bounded recursive task breakdown)
- Phase 2: Implement (observe-think-act-verify loop)
- Phase 3: Integrate & Verify (acceptance criteria checking)

## License

[MIT](LICENSE)
