# langgraph-harness — Memory UX

> **User-facing surface.** How a person **browses, searches, and curates** the institutional
> memory, and sees it surfaced in context. Presentation only: it **references architecture, adds
> none** — no new memory model.
>
> The store, context records, and the temporal entity graph are the
> **[Memory Layer](../4-subsystems/memory-layer.md)** (subsystem) and
> **[Platform Architecture → §6.3](../3-architecture/platform-architecture.md#63-memory-layer-supermemory)**.
> This surface **displays and curates** them; it defines nothing. Concepts →
> **[§3](../3-architecture/platform-architecture.md#3-core-concepts)**.

---

> **v1 scope** ([PA §10 Decision 5](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts)):
> v1 memory is **context records only**, so the v1 surface is views 1–2 over
> context records. Views 3–4 and time-travel depend on the temporal entity graph and are
> **future scope**, landing when it does.

## Who it's for

- **New team member** — "why does Service X exist?", onboarding.
- **Developer / reviewer** — sees prior decisions and risk on the MR in front of them.
- **On-call** — "which services were affected by Incident #456?" fast.
- **Tech lead** — curates: confirms, corrects, or retires facts.

## Views

### 1. Surfaced-in-context (the most-used path)

Memory is most valuable _where work happens_, not as a destination. On an MR, the
[Workflows](./workflows.md) view shows a **prior-context panel**: overlapping past decisions, prior
risk on these files/symbols, owners, and linked issues — the recall the reviewer received
(Memory Layer ingestion/retrieval). Each item is **traceable** to its source fact (per the
platform's traceability principle) — no unattributed claims.

### 2. Ask / search

A query box answering the memory-layer's target questions ("Why was the JWT refresh endpoint
introduced?", "Who approved Redis over DynamoDB?"). Results are **cited** — each answer links to
the context record(s) and entity-graph facts behind it. Structural (files/symbols) and semantic
(summary) matches are both offered.

### 3. Entity browser _(future scope — needs the entity graph)_

Navigate the temporal entity graph (Service, Repository, Issue, MR, ADR, Incident, Team, Developer,
API, Dependency). Selecting an entity shows its facts, relationships, and **history** — including
**superseded** facts shown as past state, never silently dropped (temporal model, Data Model).

### 4. Decisions / ADRs _(future scope — needs the entity graph)_

The decision record with its supersession chain (ADR-7 supersedes ADR-3), rationale, and
alternatives — the durable copy that survives index rebuilds (Memory Layer §6).

## Interactions

- **Time-travel** — "what did we know about Service X in April?" scopes the entity view to a past
  point (temporal queries are a first-class memory capability).
- **Trace** — every fact/answer expands to its provenance (which MR/issue/discussion, who, when).
- **Curate** (tech-lead) — confirm, correct, or retire a fact. Corrections **supersede**, they do
  not delete: history is preserved. This is the only _write_ affordance on any product surface, and
  it writes to memory, not to execution or GitLab.

## States

- **Cold start** — little memory yet; the surface explains coverage is still building
  (ties to the _memory coverage_ KPI) rather than implying gaps are answers.
- **Low confidence** — semantic-only matches are labelled as such, distinct from exact structural
  hits.
- **Superseded** — old facts render as clearly historical, with a link to what replaced them.

## Data sources

| View                                        | From                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| surfaced context, ask, entity browser, ADRs | [Memory Layer](../4-subsystems/memory-layer.md) (supermemory store + entity graph) |
| provenance / traceability                   | context records ([Data Model](../3-architecture/data-model.md))                    |
| in-context placement                        | [Workflows](./workflows.md) Run view                                               |

Read-only **except** curation (confirm/correct/retire), which writes to the Memory Layer as
supersessions — never to a Run or to GitLab.

## Relationship to other product surfaces

[Workflows](./workflows.md) is where memory is _consumed_ live during a review; this surface is
where it is _explored and curated_. Coverage/quality of memory is tracked as KPIs on the
[Dashboard](./dashboard.md) / [Analytics UX](./analytics-ui.md).
