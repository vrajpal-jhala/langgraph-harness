# langgraph-harness — Event Model

> **Domain owned by this document:** the **event envelope, the event catalog, and delivery
> semantics** of the single execution stream. This is the specification behind the _Event_ concept
> and its cross-cutting role.
>
> **Shared concepts are not redefined here.** _Event_ is defined in
> **[Platform Architecture → §3](./platform-architecture.md#3-core-concepts)**; its cross-cutting
> role in **[§7](./platform-architecture.md#7-cross-cutting-concepts)**. This document specifies its
> _structure and contract_, not its meaning. See Platform Architecture.
>
> **Architecture, not implementation.** Field names below are the model's vocabulary, not a wire
> format or serializer choice.

---

## The one-stream principle

There is **one** event stream per Run, and it is the **single source of truth for observability**.
Every consumer — [Behavioral Observability](../4-subsystems/analytics.md), the live UI timeline,
LLM Ops — reads this one stream. No subsystem re-instruments a workflow, and no consumer invents a
side channel. Adding observability means **adding an event type**, never a new stream.

## Event envelope

Every event, regardless of type, carries a common envelope:

```
Event
  runId          which Run (see Execution Model)
  threadId       the MR Thread the Run resumes
  seq            monotonic sequence within the Run (ordering key)
  ts             timestamp
  type           catalog type (below)
  phase          Execution-Model phase that emitted it (Prepared | Reasoning | Writing | …)
  payload        type-specific fields
```

`runId` + `seq` uniquely orders an event within its Run. Consumers must treat unknown `type`
values as ignorable (forward-compatibility), so new event types are additive.

## Event catalog

The authoritative list of event types. Types group by the layer that emits them.

### Run lifecycle

| Type           | Emitted when             | Key payload                                          |
| -------------- | ------------------------ | ---------------------------------------------------- |
| `run_started`  | Run admitted (lock held) | trigger kind, workflow                               |
| `run_finished` | Run reaches Terminal     | outcome (`completed`/`failed`/`paused`/`terminated`) |

### Deterministic nodes (Execution Model _Prepared_ / _Writing_)

| Type            | Emitted when                               | Key payload                               |
| --------------- | ------------------------------------------ | ----------------------------------------- |
| `node_start`    | a lifecycle node begins                    | node name                                 |
| `node_progress` | streamed progress (e.g. index build lines) | line/percent                              |
| `node_end`      | a node completes                           | typed result (e.g. `{indexed, age_days}`) |

### Agent loop (_Reasoning_)

| Type          | Emitted when                  | Key payload                        |
| ------------- | ----------------------------- | ---------------------------------- |
| `ai_message`  | model produces a message      | content ref, token counts          |
| `tool_call`   | agent invokes an MCP tool     | tool name, normalized args         |
| `tool_result` | tool returns                  | normalized output, latency, ok/err |
| `model_retry` | malformed tool call recovered | reason                             |
| `checkpoint`  | state persisted               | checkpoint id                      |

### Write path (_Writing_)

| Type       | Emitted when                 | Key payload                                  |
| ---------- | ---------------------------- | -------------------------------------------- |
| `artifact` | a durable output is produced | kind (description/comment/ADR/fix/…), target |

### Guardrails (from [Runtime Guardrails](./runtime-guardrails.md))

| Type                  | Emitted when                                    | Key payload                                 |
| --------------------- | ----------------------------------------------- | ------------------------------------------- |
| `guardrail_evaluated` | a guardrail checks a signal (incl. shadow mode) | guardrail, signal, would-fire?              |
| `guardrail_fired`     | a threshold is crossed                          | guardrail, threshold                        |
| `guardrail_action`    | an intervention is taken                        | action (reminder/summarize/pause/terminate) |

### Errors

| Type    | Emitted when     | Key payload                  |
| ------- | ---------------- | ---------------------------- |
| `error` | any phase raises | phase, message, recoverable? |

New capabilities register their types **here**. A type belongs on this stream if it describes
something that happened during a Run.

## Delivery semantics

- **Ordering.** Per Run, events are totally ordered by `seq`. Cross-Run ordering is not defined.
- **At-least-once.** A consumer may see an event more than once (replay after crash/resume);
  consumers must be **idempotent** on `(runId, seq)`.
- **Replayable.** Because events are checkpoint-aligned (Execution Model), the stream can be
  replayed to reconstruct a Run — this is what makes analytics a _derived_ layer.
- **Non-blocking.** Emission never blocks execution; a slow consumer cannot stall a Run.

## Consumers (read-only)

| Consumer                                                 | Uses events for                                    |
| -------------------------------------------------------- | -------------------------------------------------- |
| [Behavioral Observability](../4-subsystems/analytics.md) | metrics, detectors, KPIs                           |
| Live UI timeline                                         | real-time Run view (SSE)                           |
| LLM Ops                                                  | one trace per Run                                  |
| [Runtime Guardrails](./runtime-guardrails.md)            | reads detector output, emits its own `guardrail_*` |

All are read-only with respect to execution. The stream is produced by the Execution Model and
consumed here; it is never mutated by a consumer.

## Extension points

- **New event type** — add a row to the catalog; existing consumers ignore what they don't know.
- **New payload field** — additive on an existing type; consumers read defensively.
- **New consumer** — subscribes to the stream; introduces no coupling to workflows.

## Related models

Events are emitted across the phases in [Execution Model](./execution-model.md); their aggregation
into per-Run figures is [Metrics Catalog](./metrics-catalog.md); the detectors that interpret them
are the [Detector Framework](./detector-framework.md).
