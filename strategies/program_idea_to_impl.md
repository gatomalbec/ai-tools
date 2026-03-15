# Strategy: Program Idea to Implementation

## Meta
- This strategy governs how a recursive LM decomposes and executes
  a programming task via the `td` CLI and `pi-agent` agent framework.
- Each phase produces artifacts the next phase consumes.
- Recursion has a depth budget. Default max depth: 3.
  If a subtask still feels too large at depth 3, it is a design smell —
  revisit the decomposition at a higher level before going deeper.

---

## Phase 0: Orient (before any decomposition)

Goal: build a mental model of the problem *before* committing to a plan.

1. Restate the goal in one sentence. If you can't, the goal isn't clear —
   ask for clarification or log the ambiguity and pick the most likely
   interpretation with an explicit assumption tag: `[ASSUME: ...]`
2. Identify the **acceptance criteria**. What does "done" look like?
   Express as concrete, verifiable predicates (e.g., "the CLI exits 0
   when given valid input", not "it works").
3. List **knowns** and **unknowns**. For each unknown, decide:
   - Can it be resolved with a quick probe (read a file, run a command)?
     → Do it now, log the result.
   - Does it require design work? → Carry it into Phase 1.
   - Is it irrelevant to the first working slice? → Park it.
4. Identify **constraints**: language, framework, deployment target,
   performance envelope, dependencies that are fixed vs. chosen.

Artifact: `orient.md` — goal, acceptance criteria, knowns/unknowns, constraints.

---

## Phase 1: Decompose (recursive, bounded)

Goal: break the task into subtasks small enough to implement in a single
focused pass (rule of thumb: one file or one function boundary).

1. Draft a **task tree**. Each node has:
   - `id`: short slug (e.g., `parse-config`)
   - `goal`: one sentence
   - `inputs`: what it needs (files, data, outputs of sibling tasks)
   - `outputs`: what it produces
   - `done-when`: verifiable predicate (inherited from or refining
     the parent's acceptance criteria)
   - `depth`: current recursion depth
2. Order leaf tasks by **dependency**, not importance. A task that
   unblocks others ships first.
3. Identify the **critical path** — the longest chain of dependent tasks.
   This is what you optimize for parallelism or simplification.
4. Apply the **vertical slice heuristic**: find the thinnest path from
   input to output that exercises every layer. That slice ships first.
   Everything else is a widening pass.

### Decomposition guards
- **Width limit**: No node should have more than 5-7 children.
  If it does, introduce an intermediate grouping node.
- **Depth limit**: Max 3 levels. If you hit it, stop and reflect:
  is the parent task too vague, or is the domain genuinely complex?
  Log the answer.
- **Leaf size check**: Can you hold the full context of this subtask
  in ~4k tokens of description + relevant code? If not, split further
  (within depth budget) or simplify the interface.

Artifact: task tree (can be a markdown outline, a JSON file, or
whatever `td` consumes natively).

---

## Phase 2: Implement (observe-think-act loop)

Goal: execute each leaf task, one at a time, using a structured loop.

For each task in dependency order:

```
loop:
  OBSERVE  — read the current state (files, test output, errors).
             Summarize what you see in 2-3 sentences. Do not skip this.
  THINK    — given the observation and the task's done-when predicate,
             decide the single smallest action that moves toward done.
             If multiple plausible actions exist, pick the most
             *reversible* one. Log the choice and why.
  ACT      — execute the action (write code, run a command, edit a file).
             One action per loop iteration. Do not batch.
  VERIFY   — check: did the action move toward done-when?
             - Yes → continue or mark task complete.
             - No  → enter REFLECT (see below).
             - Unclear → add a lightweight probe (a test, a print, a
               type check) to make the signal clear, then re-observe.
```

### Reflect (when stuck or regressing)

Triggered when:
- VERIFY fails twice in a row on the same task.
- You've spent more than N iterations (default: 5) on a single leaf
  without completing it.
- You notice you're editing the same lines repeatedly.

Steps:
1. **Summarize the failure mode** in one sentence.
2. **Classify** it:
   - `wrong-decomposition` — the task boundaries are off. → Go back to
     Phase 1, re-split this subtask.
   - `missing-context` — you need information you don't have. → Run a
     probe (read docs, search codebase, check types).
   - `wrong-approach` — the algorithm or API choice isn't working.
     → List 2 alternatives, pick one, log why.
   - `environment-issue` — tooling, permissions, deps. → Fix the
     environment, don't hack around it.
3. **Log the reflection** with the classification and next action.
4. **Reset iteration count** for this task after the revision.

### Context management
- After completing each leaf task, write a **one-line summary** of what
  changed (file, function, behavior). This is your running changelog.
- If accumulated context exceeds what the LM can hold, compress:
  summarize completed subtrees into their outputs and drop the
  step-by-step logs. Keep only the changelog and current task state.

---

## Phase 3: Integrate & Verify

Goal: confirm the assembled pieces satisfy the original acceptance criteria.

1. Run the **acceptance criteria** from Phase 0 as literal checks.
   Each predicate should map to a command you can run.
2. Test the **boundaries between subtasks** — this is where integration
   bugs live. Specifically:
   - Data flowing between modules: types match? Nulls handled?
   - Error propagation: does a failure in subtask A surface correctly
     in subtask B?
   - State: if subtasks share mutable state, verify ordering assumptions.
3. Test **edge cases** derived from the unknowns list in Phase 0.
   Each unknown that was resolved with an assumption should have at
   least one test that would fail if the assumption is wrong.
4. If verification fails, classify the failure (same taxonomy as Reflect)
   and route back to the appropriate phase.

Artifact: verification log — which criteria passed/failed, with evidence.

---

## Principles

1. **One action per loop iteration.** Batching actions makes it impossible
   to attribute failures. The overhead of small steps is cheaper than the
   cost of debugging interleaved changes.

2. **Observe before you act.** The #1 failure mode of agentic systems is
   acting on stale or assumed state. Always re-read before you write.

3. **Verify continuously, not just at the end.** Every action gets a
   verification check. Catching errors one step after they're introduced
   is 10x cheaper than catching them at integration time.

4. **Bound recursion explicitly.** Unbounded decomposition is
   procrastination with structure. Set depth and width limits, and treat
   hitting them as a signal to rethink, not to increase the limits.

5. **Log decisions, not just actions.** The *why* behind a choice is more
   valuable than the *what* when you need to backtrack. Format:
   `[DECISION: chose X over Y because Z]`

6. **Prefer reversible actions.** When two approaches seem equally good,
   pick the one that's easier to undo. This is especially true early in
   implementation when your understanding is weakest.

7. **Compress aggressively.** Context windows are finite. Completed work
   should be summarized into its outputs. The journey matters less than
   the destination once you've arrived.

8. **Fail fast on unknowns.** Don't defer uncertainty — resolve it with
   the cheapest possible probe before building on top of assumptions.

9. **The vertical slice is sacred.** The thinnest end-to-end path is
   always the first deliverable. It proves the architecture works and
   gives you a skeleton to hang everything else on.

