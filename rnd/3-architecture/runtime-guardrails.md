# langgraph-harness — Runtime Guardrails

> **Domain owned by this document:** the **enforcement layer** — how detector signals become
> optional, bounded interventions in a _running_ Run. Nothing else.
>
> **This subsystem extends, it does not redesign.** It consumes the **Detectors** and **Event**
> stream defined in **[Behavioral Observability](../4-subsystems/analytics.md)** and
> **[Platform Architecture → §3 Core Concepts](./platform-architecture.md#3-core-concepts)**,
> and realises the "Runtime guardrails (optional)" note in
> **[§6.6](./platform-architecture.md#66-behavioral-analytics--observability)** under the
> _observe-before-enforce_ principle (**[§2.8](./platform-architecture.md#2-platform-philosophy--architectural-principles)**).
> Shared concepts (_Run_, _Event_, _Workflow_, _Thread_, _Detector_) are canonical in Platform
> Architecture and analytics.md. This document references, not redefines, them. See Platform
> Architecture.

---

## Purpose

Detectors _measure_ behaviour but never influence execution (analytics.md). Runtime Guardrails are
the **one place** that measurement is allowed to act: when a detector signal crosses a configured
threshold during a Run, a guardrail may nudge, compact, pause, or terminate — turning a passive
"this Run is looping" observation into a bounded intervention.

Guardrails are **optional and additive**. Behavioral observability stays fully valuable with every
guardrail disabled; enabling one changes _what happens next_, never _what is measured_.

---

## Position in the platform

```
Event stream ──▶ Detectors ──▶ [ signals ]
   (PA §3)        (analytics.md)     │
                                     ▼
                          Runtime Guardrails  ──▶ action via agent-loop middleware
                          (policy + threshold)         (PA §5, guarded write path)
                                     │
                                     └──▶ guardrail_* events on the same Event stream
```

**The boundary it must not cross.** Execution stays generic (PA §2.2): a workflow must not embed
guardrail rules. Guardrails attach as a **middleware in the agent loop** — the same mechanism as
the existing `todoListMiddleware` / `contextEditingMiddleware` (PA §4). A workflow gains guardrails
by _enabling the middleware_, not by carrying policy. The policy lives here; the workflow only
exposes the standard interruptible loop.

---

## Modes — observe before enforce

Every guardrail has a **mode**, set per-guardrail. This is the incremental rollout path: nothing
intervenes until it has been validated in shadow against real Runs.

| Mode                   | Behaviour                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **off**                | Not evaluated.                                                                                                                                                        |
| **shadow** _(default)_ | Evaluated every step; emits a `guardrail_evaluated` / would-fire event and raises the **Needs-Attention** indicator — but **takes no action**. Zero execution impact. |
| **active**             | Evaluates and **acts** when its threshold is crossed.                                                                                                                 |

A guardrail is promoted `shadow → active` only after its would-fire rate on real Runs looks right.
This keeps false-positive interventions out of production and makes enforcement an evidence-based
decision, not a guess.

---

## Guardrail catalog

Each guardrail reads one or more detector signals (analytics.md) and maps a threshold breach to a
default action.

| Guardrail              | Signal source (detector)                  | Default action                         |
| ---------------------- | ----------------------------------------- | -------------------------------------- |
| **Loop**               | repeated-tool / redundant-observation     | inject reminder → (escalate) terminate |
| **Retry storm**        | malformed-retries / model-quality metrics | inject reminder → pause                |
| **Context exhaustion** | context-growth (Context Meter)            | suggest/trigger summarization          |
| **Oscillation**        | momentum (down-trend) / phase thrash      | recommend strategy change              |
| **No-progress streak** | progress / momentum                       | inject reminder → pause                |

Thresholds and the signal→guardrail weighting are **configurable, not hardcoded** — consistent
with how behavioral-score weights are configurable in analytics.md.

---

## Actions

Ordered by severity; soft actions keep the Run going, hard actions require explicit opt-in and high
thresholds.

- **inject reminder** _(soft)_ — add a system message to the loop ("you have called `read_file` on
  this path 4× with identical results; change approach").
- **recommend strategy change** _(soft)_ — a stronger, more specific nudge.
- **suggest / trigger summarization** _(soft)_ — **delegates to the Context Meter's compaction**
  (context-management.md); guardrails do not reimplement compaction, they invoke it.
- **pause** _(hard)_ — halt the Run pending human input; the MR execution lock (PA §5) is held or
  released per policy.
- **terminate** _(hard)_ — end the Run and record why.

Any action that writes outward (a GitLab note, an approval hold) goes through the platform's
**guarded write path** (PA §5), not a direct call.

---

## Integration

- **Attachment** — a guardrail middleware in the agent loop, alongside existing middlewares
  (PA §4). It observes detector output between steps (`Detector.flush`, analytics.md) and may act
  before the next LLM call.
- **New event types** — `guardrail_evaluated`, `guardrail_fired`, `guardrail_action` flow on the
  **existing** Event stream (PA §3/§7); they are _new event types on the canonical stream_, not a
  new stream. They are registered in the canonical
  [Event Model](./event-model.md) catalog. Analytics can then measure guardrails like anything else
  (fire rate, false-positive rate once outcomes are known).
- **Configuration** — per guardrail: `{ mode, threshold, action, cooldown }`, plus a global
  kill-switch. Cooldown prevents an intervention from re-firing every step.

---

## Relationships

- **Consumes** — Detectors + Event stream (analytics.md, PA §3).
- **Uses** — Context Meter compaction (context-management.md) for the summarization action.
- **Surfaces** — the **Needs-Attention** indicator to the product surface
  ([Dashboard](../5-product/dashboard.md)); guardrail events feed analytics' detector/dashboard views.
- **Respects** — the execution model (PA §5): intervention happens at the agent-node loop
  boundary, under the same MR execution lock; execution otherwise stays unaware of guardrails.

---

## Incremental rollout

1. **Shadow + Needs-Attention** — all guardrails in `shadow`; emit would-fire events; surface the
   indicator. Pure observability; validates thresholds against real Runs. _(Ships first.)_
2. **Soft actions** — promote validated guardrails to `active` with soft actions only (reminder,
   strategy nudge, summarization). The Run always continues.
3. **Hard actions** — opt-in `pause` / `terminate` for the guardrails where soft actions proved
   insufficient, behind conservative thresholds.

Each phase is independently deployable and delivers value before the next — matching the
platform's incremental principle (PA §2.9).

---

## Open questions

- **Pause hand-off** — where does a paused Run go: wait for a human comment, auto-resume after a
  timeout, or surface a resume control? (Ties into review-replies.md's human-in-the-loop.)
- **Per-workflow vs global thresholds** — do deep-tier reviews (PA §6.8) tolerate more
  reasoning-without-progress than trivial ones?
- **Retry legitimacy** — distinguishing a retry _storm_ from a healthy retry sequence before the
  Retry-storm guardrail acts.
- **Interaction ordering** — if Context-exhaustion (summarize) and Loop (terminate) fire on the
  same step, which wins? (Proposed: soft actions run before hard; summarize before terminate.)
