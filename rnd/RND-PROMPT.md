# langgraph-harness — R&D Prompt

This is the **permanent R&D prompt** for langgraph-harness. Every future architecture discussion starts here.
The workflow is deliberately boring: you never re-derive the platform — you **extend a stable,
canonical foundation** ([`3-architecture/platform-architecture.md`](./3-architecture/platform-architecture.md)).

---

## The prompt (copy this to start a session)

```
Model: GPT-5.5

Architecture (canonical, read first):
  rnd/3-architecture/platform-architecture.md

Task:
  Design a new subsystem: <NAME / capability>.

Constraints:
  - Extend the existing architecture (attach to a declared extension point; don't add a new pillar).
  - Preserve terminology (Thread, Run, Event, Workflow, Artifact and all §3 concepts are DEFINED
    in Platform Architecture — reference them, never redefine them: write "See Platform Architecture").
  - Don't redesign existing systems (consume them; delegate rather than reimplement).
  - Build incrementally (define phases; the first must be shippable on its own — prefer a
    shadow/observe-only rung before any enforcement or write path).

Output:
  A single subsystem document in the house style (see "Output contract" below).
```

---

## Output contract

Every subsystem doc produced by this prompt must:

1. **Start with a domain banner** — one blockquote stating (a) the _single domain_ the doc owns,
   (b) that shared concepts are defined in Platform Architecture (link `§3`), and (c) the
   boundaries with adjacent subsystems. End it with _"See Platform Architecture."_
2. **Reference, never redefine.** No doc other than `platform-architecture.md` defines _Thread,
   Run, Event, Workflow, Artifact_. If a concept must change, change it **in Platform Architecture
   first**; downstream inherits it.
3. **Follow the section shape:** Purpose · Position in the platform (what it extends / must not
   violate) · Responsibilities · Relationships · Incremental rollout (phased) · Open questions.
4. **Close the governance loop** — add a pointer from Platform Architecture (its §6 subsystem list
   and/or §8 Extension Points) back to the new doc, so it is discoverable from the centerpiece.
5. **Land in the right folder:**
   - a **subsystem** (a concrete capability) → `4-subsystems/`
   - a **cross-cutting framework/model** (execution, events, data, detectors, metrics, guardrails)
     → `3-architecture/`
   - a **product/UX** surface → `5-product/`

## Documentation structure (governed by this prompt)

```
rnd/
  RND-PROMPT.md                         ← you are here (the only prompt you use)
  2-plan/      PRD.md · implementation-plan.md
  3-architecture/
    platform-architecture.md            ⭐ CANONICAL — the foundation everything extends
    execution-model.md · event-model.md · data-model.md
    detector-framework.md · metrics-catalog.md · runtime-guardrails.md
  4-subsystems/  analytics · context-management · git-management ·
                 code-intelligence · code-editing · memory-layer · review-replies
  5-product/     dashboard · analytics-ui · workflows · memories
```

## Why this is the only prompt

The repository documents a **target architecture**, not a running implementation. Once the
foundation (`platform-architecture.md`) is canonical and each subsystem owns exactly one domain,
adding a capability — Runtime Guardrails, Repository Indexing, Dashboard UX — is an act of
_extension_, not reinvention. Keeping every session on this one prompt is what makes the docs a
long-term asset instead of a pile of design notes: the foundation stays stable, the terminology
stays single-sourced, and each new subsystem plugs into a known set of extension points.

> **Worked example:** [`3-architecture/runtime-guardrails.md`](./3-architecture/runtime-guardrails.md)
> was produced with this prompt — it extends §6.6, preserves terminology, consumes Detectors/Events
> without redesigning them, and ships shadow-mode first.
