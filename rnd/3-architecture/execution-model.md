# langgraph-harness — Execution Model

> **Domain owned by this document:** the **normative model of how a Run executes** — its phases,
> states, transitions, and invariants. This is the full specification that
> **[Platform Architecture → §5](./platform-architecture.md#5-execution-model)** summarizes.
>
> **Shared concepts are not redefined here.** _Run_, _Event_, _Workflow_, _Thread_, _Artifact_ are
> defined in **[Platform Architecture → §3](./platform-architecture.md#3-core-concepts)**. This
> document specifies how a Run _moves_, not what those words mean. See Platform Architecture.
>
> **Architecture, not implementation.** It defines states, transitions, and contracts — not code,
> queue configuration, or class layout (those belong to subsystem/build docs).

---

## Scope

A **Run** is one execution of a **Workflow** against a **Thread**. This document defines the
lifecycle every Run passes through, the invariants that hold at each step, and the contract
between deterministic scaffolding and the LLM. It is model-level: any implementation that
preserves these states, transitions, and invariants is conformant.

## Run lifecycle

```
Trigger ─▶ Admitted ─▶ Prepared ─▶ Reasoning ─▶ Writing ─▶ Observed ─▶ Terminal
 (event)   (debounce   (lifecycle   (agent      (guarded    (trace /   (Completed |
            + lock)      nodes)       loop)       write)      metrics)   Failed |
                                                                         Paused |
                                                                         Terminated)
```

| Phase         | What holds                                                                                                                                                       | Emits                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Trigger**   | A coarse event (MR open / push) or API call arrives (see §5, §6.4). Fine-grained discussion events do not start Runs.                                            | —                                                                     |
| **Admitted**  | The event is debounced (coalescing rapid pushes) and the **per-MR execution lock** is acquired. A Run exists only past this point.                               | `run_started`                                                         |
| **Prepared**  | Deterministic lifecycle nodes run: `ensure_repo` → `check_index` → (`init_repo` \| `sync_repo` \| skip) → (worktree, when applicable). **No LLM.**               | `node_*`                                                              |
| **Reasoning** | The agent loop: the router (§6.8) selects agent node(s); each resumes the Thread and calls MCP tools; context is metered per request. **LLM only here.**         | `ai_message`, `tool_call`, `tool_result`, `model_retry`, `checkpoint` |
| **Writing**   | Outputs pass the **guarded write path** (validation → draft notes / inline comments / approve-unapprove; dev agent: symbol-safe edits verified by `tsc`/eslint). | `node_*`, `artifact`                                                  |
| **Observed**  | One trace is emitted; the event stream is consumed by analytics; outcomes are backfilled to memory on later merge/revert.                                        | —                                                                     |
| **Terminal**  | `Completed`, `Failed`, `Paused` (guardrail/human), or `Terminated` (guardrail). The lock releases.                                                               | `run_finished`                                                        |

## States & transitions

```
Admitted ──▶ Prepared ──▶ Reasoning ──▶ Writing ──▶ Observed ──▶ Completed
                              │                                     ▲
                              ├── error ───────────────────────────┴─▶ Failed
                              ├── guardrail.pause ──▶ Paused ──(resume)──▶ Reasoning
                              └── guardrail.terminate ─────────────────▶ Terminated
```

- `Paused` is re-entrant: a paused Run resumes into `Reasoning` on the same Thread (see
  [Runtime Guardrails](./runtime-guardrails.md) for the pause hand-off open question).
- `Failed` / `Terminated` are final; the Thread persists for the next Run.

## Invariants

1. **One active Run per MR.** Enforced by a transaction-scoped **Postgres advisory lock**
   (acquired at _Admitted_, auto-released at _Terminal_ or on crash). Coarse events that arrive
   during a Run do not start a second Run; they are picked up on the next cycle.
2. **Debounce before lock.** Rapid pushes coalesce into a single Run (≈5m debounce).
3. **Deterministic-first.** Every phase before _Reasoning_ is deterministic (conditional logic +
   subprocess calls); the LLM is entered only in _Reasoning_.
4. **Every step is observable.** Each lifecycle node and tool call emits events onto the single
   stream (see [Event Model](./event-model.md)); nothing runs silently.
5. **Every step is resumable.** State is checkpointed (Postgres checkpointer) so a Run resumes
   after a crash; startup reconciliation repairs worktrees (see
   [Git Management](../4-subsystems/git-management.md)).
6. **Writes are guarded.** No outward write bypasses the guarded write path.
7. **Thread continuity.** A Run resumes the MR's existing Thread; it never rebuilds context from
   scratch.

## The deterministic ↔ LLM boundary (contract)

- **Lifecycle nodes** are pure orchestration: inputs → conditional → subprocess → typed result +
  events. They must be deterministic and side-effect-scoped (clone / fetch / index / worktree).
  They never call an LLM.
- **Agent nodes** are the only LLM entry. Each has a **named toolset** (least privilege); which
  agents activate is decided by the **router** ([§6.8](./platform-architecture.md#68-agents--routing)),
  not by the workflow graph shape.
- **Middleware** (e.g. context editing, [Runtime Guardrails](./runtime-guardrails.md)) may observe
  and — for guardrails — interrupt the agent loop, but carries no workflow-specific logic.

## Concurrency, ordering, recovery

- Runs for one MR are **serialized** by the lock; Runs across different MRs are concurrent.
- Ordering within a Run is the event order on the stream (see Event Model for delivery semantics).
- Recovery: checkpoint replay resumes an interrupted Run; fallback cleanup + startup
  reconciliation (Git Management) handle missed webhooks and orphaned worktrees.

## Extension points

- **New lifecycle nodes** slot into _Prepared_ as deterministic steps (emit `node_*`).
- **New agent nodes / tiers** attach via the router (§6.8) without changing the lifecycle.
- **New interrupts** are added as guardrail middleware (Runtime Guardrails), not as workflow edits.

## Related models

Emits the vocabulary defined in [Event Model](./event-model.md); its per-Run measurements are
catalogued in [Metrics Catalog](./metrics-catalog.md); persisted state shapes are in
[Data Model](./data-model.md).
