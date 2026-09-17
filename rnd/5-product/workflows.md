# langgraph-harness — Workflows UX

> **User-facing surface.** How a person watches and inspects **Runs** — live and historical. This
> is presentation only: it **references architecture, never redefines it and adds none.**
>
> Concepts (_Run_, _Workflow_, _Thread_, _Event_, _Artifact_) → **[Platform Architecture → §3](../3-architecture/platform-architecture.md#3-core-concepts)**.
> Data comes from the [Event Model](../3-architecture/event-model.md) stream (live via SSE) and the
> checkpointer; this surface is **read-only**.

---

## Who it's for

Primarily the **developer** and **tech lead** watching what langgraph-harness is doing on an MR right now, and
anyone debugging a past Run. It is the operational "what happened / what's happening" view.

## Views

### 1. Run list

A reverse-chronological list of Runs, filterable by repo / MR / workflow / outcome.

- Each row: workflow, MR, trigger (open / push), **status** (Running · Completed · Failed · Paused ·
  Terminated — from [Execution Model](../3-architecture/execution-model.md) terminal states),
  duration, and a **Needs-Attention** flag when a guardrail fired
  ([Runtime Guardrails](../3-architecture/runtime-guardrails.md)).
- Live rows update in place (SSE); no refresh.

### 2. Run detail — the timeline

The heart of the surface: the Run's **event stream** rendered as a vertical timeline, in `seq`
order ([Event Model](../3-architecture/event-model.md)).

```
▸ run_started            MR !123 · push
  ▸ ensure_repo          node · fetched
  ▸ check_index          node · fresh
▾ reasoning              agent: mr-reviewer
    · ai_message         "reviewing 4 changed files…"
    · tool_call          get_risk(svc-a)              120ms
    · tool_result        risk 0.72 (p95)
    · tool_call          get_diff_for_file(api.ts)
    ⚑ guardrail_evaluated loop (shadow)               would-remind
    · checkpoint
  ▸ artifact             3 inline comments · approve
▸ run_finished           completed · 41k ctx · 18s
```

- Node phases (deterministic) and the agent loop are visually distinct — mirrors the
  deterministic↔LLM boundary, so a user sees _where_ the model was entered.
- Each `tool_call`/`tool_result` shows latency and ok/err; `ai_message` shows token counts.
- Guardrail events appear inline with a ⚑ marker; **shadow-mode** fires are visually muted
  ("would-…") to distinguish them from active interventions.
- A **context** strip shows the live Context Meter (usage %, section breakdown, delta) from
  [Context Management](../4-subsystems/context-management.md).

### 3. Artifacts panel

The Run's outputs (descriptions, inline comments, resolutions, approve/unapprove, fixes) with a
deep link to the MR in GitLab. Read-only mirrors — GitLab remains the source of truth.

## Interactions

- **Follow live** — auto-scroll the timeline as events stream; pause to inspect.
- **Expand / collapse** phases; filter the timeline by event type (tools only, guardrails only…).
- **Jump to Thread** — since a Run resumes the MR's Thread, the view links prior Runs on the same
  MR so a user can read the whole review history.
- **Inspect a paused Run** — a `Paused` Run shows why (which guardrail / awaiting human) and, where
  supported, a resume affordance (hand-off details are an open question in Runtime Guardrails).

## States

- **Empty** — no Runs yet for the filter.
- **Live** — at least one Running row; timeline streams.
- **Failed / Terminated** — surfaced prominently with the `error` / terminating event in context.
- **Disconnected** — SSE drop shows a reconnecting banner; on reconnect the stream replays from the
  last seen `seq` (at-least-once delivery, Event Model).

## Data sources (read-only)

| Shows                              | From                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------- |
| timeline, statuses                 | [Event Model](../3-architecture/event-model.md) stream (SSE)                |
| run history, resume                | checkpointer ([Data Model](../3-architecture/data-model.md))                |
| context strip                      | Context Meter ([Context Management](../4-subsystems/context-management.md)) |
| Needs-Attention, guardrail markers | [Runtime Guardrails](../3-architecture/runtime-guardrails.md)               |

## Relationship to other product surfaces

Aggregate trends across many Runs live in the [Dashboard](./dashboard.md) and
[Analytics UX](./analytics-ui.md); this surface is the _single-Run_ view they drill into.
