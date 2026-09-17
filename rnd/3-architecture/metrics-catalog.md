# langgraph-harness — Metrics Catalog

> **Domain owned by this document:** the **flat, authoritative catalog** of every metric and KPI —
> name → definition → unit → source. It is the single place a metric's _meaning_ is pinned down;
> the [Behavioral Observability](../4-subsystems/analytics.md) subsystem _uses_ these, the
> [Detector Framework](./detector-framework.md) _produces_ the signals behind them.
>
> **Shared concepts are not redefined here.** _Run_, _Event_ → **[Platform Architecture → §3](./platform-architecture.md#3-core-concepts)**.
> See Platform Architecture.
>
> **Architecture, not implementation.** Definitions and sources — not query code or storage.

---

## Layers

```
Events ──▶ per-Run raw metrics (RunSummary) ──▶ aggregate KPIs (across Runs)
Events ──▶ detector signals ──────────────────▶ behavioral-quality KPIs + scores
```

A metric is defined **once**, here. Two rules: every metric names its **source** (an event type,
the Context Meter, or a detector), and every metric names its **unit**. Aggregate KPIs are always
derived from per-Run metrics or detector signals — never measured independently.

## Per-Run raw metrics (`RunSummary`)

One record per Run; the substrate for all aggregation.

| Metric                                              | Definition                                 | Unit     | Source                               |
| --------------------------------------------------- | ------------------------------------------ | -------- | ------------------------------------ |
| `durationMs`                                        | wall-clock of the Run                      | ms       | `run_started`→`run_finished`         |
| `success`                                           | Run reached `Completed`                    | bool     | `run_finished.outcome`               |
| `llmCalls`                                          | model invocations                          | count    | `ai_message`                         |
| `toolCalls`                                         | tool invocations                           | count    | `tool_call`                          |
| `uniqueTools`                                       | distinct tools used                        | count    | `tool_call`                          |
| `repeatedToolCalls`                                 | calls with equivalent args to a prior call | count    | `tool_call` (repeated-tool detector) |
| `malformedRetries`                                  | malformed tool-call recoveries             | count    | `model_retry`                        |
| `checkpoints`                                       | checkpoints written                        | count    | `checkpoint`                         |
| `promptTokens` / `completionTokens` / `totalTokens` | tokens in/out/total                        | tokens   | Context Meter / `ai_message`         |
| `maxContextSize`                                    | peak context in the Run                    | tokens   | Context Meter (`RunContextSnapshot`) |
| `estimatedCost`                                     | approx. cost (hosted providers)            | currency | derived from tokens (optional)       |

## Detector-derived signals

Per-Run signals from the [Detector Framework](./detector-framework.md), feeding the behavioral
dimensions (Efficiency · Progress · Stability · Waste · Confidence).

| Signal                | Definition                      | Unit      | Source detector       |
| --------------------- | ------------------------------- | --------- | --------------------- |
| novelty               | new information per observation | score 0–1 | Novelty               |
| momentum              | progress-vs-stagnation trend    | score     | Momentum              |
| waste                 | unnecessary work                | score     | Waste                 |
| progressInterval      | events between progress markers | count     | Progress              |
| redundantObservations | re-observed information         | count     | Redundant-Observation |
| oscillation           | back-and-forth / phase thrash   | rate      | Momentum / Phase      |

## Aggregate KPIs

Computed across Runs (per workflow, model, prompt, or version — the benchmarking axes).

**Reliability**

| KPI                                | Definition                       | Unit | Derived from           |
| ---------------------------------- | -------------------------------- | ---- | ---------------------- |
| success rate / failure rate        | share of Runs completed / failed | %    | `success`              |
| avg / median / P95 completion time | completion-time distribution     | ms   | `durationMs`           |
| human-intervention rate            | Runs needing a human             | %    | pause events / outcome |
| manual-retry rate                  | Runs re-triggered by hand        | %    | trigger metadata       |

**Efficiency**

| KPI                                                     | Definition       | Unit              | Derived from                      |
| ------------------------------------------------------- | ---------------- | ----------------- | --------------------------------- |
| avg LLM calls / tool calls / unique tools / checkpoints | mean per Run     | count             | `RunSummary`                      |
| avg tokens per Run / avg cost per Run                   | mean per Run     | tokens / currency | `totalTokens` / `estimatedCost`   |
| avg context growth                                      | mean peak/growth | tokens            | `maxContextSize` / `ContextDelta` |
| avg LLM latency / tool latency                          | mean latencies   | ms                | `ai_message` / `tool_result`      |

**Behavioral Quality**

| KPI                                                          | Definition          | Unit  | Derived from |
| ------------------------------------------------------------ | ------------------- | ----- | ------------ |
| repeat-tool / observation-reuse / redundant-observation rate | wasteful repetition | %     | detectors    |
| loop / oscillation rate                                      | looping / thrash    | %     | detectors    |
| mean progress interval / longest no-progress streak          | progress cadence    | count | Progress     |
| avg novelty / momentum / waste                               | mean signals        | score | detectors    |

**Model Quality**

| KPI                      | Definition                 | Unit | Derived from                |
| ------------------------ | -------------------------- | ---- | --------------------------- |
| malformed-tool-call rate | share of calls malformed   | %    | `model_retry` / `tool_call` |
| retry-recovery rate      | malformed calls recovered  | %    | `model_retry`               |
| invalid-argument rate    | calls with bad args        | %    | `tool_result.err`           |
| tool success ratio       | successful tool executions | %    | `tool_result`               |

**Insights** (rankings & trends, not point metrics): most-used tools, most expensive /
highest-context-growth / highest-waste / longest-running workflows, most common detector findings,
phase distribution, and any of the above trended over time.

## Benchmarking axes

Every aggregate KPI can be sliced by **model**, **prompt**, **tool implementation**, or **workflow
version** — this is what turns the catalog into an evaluation framework
([Behavioral Observability](../4-subsystems/analytics.md)).

## Extension points

- **New raw metric** — add a row with its source event; aggregates that reference it follow.
- **New KPI** — define it here as a function of existing raw metrics/signals; do not measure it
  independently.
- **New benchmarking axis** — a new slice dimension; no metric definitions change.

## Related models

Sources: [Event Model](./event-model.md), [Detector Framework](./detector-framework.md), and the
Context Meter ([Context Management](../4-subsystems/context-management.md)). Persisted shapes:
[Data Model](./data-model.md).
