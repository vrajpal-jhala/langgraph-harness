# langgraph-harness — Detector Framework

> **Domain owned by this document:** the **reusable contract for detectors** — the interface, the
> lifecycle, how they read events and emit signals, how signals roll into behavioral scores, and
> the rules that keep them isolated from execution. It is the _framework_; the concrete detector
> **catalog** lives in [Behavioral Observability](../4-subsystems/analytics.md).
>
> **Shared concepts are not redefined here.** _Event_, _Run_, _Detector_ are defined in
> **[Platform Architecture → §3](./platform-architecture.md#3-core-concepts)**. See Platform
> Architecture.
>
> **Architecture, not implementation.** The interface below is the contract every detector honors,
> not a concrete class or plugin loader.

---

## What a detector is

A **detector** turns the raw [event stream](./event-model.md) into a higher-level behavioral
signal. Detectors are **derived and read-only**: they consume events and produce signals; they
never influence execution. (Acting on a signal is the job of
[Runtime Guardrails](./runtime-guardrails.md), a separate layer.)

## The contract

```
interface Detector {
  onEvent(event: Event): void      // fed each event in seq order (Event Model)
  flush(): DetectorResult          // called at step boundaries / Run end → current signal
}

DetectorResult {
  detector   name
  signals    { dimension → value }   // contributions to behavioral dimensions
  findings?  [ { kind, evidence } ]  // optional, explainable specifics
}
```

Rules every detector must obey:

1. **Read-only.** No writes, no tool calls, no execution side effects.
2. **Event-sourced.** State is built only from events (Event Model), so a detector is fully
   determined by the stream and can be replayed.
3. **Idempotent on `(runId, seq)`.** Delivery is at-least-once; re-seeing an event must not
   double-count.
4. **Independent.** A detector never depends on another detector's output — only on events.
5. **Explainable.** A signal should carry the evidence that produced it (which events), so findings
   are auditable, not opaque scores.

## Lifecycle

```
Run starts ─▶ detector instantiated (per Run)
   each Event ─▶ onEvent()          [accumulate]
   step / Run boundary ─▶ flush()   [emit current signal]
Run ends ─▶ final flush ─▶ contributes to RunSummary + KPIs (Metrics Catalog)
```

Detectors are **per-Run** instances so state never leaks across Runs. Their outputs feed the
[Metrics Catalog](./metrics-catalog.md) (aggregate KPIs) and, when enabled,
[Runtime Guardrails](./runtime-guardrails.md).

## Registration (plugin model)

- Detectors register as **plugins** into the observability layer, not into any workflow — execution
  stays unaware of them (Platform Architecture §2.2).
- The active set is configuration, not code changes to workflows: enabling/disabling a detector
  changes what is measured, never what executes.
- A new detector ships without touching the Execution Model or any agent.

## Behavioral scores

Detector signals contribute, with **configurable weights**, to a small set of dimensions rather
than one opaque health number:

```
Efficiency · Progress · Stability · Waste · Confidence
```

A detector declares which dimension(s) it feeds and by how much; weights are configuration, not
hardcoded. The concrete detectors (repeated-tool, novelty, momentum, waste, phase inference, …) and
their default weightings are catalogued in [Behavioral Observability](../4-subsystems/analytics.md).

## Framework vs catalog (the boundary)

- **This document** = the contract (interface, lifecycle, rules, scoring model). Stable.
- **[Behavioral Observability](../4-subsystems/analytics.md)** = the catalog of concrete detectors
  and what each measures. Grows over time.

Adding a detector = implement the contract + register + declare score contribution. No framework
change is needed until the _contract itself_ must change — and that change lands here first.

## Extension points

- **New detector** — implement `onEvent`/`flush`, register, declare dimension weights.
- **New behavioral dimension** — added to the scoring model here; detectors opt in.
- **New consumer of signals** — e.g. a new guardrail; consumes `DetectorResult`, adds no coupling.

## Related models

Input vocabulary: [Event Model](./event-model.md). Aggregated outputs:
[Metrics Catalog](./metrics-catalog.md). Enforcement built on signals:
[Runtime Guardrails](./runtime-guardrails.md).
