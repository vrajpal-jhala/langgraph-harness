# langgraph-harness — Analytics UX

> **User-facing surface.** Deep exploration and **benchmarking** of behavioral analytics — the
> "why" and "which is better" behind the [Dashboard](./dashboard.md)'s headline numbers.
> Presentation only: it **references architecture, adds none.**
>
> Every metric shown is defined in the [Metrics Catalog](../3-architecture/metrics-catalog.md);
> the signals behind them come from the [Detector Framework](../3-architecture/detector-framework.md).
> This surface **explores** them — it defines no metrics. Concepts →
> **[Platform Architecture → §3](../3-architecture/platform-architecture.md#3-core-concepts)**. Read-only.

---

## Who it's for

The **tech lead** deciding whether a change helped, and whoever tunes prompts/models/tools. Where
the Dashboard says _what_, this surface answers _why_ and _which option is better_.

## Views

### 1. Benchmarking (the primary view)

Compare any KPI across the four benchmarking axes (Metrics Catalog): **models · prompts · tool
implementations · workflow versions**.

- Pick an **axis** and a **metric** (e.g. _waste_ by model, _avg cost_ by prompt revision, _P95
  time_ by workflow version).
- Side-by-side comparison with significance/sample-size shown, so a difference on 3 Runs isn't
  read as a trend.
- This is what makes analytics an _evaluation framework_, not just charts — the view is built for
  "did version B actually beat A?"

### 2. Trends

Any metric over time, sliced by repo / workflow / axis. Annotated with releases (a prompt/model
version change marks the timeline) so a shift can be tied to a cause.

### 3. Tool analytics

Per tool: usage frequency, latency, failure rate, retry rate, **novelty contribution**, and
observation reuse. Answers "which tools earn their place and which are waste."

### 4. Detector analytics

Detectors ranked by frequency and by dimension impact (Efficiency / Progress / Stability / Waste /
Confidence). Shows where behavior degrades and where engineering effort should go. Clicking a
detector lists the Runs where it fired → [Workflows](./workflows.md).

## Interactions

- **Slice & filter** — axis, time range, repo, workflow, tier.
- **Compare** — pin two or more slices (model A vs B, prompt v3 vs v4) for direct diff.
- **Drill to Runs** — any point/bar links to the underlying Runs (the timeline view), so an
  aggregate always traces back to concrete evidence.
- **Explainability** — a metric tile links to its Metrics-Catalog definition; a detector links to
  its Detector-Framework contract. No opaque numbers.

## States

- **Insufficient sample** — comparisons below a sample threshold are labelled, not plotted as if
  conclusive.
- **No variation** — if there's only one model/prompt/version, benchmarking degrades gracefully to
  a single-series trend.

## Data sources (read-only)

| View                       | From                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| benchmarking, trends, KPIs | [Metrics Catalog](../3-architecture/metrics-catalog.md) via [Behavioral Observability](../4-subsystems/analytics.md) |
| detector analytics         | [Detector Framework](../3-architecture/detector-framework.md)                                                        |
| drill-through              | [Workflows](./workflows.md) (Run timelines) · [Event Model](../3-architecture/event-model.md)                        |

## Relationship to other product surfaces

The [Dashboard](./dashboard.md) surfaces headline KPIs; this surface is where you _interrogate_
them and compare options. Both bottom out in the same per-Run evidence shown in
[Workflows](./workflows.md).
