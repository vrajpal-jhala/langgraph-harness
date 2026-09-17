# langgraph-harness — Dashboard UX

> **User-facing surface.** The at-a-glance operator overview — health, cost, and what needs
> attention. Presentation only: it **references architecture, adds none.**
>
> Concepts → **[Platform Architecture → §3](../3-architecture/platform-architecture.md#3-core-concepts)**.
> Every number is defined in the [Metrics Catalog](../3-architecture/metrics-catalog.md); this
> surface **displays**, it does not define or compute metrics. Read-only.

---

## Who it's for

The **tech lead / engineering manager** (is langgraph-harness healthy and worth the spend?) and the
**on-call / operator** (is anything wrong right now?). It answers "how is the platform doing"
in one screen and routes to detail.

## Layout

A single scannable board, top-to-bottom by urgency:

### 1. Needs-Attention queue (top)

Runs currently `Paused` or flagged by a fired guardrail
([Runtime Guardrails](../3-architecture/runtime-guardrails.md)). Each entry links straight to the
[Run timeline](./workflows.md). Empty by default is the healthy state and should read as calm, not
blank. Shadow-mode would-fires appear here muted, as "watch" items, not alerts.

### 2. Reliability tiles

Headline KPIs (Metrics Catalog → Reliability): **success rate**, **median** and **P95 completion
time**, **human-intervention rate**. Each tile shows the current value and a sparkline trend.

### 3. Efficiency & cost tiles

Metrics Catalog → Efficiency: **avg tokens / Run**, **avg cost / Run**, **avg tool calls**, **avg
context growth**. This is the "what is it costing us" row.

### 4. Behavioral health

Metrics Catalog behavioral signals as trend lines: **waste**, **momentum**, **novelty**,
**progress** over time, plus **detector frequency** (which detectors fire most —
[Detector Framework](../3-architecture/detector-framework.md)). Shows whether Runs are getting
healthier or looping more.

### 5. Activity

Recent Runs (a compact slice of the [Workflows](./workflows.md) list) so the operator can drop into
any live or recent Run.

## Interactions

- **Time range** selector (today / 7d / 30d) rescopes every tile and trend.
- **Slice** by repo / workflow (a light version of the full slicing in
  [Analytics UX](./analytics-ui.md)).
- **Drill down** — every tile and queue item links to its detail (a Run timeline, or the analytics
  view for that KPI).
- **Threshold coloring** — tiles use the platform's status bands (e.g. the Context Meter's
  green/yellow/orange/red) so "bad" is visible without reading numbers.

## States

- **Healthy / calm** — empty Needs-Attention, tiles green. The default; designed to look
  reassuring, not empty.
- **Attention** — one or more queue items; the section draws the eye.
- **Insufficient data** — early on, tiles show "not enough Runs yet" rather than misleading zeros.

## Data sources (read-only)

| Section            | From                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Needs-Attention    | [Runtime Guardrails](../3-architecture/runtime-guardrails.md)                                                        |
| all tiles & trends | [Metrics Catalog](../3-architecture/metrics-catalog.md) via [Behavioral Observability](../4-subsystems/analytics.md) |
| detector frequency | [Detector Framework](../3-architecture/detector-framework.md)                                                        |
| activity           | [Workflows](./workflows.md) (Run list)                                                                               |

## Relationship to other product surfaces

The Dashboard is the **entry point**: it surfaces _what_ and routes to _why_. Deep exploration and
benchmarking is [Analytics UX](./analytics-ui.md); a single Run is [Workflows](./workflows.md).
