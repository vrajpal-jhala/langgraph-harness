# langgraph-harness — Memory Layer (supermemory)

> **Domain:** the durable memory layer (supermemory) only. **Shared concepts** (_Thread_, _Run_,
> _Event_, _Workflow_, _Artifact_) are canonical in **[Platform Architecture → §3](../3-architecture/platform-architecture.md#3-core-concepts)**;
> the memory subsystem overview and the committed-backend decision are in
> [§6.3](../3-architecture/platform-architecture.md#63-memory-layer-supermemory) and
> [§10 Decision 3](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts).
> This document is the detailed design; it references, not redefines, those. See Platform Architecture.

Status: Design / pre-implementation
Scope: turning MRs / issues / bugs into durable, retrievable context so reviews compound into institutional memory. This is its own layer — **not** code intelligence (repowise) and **not** code editing (serena); it stores and recalls what those produce, plus MR/issue/discussion context.
Related: `code-intelligence.md` (the review engine that emits most of the raw material) · `code-editing.md` (the dev agent).

> This layer is **backend-agnostic**. The design below specifies _what_ to capture and _how_ it flows; the storage backend is a swappable decision (Section 2). Phase 1 can ship without it.

> **v1 scope** ([PA §10 Decision 5](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts)):
> v1 is exactly the context-record flow below — build records, retrieve by structural overlap
> (files/symbols) + semantic similarity, backfill outcomes. The temporal entity graph and full
> fact-extraction pipeline (PA §6.3) are **future scope**, promoted once extraction quality is
> proven on real data.

---

## 1. Why this layer

A one-off review answers "is this MR risky?" and forgets. This layer records each review's findings so the _next_ agent recalls "this area was risky before, here's the prior decision, the owner, the linked issue" instead of re-deriving it. Over time it also calibrates the router's risk thresholds from real outcomes.

---

## 2. Memory backend — supermemory self-hosted (chosen)

**supermemory self-hosted (MIT)** is the chosen backend. Verified against primary docs/repo:

- Self-hostable binary is **free and open-source (MIT)** — not enterprise-gated.
- Runs **fully offline**: ships its own embedded graph engine + local embeddings, optional **Ollama** — honors langgraph-harness's no-external-calls rule.
- All data lives in a single **`./.supermemory`** directory (easy to back up/move).
- The free tier is **single-tenant** (one API key, one org) — sufficient for langgraph-harness's internal single-system use. Only multi-member orgs, roles, scoped keys, and managed SaaS connectors are Enterprise-gated, and langgraph-harness needs none of them.

Trade-off to be aware of: supermemory runs its **own embedded store** (a separate datastore to operate/back up — trivial given the single directory), rather than reusing langgraph-harness's existing Postgres + pgvector. Batteries-included memory features (fact extraction, contradiction handling, forgetting, graph) come with it.

Alternatives, only if you'd rather reuse existing infra than run a separate memory service: **mem0** (Apache-2.0, self-hosts on Postgres+pgvector), **raw pgvector** (own it), **Zep CE** (temporal knowledge graph, if time-aware recall matters). The rest of this doc references the backend abstractly as "the memory store," so any of these drops in.

---

## 3. What to capture, and the tools that produce it

For each MR / issue / bug, assemble a structured **context record** from:

- **Change shape** — GitLab MCP (`get_merge_request`, `*_diffs`, `list_merge_request_changed_files`) → changed files; repowise diff-mapping → affected symbols.
- **Behavioral signals** — repowise `get_risk` (dependents, will_break / missing_tests / hidden_coupling), `get_health` (hotspot/health), ownership + co-change.
- **Rationale** — repowise `get_why` (git/comment/ADR mining) + GitLab MR discussion (`list_merge_request_notes` / `mr_discussions`) + linked issues (`get_issue`, `list_issue_links`).
- **Outcome** — merged / reverted-later / review verdict, backfilled from GitLab events.

---

## 4. Context record (shape, not final schema)

```
context_record
  source        mr | issue | bug | adr
  repo, ref/sha
  files[], symbols[]
  signals       jsonb  (risk score, will_break, hotspots, ownership, co-change)
  rationale     text   (why + discussion summary)
  linked_issues []
  outcome       enum   (filled in post-merge)
  summary       text   ← embedded by the memory store on ingest
  created_at
```

This is the logical payload you ingest into the memory store; with supermemory the store handles embedding/indexing for you (you ingest text + metadata and query its API). Keep `files[]` / `symbols[]` as metadata for exact structural lookup _and_ the natural-language `summary` for semantic recall — you'll query both ways.

---

## 5. Ingestion & retrieval flow

```
MR/issue/bug ─▶ context-builder agent
                 gather (GitLab MCP + repowise) ─▶ build record ─▶ memory store

new MR ─▶ retrieve: overlapping files/symbols (structural)
                  + semantic similarity (embedding)
       ─▶ surface prior risk / decisions / owners to the reviewer

post-merge event ─▶ backfill outcome ─▶ improves future retrieval + router thresholds
```

- **Ingestion:** a dedicated context-builder agent (or a post-review step) gathers the fields above and writes one record per event.
- **Retrieval:** on a new MR, match overlapping files/symbols (exact) + semantic similarity (embedding); inject the top matches as context for the reviewer.
- **Feedback:** when the MR merges/reverts, backfill `outcome`; this both sharpens future retrieval and feeds the router's threshold calibration (PA §6.8).

---

## 6. Decisions / ADRs

For choices with supersession chains: author the ADR via repowise's ADR capability _and_ mirror the record into the memory store. The durable, queryable copy stays yours (survives repowise index rebuilds), while repowise keeps the supersession graph.

---

## 7. Open questions

- Record retention / aging policy.
- How outcome backfill is wired from GitLab merge/revert webhook events.
- Whether semantic recall here replaces the need for repowise's own embedding layer (mirrored in `code-intelligence.md` §5).
