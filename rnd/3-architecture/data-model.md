# langgraph-harness — Data Model

> **Domain owned by this document:** the **data-ownership map** — which entities langgraph-harness persists,
> where they live, how they relate, and the retention/source-of-truth rules. It is the shared view
> across subsystems that each subsystem's detailed shapes plug into.
>
> **Shared concepts are not redefined here.** _Run_, _Event_, _Thread_, _Artifact_ are defined in
> **[Platform Architecture → §3](./platform-architecture.md#3-core-concepts)**. Detailed field
> lists are owned by their subsystems and referenced, not copied. See Platform Architecture.
>
> **Architecture, not implementation.** This is the logical model (entities, relationships,
> ownership) — not table DDL, migrations, or index choices.

---

## Source-of-truth rule (data ownership)

langgraph-harness stores the **minimum** and treats external systems as authoritative:

| Data                                              | System of record               | langgraph-harness keeps                |
| ------------------------------------------------- | ------------------------------ | -------------------------------------- |
| MR diff, discussions, replies, approvals, commits | **GitLab**                     | nothing durable — fetched live per Run |
| Repository contents & history                     | **local git** (Git Management) | canonical bare repo + worktrees        |
| Run reasoning / conversation state                | **Postgres checkpointer**      | full, resumable                        |
| Institutional memory (facts, decisions, outcomes) | **supermemory** store          | context records + entity graph         |

Everything below is langgraph-harness-owned state; discussion/diff bodies are deliberately **not** duplicated
(GitLab is source of truth — see [Review Replies](../4-subsystems/review-replies.md)).

## Entities and ownership

| Entity                                                                                             | Owned by (subsystem)                                        | Purpose                                            | Lifetime                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| **Checkpoint**                                                                                     | Execution / Postgres                                        | resumable Run state                                | per Run, retained for recovery       |
| **RunSummary**                                                                                     | [Behavioral Observability](../4-subsystems/analytics.md)    | derived per-Run metrics                            | per Run, historical                  |
| **ContextUsage / SectionUsage / ContextDelta / RunContextSnapshot**                                | [Context Management](../4-subsystems/context-management.md) | context accounting per request / Run               | per Run                              |
| **Discussion metadata**                                                                            | [Review Replies](../4-subsystems/review-replies.md)         | pointers only (ids, last-processed version)        | per MR                               |
| **Workspace metadata**                                                                             | [Git Management](../4-subsystems/git-management.md)         | worktree id, refCount, pendingDelete               | per active MR                        |
| **context_record**                                                                                 | [Memory Layer](../4-subsystems/memory-layer.md)             | durable MR/issue/bug context + outcome             | permanent (retention TBD)            |
| **Entity graph** (Service, Repository, Issue, MR, ADR, Incident, Team, Developer, API, Dependency) | Memory Layer                                                | temporal knowledge graph                           | permanent, superseded facts retained |
| **Guardrail config / events**                                                                      | [Runtime Guardrails](./runtime-guardrails.md)               | per-guardrail mode/threshold; `guardrail_*` events | config durable; events per Run       |

Each subsystem owns the **field-level shape** of its entities; this document owns only how they
relate and where they live. Do not restate field lists here — link to the owner.

## Relationships

```
Thread (1) ──< Run (N)
Run   (1) ──< Event (N)            [transient stream → Event Model]
Run   (1) ── RunSummary (1)        [derived]
Run   (1) ──< RunContextSnapshot   [Context Meter]
Run   (1) ──< Artifact (N) ──▶ context_record (Memory)   [durable outputs feed memory]
MR    (1) ── Thread (1) ── Worktree (1) ── Discussion-metadata (N)
context_record (N) ──< references >── Entity graph nodes
```

- A **Run** produces transient **Events** (Event Model), a derived **RunSummary** (Metrics
  Catalog), and **Artifacts**; durable Artifacts and their outcomes become **context records**.
- The **entity graph** is time-aware: superseded facts are retained with a supersession edge, never
  deleted (Memory Layer).

## Temporal & retention rules

- **Memory is temporal** — every fact carries validity metadata; historical-state queries ("what
  did we know in April?") are supported; supersession is recorded, not overwritten.
- **Checkpoints** persist until a Run is safely terminal and recovery is no longer needed.
- **Ephemeral vs durable** — Events and worktrees are ephemeral; RunSummary, context records, and
  the entity graph are durable. Exact retention/aging for memory is an
  [open question](../4-subsystems/memory-layer.md).

## Extension points

- A new subsystem persisting state **registers its entity here** (name, owner, lifetime,
  source-of-truth) and keeps the field shape in its own doc.
- New durable outputs should flow into memory as (or referenced by) a context record, so recall
  stays complete.

## Related models

Transient event shapes: [Event Model](./event-model.md). Derived metric shapes:
[Metrics Catalog](./metrics-catalog.md). Lifetime and resumability of Run state:
[Execution Model](./execution-model.md).
