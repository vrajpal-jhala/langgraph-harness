# langgraph-harness — Behavioral Observability

> **Domain owned by this document:** behavioral observability — the **metrics, detectors, KPIs,
> and guardrails derived from the execution event stream**. Nothing else.
>
> **Shared concepts are not redefined here.** _Event_, _Run_, _Workflow_, and _Artifact_ are
> defined in **[Platform Architecture → §3 Core Concepts](../3-architecture/platform-architecture.md#3-core-concepts)**.
> This document references them. See Platform Architecture.

Behavioral observability is a **derived layer**: it consumes the event stream that every Run
already emits (see Platform Architecture) and turns it into measurement. Execution stays unaware
of analytics — no workflow carries analytics logic and no extra instrumentation is added.

The goal is not merely to detect failures but to measure **how agents behave over time**, which
enables workflow KPIs, benchmarking of models/prompts/tools/workflow-versions, and optional
runtime intervention. The same analytics stay valuable across any model (Qwen, GPT-5, Claude, or
future frontier models).

```
Event stream  (owned by Platform Architecture)
      │
      ▼
Metrics  →  Detectors  →  KPIs & Insights  →  { Dashboard · optional Guardrails }
```

Each layer builds on the previous. The design principle in one line:

> **Events describe what happened · Metrics quantify it · Detectors explain it · KPIs measure
> how well it happened · Guardrails optionally influence what happens next.**

---

## Metrics

The first layer transforms raw events into structured per-Run metrics.

```ts
interface RunSummary {
  durationMs: number;
  success: boolean;
  llmCalls: number;
  toolCalls: number;
  uniqueTools: number;
  repeatedToolCalls: number;
  malformedRetries: number;
  checkpoints: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxContextSize: number;
  estimatedCost?: number;
}
```

These summaries are the foundation for dashboards, historical analysis, and threshold
calibration. (Token/context figures originate from the Context Meter — see
[Context Management](./context-management.md).)

---

## Detectors

Detectors consume the event stream and derive higher-level signals. They are independent of the
runtime and register as **plugins**.

```ts
interface Detector {
  onEvent(event: RunEvent): void;
  flush(): DetectorResult;
}
```

**Analytics detectors measure behaviour only — they never influence execution.**

| Detector                  | What it surfaces                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repeated Tool**         | Same tool executed with equivalent arguments.                                                                                                                                                     |
| **Redundant Observation** | A tool returns information already observed (compares name + normalized args + normalized output) — the agent is rediscovering, not progressing.                                                  |
| **Novelty**               | How much _new_ information each observation contributes (new files/code/search results = high; repeated reads = low).                                                                             |
| **Progress**              | Meaningful progress events: checkpoint created, artifact generated, GitLab comment created, issue resolved, file modified, workflow completed.                                                    |
| **Momentum**              | Whether execution is progressing or stagnating — cumulative signal; healthy runs trend up, looping runs trend down.                                                                               |
| **Waste**                 | Unnecessary work: repeated calls, redundant observations, retries, reasoning without progress. A high-level quality metric.                                                                       |
| **Phase Inference**       | Labels semantic phases from observed behaviour (_Context Gathering_ → _Repository Exploration_ → _Reporting_) **without** adding graph nodes. Phases are analytical labels, not execution stages. |
| **Context Growth**        | Rapid context expansion, unusually large histories, excessive token accumulation (fed by the Context Meter).                                                                                      |

**Behavioral scores.** Rather than one health score, several dimensions — **Efficiency,
Progress, Stability, Waste, Confidence** — each fed by weighted detector signals. Weights are
configurable, not hardcoded.

---

## KPIs & Insights

Detectors and metrics roll up into actionable KPIs.

- **Reliability** — success/failure rate, average & median completion time, P95, human
  intervention rate, manual retry rate.
- **Efficiency** — avg LLM calls, tool calls, unique tools, checkpoints, tokens per run, cost
  per run, context growth, LLM latency, tool latency.
- **Behavioral Quality** — repeat-tool rate, observation-reuse rate, redundant-observation rate,
  retry rate, loop rate, oscillation rate, mean progress interval, longest no-progress streak,
  avg novelty / momentum / waste.
- **Model Quality** — malformed-tool-call rate, retry-recovery rate, invalid-argument rate, tool
  success ratio, successful tool-execution rate.
- **Insights** — most-used tools, most expensive / highest-context-growth / highest-waste /
  longest-running workflows, most common detector findings, phase distribution, detector trends.

### Benchmarking

The primary payoff of behavioral observability is **objective comparison** — analytics as an
_evaluation framework_, not just a debugging aid. Compare execution characteristics across:

- **Models** — which has the lowest waste, fewest tool calls, fewest retries, highest novelty?
- **Prompts** — efficiency, stability, cost, behavioral quality across revisions.
- **Tool implementations** — latency, failure rate, observation reuse, downstream efficiency.
- **Workflow versions** — did a change actually reduce cost/retries/waste/time or raise momentum?

### Dashboard

- **Workflow overview** — success rate, duration, cost, token usage, tool usage.
- **Behavioral health** — waste / momentum / novelty / progress trends, detector frequency.
- **Tool analytics** (per tool) — usage frequency, latency, failure rate, retry rate, novelty
  contribution, observation reuse.
- **Detector analytics** — detectors ranked by frequency (Repeated Tool, Redundant Observation,
  Context Growth, Momentum, Waste), showing where engineering effort should go.

---

## Guardrails (optional)

Guardrails may consume detector output to intervene **during** execution. Analytics remain fully
useful with guardrails disabled — intervention is additive, never a prerequisite.

- **Triggers** — loop detection, retry-storm detection, context exhaustion, oscillation,
  excessive no-progress streaks.
- **Actions** — inject a reminder, recommend a strategy change, suggest summarization, pause, or
  terminate execution.

---

## Future direction

Detectors evolve into first-class, reusable platform components rather than heuristics embedded
in workflows. The insights they produce may eventually power live nudges, automated guardrails,
and workflow/prompt/model optimization — while the execution engine stays generic and
observability improves independently.
