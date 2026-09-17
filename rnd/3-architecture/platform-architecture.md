# langgraph-harness — Platform Architecture

> ## 🔒 Canonical status
>
> **This is the canonical architecture of langgraph-harness.** It is the single source of truth for the
> platform's structure, concepts, and cross-cutting decisions. Every other document — current
> and future — **assumes this document exists** and defers to it.
>
> **Do not redefine the core platform concepts elsewhere.** These are owned here, in
> [§3 Core Concepts](#3-core-concepts):
>
> | Concept      | Canonical definition   |
> | ------------ | ---------------------- |
> | **Thread**   | [§3](#3-core-concepts) |
> | **Run**      | [§3](#3-core-concepts) |
> | **Event**    | [§3](#3-core-concepts) |
> | **Workflow** | [§3](#3-core-concepts) |
> | **Artifact** | [§3](#3-core-concepts) |
>
> When another document needs one of these (or any concept in §3), it must **reference, not
> redefine** — write _"See Platform Architecture"_ (linking here) instead of restating the
> definition. A subsystem doc describes _its own_ mechanics and links back here for shared terms.
> If a concept genuinely needs to change, change it **here** first; downstream docs inherit it.

> **Provenance.** This document consolidates the langgraph-harness vision deck, the Engineering Context
> Platform PRD, the target system architecture, and the subsystem designs (context management,
> repository/git management, review replies, behavioral analytics, code intelligence, code
> editing, and the memory layer). It is a _reference_, not a redesign: overlapping sources were
> merged and each concept is explained once; where a newer, more comprehensive proposal clearly
> superseded an older one, the newer decision is canonical and the supersession is noted; genuine
> conflicts were surfaced rather than invented away — the four that arose were settled in review
> and recorded in **[§10 Architectural Decisions](#10-architectural-decisions-resolved-conflicts)**.
> Aspirational material not yet backed by a subsystem proposal is labelled a **future direction**,
> not established architecture.

**Source documents consolidated here**

| Source                               | Role                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `1-present/harness-deck.html`        | Long-term vision and intent (not included in this export)                          |
| `2-plan/PRD.md`                      | Product requirements — capabilities, personas, delivery phases                     |
| `3-architecture/architecture.md`     | Earlier target layered architecture (now superseded — not included in this export) |
| `4-subsystems/context-management.md` | Context domain — surfaces, budget, Context Meter                                   |
| `4-subsystems/git-management.md`     | Git & repository storage/lifecycle                                                 |
| `4-subsystems/review-replies.md`     | Review-reply handling (event-driven & command designs, now superseded)             |
| `4-subsystems/analytics.md`          | Behavioral observability subsystem                                                 |
| `2-plan/implementation-plan.md`      | Ordered engineering build plan                                                     |
| `4-subsystems/code-intelligence.md`  | repowise (code intelligence / review engine)                                       |
| `4-subsystems/code-editing.md`       | serena (read-write dev agent)                                                      |
| `4-subsystems/memory-layer.md`       | supermemory (durable recall)                                                       |

---

## 1. Vision

**langgraph-harness is an Engineering Context Platform: a continuously updated, self-hosted
institutional memory that makes historical decisions, system relationships, and engineering
context discoverable and actionable — and every agent built on top of it context-aware.**

The name captures the intent: _sync · nexus · the shared engineering brain_.

The core bet is that most developer-productivity tools fail because each agent operates in
isolation. An MR reviewer that doesn't know why an API exists, a doc generator that doesn't
know what changed and why, a test generator that doesn't know the acceptance criteria — all
produce shallow, low-trust output. The fix is **not better individual agents; it is a shared
knowledge foundation every agent can query and contribute to.**

Engineering teams leak context at every transition: a new developer reverse-engineers the
codebase; a reviewer lacks the requirements behind a change; an incident responder traces
services by hand; a design decision dies in a Slack thread; a sprint's prioritisation
rationale is never recorded. The organisation accumulates code but loses knowledge, and
agents built on that environment inherit the same blindness.

langgraph-harness captures, for every change:

- **What** changed and when — full history across repos, linked to issues/MRs/approvals with temporal metadata.
- **Why** it changed — the issue, user story, discussion, or incident that drove it.
- **Who** decided and approved it — reviewer chains and ownership, with auditability.
- **What alternatives** were considered and rejected.
- **What downstream effects** it had or may have.

Every agent is a **consumer and contributor** of this shared memory. Over time the system
becomes the institutional brain of the engineering organisation.

**What langgraph-harness is and isn't** (from the vision deck, kept verbatim in intent):

- **IS** — a continuously updated engineering knowledge graph; a layer that makes individual
  agents context-aware; a set of _task-triggered_ agents (review, triage, docs, releases);
  self-hosted; accessible via GitLab webhooks, direct API, and a web UI.
- **ISN'T** — a collection of isolated bots; a conversational chat interface for developers;
  an automated deployment/infra-change system; a real-time collaboration tool; an ingester of
  sources beyond GitLab and Figma (v1).

---

## 2. Platform Philosophy & Architectural Principles

The recurring principles across every source document — the constraints every subsystem is
designed to honour. This is the single canonical list; later sections apply these rather than
restating them.

1. **Shared memory over isolated agents.** The differentiator is the memory layer, not any
   single agent. Agents are thin; the foundation is deep.
2. **Layered separation of concerns.** Execution, context assembly, memory, and observability
   are distinct layers that evolve independently. Execution stays generic; observability and
   analytics improve on their own. Analytics is a _derived_ layer over the event stream — the
   workflow code carries no analytics logic.
3. **GitLab (and the local repo) is the source of truth.** langgraph-harness stores minimal metadata and
   fetches live state on demand rather than duplicating discussion or repository state. This
   handles edits, deletions, and force-pushes naturally.
4. **Deterministic scaffolding, LLM only where judgement is needed.** Lifecycle operations
   (clone, fetch, index, worktree management) are deterministic LangGraph nodes or subprocess
   calls — no LLM. The model is entered only at agent/reviewer nodes.
5. **Read-only by default; writes are explicit and guarded.** The reviewer never mutates repo
   contents. The filesystem surface exposed to the LLM is read-only; git is intent-based, not
   raw shell; write paths (comments, edits) go through guardrails. Code _editing_ is a
   separate, deliberately isolated agent (serena) never loaded by the reviewer.
6. **Self-hosted, nothing leaves the org.** All components run inside the organisation's
   infrastructure. No code, artefacts, or decisions leave its control. Local models (Ollama /
   Qwen3.6) and offline-capable memory are preferred; the design stays model-agnostic.
7. **Traceability and auditability.** Every agent claim must reference a source fact — agents
   must not hallucinate relationships. Every stored decision records who and when, and
   historical-state queries are supported.
8. **Observability before enforcement.** Detectors and analytics are valuable purely as
   measurement; runtime intervention (guardrails) is optional and layered on top, never a
   prerequisite.
9. **Incremental and low-friction.** Re-review processes only the delta. New capabilities are
   added without changing the execution model — typically as another trigger or another agent
   reusing shared infrastructure.
10. **Interface stability over implementation.** Higher-level tools expose intent (e.g.
    `find_definition`, `get_context`) so the implementation underneath can evolve
    (filesystem → Tree-sitter/LSP → code graph → repowise) without changing the agent-facing
    contract.

---

## 3. Core Concepts

These are the platform's primitives. Each is defined once here; later sections reference them.

| Concept           | Definition                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workflow**      | A LangGraph _graph_ that performs one kind of work (e.g. the MR-review workflow, the issue-triage workflow). Composed of deterministic lifecycle nodes plus one or more **agent** nodes. Execution is generic and unaware of analytics.                                                                      |
| **Agent**         | An LLM _node_ inside a workflow, with a named toolset (least privilege) — e.g. `mr-reviewer`, `context-builder`, the dev agent. Agents are the units the router activates (§6.8); a workflow contains them, it is not one. Every agent is a consumer and contributor of memory.                              |
| **Thread**        | The persistent LangGraph conversation/state for a long-lived subject. **One thread per Merge Request** is the anchoring rule: every run (initial review or re-review) resumes the same thread, so accumulated repository understanding, prior reasoning, and review decisions are never rebuilt.             |
| **Run**           | A single execution of a workflow against a thread. Runs are the unit of tracing (one Langfuse trace per run) and the unit analytics summarise (`RunSummary`). Only one run per MR executes at a time (MR-level execution lock).                                                                              |
| **Event**         | An item in the LangGraph/LangChain execution stream: run started/finished, node start/end, AI message, tool call, tool result, checkpoint created, model retry, error. The event stream is the single source of truth for observability — no extra instrumentation is added to workflows.                    |
| **Artifact**      | A durable output a run produces: MR description, review comments, an ADR, generated docs, test stubs, a proposed/applied fix. Artifacts are both delivered (to GitLab/Figma) and, where relevant, recorded into memory.                                                                                      |
| **Context**       | Everything assembled into a prompt for one LLM request: system prompt, conversation, memory, retrieval, repository content, tool schemas, tool results, MCP resources, and the current message. Context is measured and managed by the Context Meter and bounded by the Context Budget Manager.              |
| **Memory**        | The durable, queryable layer that turns runs, MRs, issues, incidents, and decisions into retrievable institutional knowledge. Distinct from _code intelligence_ (which analyses code) and _code editing_ (which changes it): memory stores and recalls what those produce, plus MR/issue/discussion context. |
| **Analytics**     | The derived layer that transforms the event stream into metrics, detector findings, KPIs, and insights — for behavioral observability, benchmarking, and (optionally) runtime guardrails.                                                                                                                    |
| **Detector**      | A pluggable analytics component that consumes the event stream (`onEvent` / `flush`) and produces a higher-level signal (e.g. repeated-tool, redundant-observation, novelty, progress, momentum, waste, phase inference, context growth). Detectors are independent of the runtime and register as plugins.  |
| **Insight / KPI** | The actionable output of analytics — reliability, efficiency, behavioral-quality, and model-quality KPIs, plus rankings and trends. Insights feed dashboards, benchmarking, and eventually optimization loops.                                                                                               |

**How they relate**

```
Event  ── describe what happened
  │
  ├─▶ Analytics (Metrics → Detectors → KPIs/Insights) ── explain & measure how well it happened
  │
Run ── one execution of a Workflow against a Thread
  │        │
  │        └─ assembles Context for each LLM request (measured by the Context Meter)
  │        └─ reads/writes Memory; queries code intelligence
  │        └─ produces Artifacts (delivered to GitLab/Figma; recorded to Memory)
  │
Thread ── persists across Runs (one per MR); Checkpoints make Runs resumable
```

- **Events describe** what happened → **Metrics quantify** it → **Detectors explain** it →
  **KPIs measure** how well it happened → **Guardrails optionally influence** what happens next.
- A **Workflow** runs as a **Run** on a **Thread**; each Run assembles **Context**, consults
  **Memory** and code intelligence, emits **Events**, and produces **Artifacts**.

---

## 4. Platform Architecture (Layers)

langgraph-harness is organised as layers that build on one another. Execution sits at the centre; every
other layer either feeds it context or observes what it does.

```
                         Trigger  (GitLab webhook: MR open / push · API)
                                        │
┌───────────────────────────────────────────────────────────────────────┐
│ RUNTIME / EXECUTION  — LangGraph harness                                │
│   deterministic lifecycle nodes → LLM agent node(s) → guarded writes    │
│   Thread per MR · Run per execution · Postgres checkpointer · exec lock │
└───────────────────────────────────────────────────────────────────────┘
        ▲ context in                                    │ events out ▼
┌──────────────────────────┐              ┌──────────────────────────────┐
│ CONTEXT                  │              │ OBSERVABILITY & ANALYTICS     │
│  Code Intelligence       │              │  Context Meter (token accts)  │
│  (repowise)              │              │  Behavioral analytics         │
│  Git mgmt / worktrees    │              │   (event-derived detectors)   │
│  Context Meter + Budget  │              │  LLM Ops (Langfuse, evals)    │
└──────────────────────────┘              └──────────────────────────────┘
        ▲                                              │
┌──────────────────────────┐                          │ insights feed back
│ MEMORY                   │◀─────────────────────────┘  (router thresholds,
│  Procedural / Semantic / │                              prompt/model release)
│  Episodic / Knowledge    │
│  (supermemory backend)   │
└──────────────────────────┘
```

- **Runtime / Execution** — the LangGraph harness: trigger intake, the agent loop
  (`createAgent`, `todoListMiddleware`, MCP tool-call loop), deterministic lifecycle nodes,
  guarded write path, Postgres checkpointer + retry, and the read-only React UI with live SSE.
- **Context** — everything that assembles and bounds what the model sees: repository/git
  management (§6.1), code intelligence (repowise, §6.2), and the Context Meter + Context Budget
  Manager.
- **Memory** — durable, retrievable institutional knowledge across four memory types
  (procedural, semantic, episodic, knowledge graph), realised on a chosen backend (supermemory).
- **Observability & Analytics** — the derived layer over the event stream: the Context Meter's
  token accounting, behavioral analytics (detectors/KPIs), and LLM Ops (tracing, evals,
  release gating).
- **Runtime feedback** — insights and outcomes flow back: memory backfill calibrates the
  router's risk thresholds; LLM Ops gates prompt/skill/model releases.

**Implementation status** (from `architecture.md`, reflecting the actual codebase):

- 🟩 **Built** — webhook trigger + BullMQ queue; LangGraph workflow + working state; agent
  loop, GitLab MCP allowlist, tool-call loop; reply path (draft notes, inline comments,
  approve/unapprove); Postgres checkpointer + retry; procedural memory (skills `.md` via
  `load_skill`); read-only React UI with live SSE.
- 🟨 **Partial** — episodic memory (run events persisted, no retrievable/consolidated store
  yet); guardrails (webhook input filtering exists; write-path output validation not yet).
- ⬜ **Pipeline** — semantic memory + temporal knowledge graph, summariser/consolidation loop,
  RAG retrieval into working memory; full LLM Ops loop; multi-agent router + the wider agent
  fleet.

---

## 5. Execution Model

> Full normative model (states, transitions, invariants): **[execution-model.md](./execution-model.md)**.
> This section is the summary.

**Trigger → deterministic lifecycle → LLM agent → guarded write → observe.**

1. **Trigger.** Runs fire on **coarse GitLab events, debounced** — **MR opened / marked ready →
   initial review; push → re-review** (plus direct API calls). **Fine-grained discussion events
   (individual replies, comment edits) do _not_ trigger runs**: they are recorded on GitLab (the
   source of truth) and read at the next push-triggered re-review. On re-review the agent itself
   resolves the threads it judges addressed and approves/unapproves; the **human merges** — so no
   command is required to close the loop. This is the deliberate boundary: automate the two
   cheap, unambiguous, high-value events (open, push) and reject everything else. (See
   [§6.4](#64-mr-interaction-model-review-replies).)

2. **Enqueue / debounce / lock.** Events enter the **BullMQ** queue with a **debounce** (≈5m)
   that coalesces rapid pushes into one re-review; a **Postgres advisory lock** (transaction-
   scoped, per MR) then guarantees at most one run per MR at a time and auto-releases on crash.

3. **Deterministic lifecycle nodes** (no LLM). In order: `ensure_repo` (clone or fetch),
   `check_index` (repowise index age/freshness), then one of `init_repo` / `sync_repo` / skip,
   and — in the deferred worktree flow — conflict check → `create_worktree`. Each node emits
   `node_start` / `node_progress` / `node_end` events onto the timeline stream alongside tool
   events.

4. **LLM agent node(s).** The model is entered only here. The active agent is given a **named
   toolset** — only the tools it needs (see [§6.8](#68-agents--routing)). It resumes the
   MR's **thread**, so repository understanding and prior decisions carry over. For each LLM
   request the **Context Meter** measures assembled context and the **Context Budget Manager**
   trims/summarises to stay within limits.

5. **Tool-call loop.** The agent calls MCP tools — GitLab (metadata/comments), repowise (code
   intelligence), read-only filesystem, the intent-based Git tool, and (for the dev agent)
   serena. Repository exploration relies on local git + filesystem, not repeated GitLab API
   calls.

6. **Guarded write / reply.** Outputs are validated (position checks, comment caps, no-praise
   enforcement — _partial_) then delivered: draft notes, inline comments, approve/unapprove,
   or (dev agent) symbol-safe edits verified by `tsc`/eslint. Artifacts worth remembering are
   written to memory.

7. **Observe.** Every run emits one trace; the event stream feeds behavioral analytics; the
   Context Meter records context growth. Post-merge/revert events backfill outcomes into memory.

**Re-review** is triggered by a **push** (the developer's natural "I'm done with this batch"
signal) and runs once: it reads the latest diff, every discussion and the developer's replies,
and the current file contents, then responds and resolves where appropriate — evaluating the
final state coherently rather than reacting to each incremental reply. Because the push is the
signal, replies left between pushes need no separate trigger; they are simply read at the next
re-review. Incremental (delta-only) re-review is a non-functional requirement for adoption.

---

## 6. Major Subsystems

Each subsystem is described by **Purpose · Responsibilities · Relationships · Extension points**.

### 6.1 Repository Context & Git Management

**Purpose.** Provide fast, local, safe access to repository contents and history so the GitLab
API becomes a collaboration layer (metadata, comments, approvals) rather than the primary
source of repository information. Support concurrent analysis of many MRs without duplicating
repository data.

**Responsibilities.**

- **Repository layout** — exactly one canonical **bare** repository per remote under
  `/harness-data/repos/<host>/<org>/<repo>.git`; each active MR gets its own **worktree** under
  `workspaces/…/<mr-id>/`. Bare repos avoid a stray working directory, shrink footprint, make
  accidental modification impossible, and mirror how CI/hosting platforms manage repos.
- **`RepositoryManager`** — the _only_ component that knows how repositories are stored:
  `ensureRepository`, `fetch`, `acquireWorkspace`, `releaseWorkspace`, `cleanupWorkspace`,
  `cleanupRepository`, `maintenance`, `healthCheck`. No other component invokes git directly.
- **Workspace leases** — consumers `acquireWorkspace(...)` and always `release()` in a
  `finally`; internally this creates the worktree if needed, ref-counts to prevent deletion
  while active, and auto-releases. Worktrees use **stable identifiers** (`mr-123`,
  `review-abcdef`) not branch names (branches rename; identity must be stable).
- **`GitService`** — a thin wrapper over the git CLI via `execa` (`clone`, `fetch`, `checkout`,
  `diff`, `mergeBase`, `show`, `log`, `blame`, `status`, `changedFiles`). `execa` is chosen over
  `simple-git` because langgraph-harness is fundamentally git-powered and needs advanced commands
  (`merge-base`, `cat-file`, `diff-tree`, `ls-tree`, `worktree`, `sparse-checkout`) plus
  streaming, cancellation, and observability.
- **Read-only surface for the LLM** — a read-only **Filesystem MCP** (`list_directory`,
  `read_file`, `read_multiple_files`, `directory_tree`, `search_files`, `search_text`, `stat`;
  never write/move/delete/mkdir) and an **intent-based Git tool** (`get_diff`,
  `get_diff_for_file`, `list_changed_files`, `get_commit`, `get_merge_base`, `git_log`,
  `git_blame`, `show_commit`). The LLM never runs shell commands and never mutates repo contents.
- **Fetch strategy** — exactly one fetch per repository before analysis; tools never fetch
  themselves.
- **Lifecycle & resilience** — cleanup driven by MR merge/close webhooks (primary), periodic
  cleanup (fallback for missed webhooks), and startup reconciliation (enumerate worktrees,
  repair metadata, prune orphaned/invalid worktrees). Canonical repos are cached (LRU / max
  count / max disk); `git worktree prune`, `git maintenance run`, `git gc`,
  `git remote prune origin` keep storage healthy.

**Relationships.** Feeds the **Context** layer; provides the worktrees that **code
intelligence** (repowise) and the **dev agent** (serena) run against; its diffs and history are
the raw material the **Memory** layer records.

**Extension points.** The **Repository Context Layer** exposes higher-level intent tools —
`find_definition`, `find_references`, `read_related_files`, `get_directory_summary`,
`get_module_context`, `search_symbols`, `search_imports`, `search_callers`,
`search_implementations` — explicitly designed so the implementation underneath can evolve from
filesystem traversal to Tree-sitter / LSP / a code graph **without changing the LLM
interface**. **repowise (§6.2) is the chosen realisation of this semantic tier.** Repository
providers beyond GitLab are also anticipated behind the same manager.

### 6.2 Code Intelligence (repowise)

**Purpose.** Produce the behavioral verdict layer an MR review exists to deliver — risk,
defect-calibrated health, ownership, co-change, hotspots, "why"/ADR lineage — signals the model
cannot compute for itself. repowise realises the Repository Context Layer's semantic tier.

**Responsibilities.**

- **Engine & boundary.** repowise runs as an MCP sidecar; its tools register directly as agent
  tools via the LangChain MCP adapter. Transport is **streamable-HTTP** (stdio needs a
  process-per-client and is harder to pool). It reads CI for type/lint signals and **never
  edits code**. AGPL is a non-issue for internal self-hosted use behind the process boundary.
- **CLI vs MCP split (which layer calls what).** **Agents only ever call repowise MCP tools** —
  they never invoke the CLI. The CLI is used only by the deterministic lifecycle nodes
  (`repowise status/init/update` — §5) and by the router's risk-triage signal. This reconciles
  the two source docs: the "hot-path `repowise risk` CLI triage" is a _pre-agent_ routing input,
  not an agent tool; the agent's analysis is always MCP.
- **Tool surface** (langgraph-harness runs repowise with `--all`). Primary consolidation points are
  **`get_context`** (triage cards — docs, ownership, decisions, freshness, skeletons,
  callers/callees, community, health; via `include=[...]`) and **`get_why`** (decisions, git
  archaeology, ADR lineage). Plus `get_overview`, `get_answer`, `get_symbol`,
  `search_codebase`, `get_risk` (hotspot score, dependents, will_break, missing_tests, security
  signals), `get_health`, `get_dead_code`, `list_repos`, and opt-in `get_dependency_path` /
  `get_execution_flows`. Workspace-only (deferred): `get_blast_radius`, `get_conformance`,
  `get_architecture`, and workspace-mode `get_risk` extras (cross-repo breaking changes,
  conformance violations, dependency cycles).
- **Workspace groups.** Repos are grouped by coupling; each group is an independent repowise
  workspace with its own MCP server process (ports 7338+). A **coupled group** (2–20 related
  repos) enables cross-repo analysis via explicit `manual_links`; an **isolated group** is a
  routing registry only. Auto-detection of contracts is off — `manual_links` and `conformance:`
  rules are the explicit source of truth; dependency-cycle detection always runs.
- **Workspace manager (langgraph-harness layer).** The single place group topology is known: on startup it
  spawns one `repowise mcp` per group, builds a `MultiServerMCPClient` across all group servers
  - GitLab, and compiles the workflow; it maintains the repo→group routing map; on topology
    change it drains in-flight runs, restarts affected subprocesses, and re-inits the client +
    workflow (`tools.init()` is re-callable).
- **Index model — seed from a warm base (target).** The intended model is a **warm base index
  of `main`** from which each MR worktree's index is **seeded** cheaply, so escalation to indexed
  tools is fast. Note the interim limitation: repowise today indexes **per-path with no
  seeding** (`repowise init` is CLI-only, does not auto-update on pushes, and `repowise update`
  refreshes a path in place), so until index seeding lands _(bug fix in flight)_ an escalated
  worktree pays a full index. Once seeding is available, the warm-base-seed model is canonical.
  `repowise update` hot-reloads cross-repo data without restart, though the repo list is frozen
  at server startup.
- **MR worktrees & cross-repo.** MR worktrees are **never** registered in a standing workspace;
  Tier-2 cross-repo checks use a **throwaway MR workspace** built from CLI subprocesses that
  diffs MR-branch contracts against the base to populate `breaking_changes`.

**Relationships.** Runs against worktrees from **git management (§6.1)**; its findings are the
core input to the **MR review agent** and are recorded by the **Memory layer (§6.3)**; its risk
score/percentile drive the **router (§6.8)**; it is reused by the **dev agent (§6.5)** for
orientation.

**Extension points.** New signals arrive as additional repowise tools without touching the
agent contract; workspace-mode/cross-repo analysis is a deferred phase; the semantic tier can
be swapped or augmented while keeping the Repository Context Layer interface stable.

### 6.3 Memory Layer (supermemory)

**Purpose.** Turn MRs, issues, bugs, incidents, and decisions into durable, retrievable context
so reviews compound into institutional memory: the next agent recalls "this area was risky
before, here's the prior decision, the owner, the linked issue" instead of re-deriving it. This
is the platform's foundational differentiator.

**v1 scope (§10 Decision 5).** v1 ships **context records + retrieval only**, on the committed
supermemory backend: structural overlap (files/symbols) plus semantic similarity, surfaced to
the reviewer. The
temporal entity graph and the full fact-extraction pipeline below are **future scope**, promoted
once extraction quality is proven on real data (the traceability principle §2.7 makes noisy
extraction a failure, not a degraded mode).

**Responsibilities.**

- **Memory types** (conceptual model from `architecture.md`): **procedural** (skills `.md` via
  `load_skill` — _built_), **semantic** (durable facts, profiles), **episodic** (run events +
  retrievable history — _partial_), and a **temporal knowledge graph** of entity-centric facts
  _(future scope — post-gate)_.
- **Entity graph & temporal facts** (the PRD/vision model; _future scope_): first-class objects — Service,
  Repository, Issue, MR, ADR, Incident, Team, Developer, API, Dependency — with typed
  relationships. Facts carry temporal metadata (what was true _when_); superseded facts are
  preserved with the supersession relationship, not deleted; contradictions update the graph
  while retaining history. Example fact types: service ownership, dependency, MR modification,
  issue-affects, ADR decision/rationale/supersession, incident cause, reviewer, API
  introduction. The layer must answer queries like "Why was the JWT refresh endpoint
  introduced?" and "Which services were affected by Incident #456?".
- **Context records.** For each MR/issue/bug the context-builder assembles a record —
  `source, repo, ref/sha, files[], symbols[], signals (risk/hotspots/ownership/co-change),
rationale, linked_issues[], outcome, summary, created_at`. `files[]`/`symbols[]` support exact
  structural lookup; `summary` supports semantic recall.
- **Ingestion & retrieval flow.** context-builder gathers fields (GitLab MCP + repowise) →
  writes one record per event → on a new MR, retrieve overlapping files/symbols (structural) +
  semantic similarity (embedding) → surface prior risk/decisions/owners to the reviewer. On
  merge/revert, backfill `outcome`, which sharpens future retrieval **and** calibrates the
  router's risk thresholds.
- **Backend — supermemory self-hosted (MIT), committed.** The decision is to **not rebuild what
  supermemory already provides** (fact extraction, contradiction handling, forgetting, and the
  entity graph come batteries-included). It runs fully offline, ships its own embedded graph
  engine + local embeddings (optional Ollama), keeps all data in one `./.supermemory` directory,
  and its single-tenant free tier is sufficient for internal single-system use. The accepted
  trade-off is a **second datastore** to operate/back up rather than reusing langgraph-harness's Postgres +
  pgvector — kept trivial by the single-directory layout. The layer remains **backend-agnostic**
  (the design references "the memory store" abstractly), so the earlier
  pgvector→Graphiti-on-FalkorDB/AGE stack from `architecture.md`, plus **mem0** (Postgres+
  pgvector), **raw pgvector**, and **Zep CE** (temporal KG), stay documented as **drop-in
  fallbacks** — but supermemory is the chosen implementation, not one option among equals.
- **Decisions/ADRs.** For supersession chains, author the ADR via repowise's ADR capability
  _and_ mirror the record into the memory store: the durable queryable copy survives repowise
  index rebuilds; repowise keeps the supersession graph.

**Relationships.** Sits beneath every agent as a consumer/contributor; fed by **code
intelligence** and **git management**; feeds the **reviewer** and the **router**; its consolidated
history is produced from **episodic** events by a summariser/consolidation loop (pipeline).

**Extension points.** Backend is swappable by design; new fact types and entity relationships
extend the schema; retention/aging policy and outcome-backfill wiring are open questions;
Phase 1 can ship without this layer and add it later.

### 6.4 MR Interaction Model (Review Replies)

**Purpose.** Reuse one long-lived AI context across the entire life of an MR, prevent concurrent
mutations of its thread, and keep GitLab as the source of truth — while making AI interaction
predictable and cheap.

**Canonical model — coarse events auto-trigger; fine events are read, not scheduled; humans
close the loop.** The guiding boundary: **automate the two cheap, unambiguous, high-value events
(MR open, push) and reject everything else — including a command layer.**

- **Triggers** — **MR opened / marked ready → initial review**; **push → re-review**. Both flow
  through the debounced queue (§5). A push is the developer's natural "I'm done with this batch"
  signal, so it doubles as the re-review request — no command needed.
- **Replies and edits are read, not triggers.** A developer fixes code where a comment warrants
  it, and replies on the thread where it doesn't. Those replies/edits change nothing on their
  own; the next push re-review reads the full current discussion (including the replies) and
  responds accordingly. This is what lets langgraph-harness drop discussion-level scheduling.
- **The agent resolves and approves; the human merges.** On re-review the agent triages the
  delta against open threads, resolves the threads it judges addressed, and approves/unapproves
  the MR (per the `code-review` skill, below). The developer merges when satisfied — and may also
  resolve threads manually. So the loop closes without any command, and a reply-only change with
  nothing to push simply needs no re-trigger. **No `@harness` command layer is part of the
  canonical model.**
- **Per-MR ownership** — each MR owns **one worktree, one LangGraph thread, one repository
  context**. Every run (initial or re-review) resumes the same thread, so the AI never rebuilds
  understanding → lower token use and better continuity across cycles.
- **Execution** — one run per MR at a time under a **Postgres advisory lock** (BullMQ handles the
  queue + debounce); rapid pushes coalesce via the debounce into a single re-review.
- **GitLab as source of truth** — store minimal metadata; every run fetches current diff,
  discussions, replies, commits, and file contents, so edits/deletes/force-pushes are handled
  naturally without replaying webhook payloads.

**What was rejected — fine-grained discussion scheduling** (from `review-replies.md`'s pivot,
kept for lineage). An earlier design reacted to _every_ discussion event: discussions carried
`IDLE/DIRTY/RUNNING` state and an **MR scheduler** drained DIRTY discussions over the shared
thread, batching replies and treating edits as re-DIRTY events. That machinery — per-reply
debounce, unread-note queues, edit tracking, discussion-level scheduling — is **not** part of
the canonical model, because the push already provides a single clean re-review signal. Its
durable ideas (one thread/worktree per MR, MR execution lock, GitLab as source of truth,
batching) are retained above. The pivot's replacement — a `@harness`-command API — is **also not
adopted as canonical**: coarse events (open, push) auto-trigger, and humans resolve threads and
merge, so no command is needed to close the loop. `architecture.md`'s BullMQ 5m debounce is
therefore _reconciled_, not superseded: it debounces pushes/open events, which is exactly the
right granularity.

**Relationships.** Sits in the **Runtime** layer; drives the thread that binds every per-MR run;
consumes **git management** worktrees and **code intelligence**; each review emits an artifact
and a memory context record. The concrete review procedure is **procedural memory** (a skill):
`backend/src/skills/gitlab-mcp/code-review.md` defines both the Initial Review and Re-review
steps — list changed files → batch diffs → draft inline comments → bulk-publish → resolve
addressed threads → approve/unapprove. Its Re-review path implements the **delta-only** NFR via
`list_merge_request_versions` / `get_merge_request_version` (diff last-reviewed version → HEAD).
This skill is the source of truth for _how_ a review runs; this section is the source of truth
for _when_ and _why_. The skill references no `@harness` commands, so it is already consistent with
the coarse-event trigger model.

**Extension points.** New capabilities attach without changing the execution model — as a new
coarse trigger, or, _if a genuine need appears_, as an optional `@harness` command that resumes the
existing thread (e.g. an on-demand `summarize` that no coarse event implies). A command layer is
a **possible future extension, not part of the canonical model.**

### 6.5 Code Editing / Dev Agent (serena)

**Purpose.** The read-write agent that implements features/bugs/auto-fixes — distinct from the
read-only reviewer.

**Responsibilities.** **Orient → edit → verify.** Orient with repowise (search, callers/callees,
blast radius); **edit** with serena (compiler-grade, symbol-safe edits — rename across codebase,
replace a function body, insert after a symbol — with lazy per-file invalidation, no
line-number fragility); **verify** with `tsc --noEmit` / eslint on live files. The graph is used
for orientation only; correctness comes from `tsc`, so there is no graph re-query mid-edit.

**Relationships.** Reuses the **shared worktree pool + MCP wiring** from §6.1/§6.2 (one serena
stack per task worktree, single-active-project per server); the **router** classifies an event
as task/bug/auto-fix and routes here. serena is **never loaded by the reviewer** — bound only to
this agent's toolset as its own sidecar.

**Extension points.** Whether to add serena now or defer until large mechanical refactors
appear; auto-fix scope and guardrails (propose vs. push) are open questions.

### 6.6 Behavioral Analytics & Observability

**Purpose.** Measure and understand _how agents behave over time_ — not merely detect failures —
so langgraph-harness can produce workflow KPIs and benchmark models, prompts, tools, and workflow versions.
The same analytics stay valuable across Qwen, GPT-5, Claude, or future models.

**Responsibilities (layered, each built on the previous).**

```
LangGraph execution → Event stream (existing) → Derived metrics → Behavioral detectors
                    → Workflow KPIs & insights → { Analytics dashboard, optional guardrails }
```

- **Event stream** — the existing events are sufficient; no extra instrumentation.
- **Derived metrics** — `RunSummary` (duration, success, llmCalls, toolCalls, uniqueTools,
  repeatedToolCalls, malformedRetries, checkpoints, prompt/completion/total tokens,
  maxContextSize, estimatedCost).
- **Detectors** (plugins, `onEvent`/`flush`) — repeated-tool, redundant-observation, novelty,
  progress, momentum, waste, phase inference (label semantic phases like _Context Gathering_ /
  _Repository Exploration_ / _Reporting_ without adding graph nodes), context-growth. Analytics
  detectors _measure only_ and never influence execution.
- **Behavioral scores** — several dimensions (Efficiency, Progress, Stability, Waste,
  Confidence), each fed by weighted detector signals; weights are configurable, not hardcoded.
- **KPIs & insights** — Reliability (success/failure rates, completion-time percentiles,
  intervention/manual-retry rates), Efficiency (avg LLM/tool calls, tokens, cost, context
  growth, latencies), Behavioral Quality (repeat/loop/oscillation rates, progress intervals,
  novelty/momentum/waste), Model Quality (malformed-tool-call/retry-recovery/invalid-argument
  rates, tool success). Insights rank tools, cost, context growth, waste, runtime, detector
  frequency, phase distribution, and trends.
- **Benchmarking** — objective comparison across **models**, **prompts**, **tool
  implementations**, and **workflow versions**; analytics becomes an _evaluation framework_, not
  just a debugging aid.
- **Runtime guardrails (optional)** — may consume detector output to intervene: loop / retry-
  storm / context-exhaustion / oscillation / no-progress detection → inject reminder, recommend
  a strategy change, suggest summarization, pause, or terminate. Analytics remain useful with
  guardrails disabled. Detailed design: **[Runtime Guardrails](./runtime-guardrails.md)** — the
  enforcement subsystem that consumes detectors under the observe-before-enforce principle (§2.8).

**Relationship to LLM Ops.** `architecture.md`'s **LLM Ops** is the complementary
release-quality half of observability: self-hosted **Langfuse** tracing (one trace/run),
observe (tokens/latency/errors), **LLM-as-judge evals** on a golden MR set, then
**diagnose → gate → release** with prompt/skill/model versioning. The golden MR set and the
review-comment acceptance-rate metric it anchors are a **v1 deliverable** — they are the gate
everything post-v1 waits on (§10 Decision 5). Behavioral analytics measures
_runtime behavior_ from the event stream; LLM Ops measures _output quality_ and gates releases.
Together with the Context Meter (§6.7) they form the Observability & Analytics layer.

**Extension points.** Detectors are first-class plugins — new ones add without touching
workflows; insights may eventually power live nudges, automated guardrails, and workflow/prompt/
model optimization while the execution engine stays generic.

### 6.7 Context Meter

**Purpose.** Give complete observability into _what consumes context, how it changes, and why_ —
beyond a single usage percentage — while staying model-agnostic and accurate for self-hosted
Ollama models.

**Responsibilities.**

- **Placement** — runs immediately after prompt assembly, before the LLM call, so it naturally
  covers system prompt, conversation, memories, retrieval, tool schemas, tool results, MCP
  resources, and the current message.
- **Live estimation + calibration** — Ollama returns `prompt_eval_count`/`eval_count` only
  _after_ generation, so langgraph-harness estimates tokens locally before each request using the exact
  deployed model's Hugging Face tokenizer (e.g. `Qwen/Qwen3.6-35B-A3B`), loaded once and cached.
  After the response, it compares estimate vs. `prompt_eval_count` and learns the average wrapper
  overhead for increasingly accurate live estimates.
- **Breakdown & explorer** — usage by section (System, Conversation, Repository, Memory,
  Retrieval, Tools, Current message) with drill-down into folders/files/retrieved docs/MCP
  resources/memories/tool outputs.
- **Timelines** — per-run total context (growth over a run) and a **delta timeline** explaining
  each change (`+8,412 Repository search`, `-18,500 Conversation compacted`).
- **Budget & capacity** — a progress bar with thresholds (green <60%, yellow 60–80%, orange
  80–90%, red >90%) and remaining capacity expressed in tokens _and_ intuitive units (≈ pages,
  ≈ source files).
- **Automatic compaction** — above a configurable threshold (~80–85%), compact: summarize older
  conversation, drop obsolete tool outputs, compress retrieval, while preserving recent
  conversation, long-term memories, and system prompts. Compaction is a visible timeline event.
- **Data model** — `ContextUsage`, `SectionUsage`, `ContextDelta`, `RunContextSnapshot`.

**Relationships.** Bridges **Context** and **Observability**: it is the per-request accountant
that complements the **Context Budget Manager** (§6.1, which trims _repository_ collection
up-front) and feeds context-growth signals to **analytics**. Its guiding principle — answer
_what/why/what-changed/how-much-remains/what-can-compact/what-was-sent_ — embodies the
Engineering Context Platform intent.

**Extension points (future).** Cost estimation for hosted providers, token heatmap, cross-run
context diff, and full prompt reconstruction (debugging/repro/audit).

### 6.8 Agents & Routing

**Purpose.** Decide _which_ agents run, with _which_ tools, for a given trigger — so cheap
changes get cheap treatment and risky ones get deep analysis. This is the orchestration layer
between a trigger and the agent nodes; it is the home for the concepts other sections reference.

**Responsibilities.**

- **Agents are LLM nodes with named toolsets** (least privilege — §2.5). Each agent gets only the
  tools it needs. The designed fleet (implementation-plan Phase 4; most are **future**, see §9):

  | Agent                           | Toolset (abridged)                                                                                                               |
  | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | **mr-reviewer** _(core, today)_ | `get_risk`, `get_health`, `get_context`, `get_why`, `get_execution_flows`, `get_symbol`, `search_codebase`, GitLab MR + CI tools |
  | impact-analyzer                 | `get_blast_radius`¹, `get_risk`, `get_conformance`¹, `get_context`                                                               |
  | context-builder                 | `get_context`, `get_why`, `get_overview`, `search_codebase`, GitLab issue tools, `store_context`                                 |
  | doc-writer                      | `get_overview`, `get_dependency_path`, `get_context`, `generate_claude_md`                                                       |
  | issue-triager                   | `search_codebase`, `get_context`, `get_why`, `recall_context`, GitLab issue tools                                                |
  | test-generator                  | `get_context`, `get_risk` (missing_tests), GitLab MR diff tools                                                                  |
  | security-scanner                | `get_risk` (security), `get_conformance`¹, `get_context`, `load_custom_rules`                                                    |
  | release-agent                   | GitLab MR/milestone/commit tools                                                                                                 |
  | auto-fix / dev agent (§6.5)     | Serena MCP, `get_context`, `get_risk`, GitLab MR tools                                                                           |
  | memory-writer                   | `store_context`, `recall_context` (post-review outcome backfill)                                                                 |
  | sentry-fixer                    | Sentry tools, `get_context`, Serena MCP                                                                                          |
  | design-handoff                  | Figma MCP, `get_context`                                                                                                         |

  ¹ workspace-only (deferred).

- **Router — risk-based tiering.** For MR triggers the router reads the code-intelligence risk
  signal (§6.2) plus diff stats and labels to pick a tier:

  | Tier         | Condition                                          | Agents                                          |
  | ------------ | -------------------------------------------------- | ----------------------------------------------- |
  | 0 — trivial  | docs/config/test-only, tiny diff, low risk         | mr-reviewer only (no repowise tools)            |
  | 1 — standard | normal change, moderate blast radius               | mr-reviewer + impact-analyzer + context-builder |
  | 2 — deep     | core/auth/shared touched, high risk, cross-cutting | all review agents + memory recall               |

  Non-MR triggers (issue created, sprint end, Sentry error) route directly to the relevant agent —
  no risk tiering. Router signals: `get_risk` score + percentile, diff stats (files/paths/size),
  MR labels, trigger type.

- **Expansion gate (§10 Decision 5).** Fleet expansion beyond **mr-reviewer** (+ the
  context-record path: context-builder/memory-writer) is gated on the **review-comment
  acceptance-rate** target,
  measured on the golden MR eval set (§6.6). Every other agent in the table is **future scope**
  until that gate is met.

**Relationships.** Consumes the **code-intelligence** risk signal (§6.2, via the pre-agent CLI
triage) to tier; activates **agent** nodes that run on the MR **thread** (§6.4); its thresholds
are calibrated by **memory** outcome backfill (§6.3). The **built core today** is a single agent
(mr-reviewer); the router and wider fleet are the multi-agent phase.

**Extension points.** New agents attach as "another node with a named toolset"; new tiers or
non-risk routing signals extend the router without touching agents (see §8).

---

## 7. Cross-cutting Concepts

How the core concepts (§3) span subsystems. Concepts already defined in §3 are _not_ redefined
here — this section states only their cross-cutting role. Normative models for these:
**[event-model.md](./event-model.md)** (Event envelope/catalog/semantics),
**[data-model.md](./data-model.md)** (persisted entities & ownership),
**[detector-framework.md](./detector-framework.md)** and **[metrics-catalog.md](./metrics-catalog.md)**
(the derivation of Metrics).

- **Events** _(defined §3)_. The single event stream is where every observer reads: **behavioral
  analytics** (§6.6), the **live UI timeline**, and **LLM Ops** all derive from it — no subsystem
  re-instruments the workflow. Lifecycle nodes and tool calls emit the same event shapes.
- **Threads** _(defined §3)_. The one-thread-per-MR rule is the backbone of continuity across
  subsystems: it is what makes **re-review** cheap (§6.4), keeps review context coherent, and
  lets any future MR-level workflow reuse accumulated understanding for free.
- **Artifacts** _(defined §3)_. Every run output crosses two subsystems at once: it is a
  _delivered_ result (GitLab/Figma) **and**, where durable, a **memory** record (§6.3) — and its
  creation is a **progress** event for analytics (§6.6).
- **Checkpoints.** The Postgres checkpointer makes runs resumable and crash-resilient, is a
  first-class **progress signal** for analytics, and pairs with git-management's startup
  reconciliation and worktree leases to make the whole platform recoverable after crashes or
  missed webhooks.
- **Metrics.** `RunSummary`-derived metrics and the Context Meter's token accounting are shared
  currency: they feed dashboards, benchmarking, router threshold calibration, and LLM Ops.
- **Toolsets & MCP.** All capabilities reach agents as MCP tools through one
  `MultiServerMCPClient` (repowise per-group servers + GitLab + read-only filesystem + git tool
  - serena for the dev agent). Each agent is granted only its named toolset (§6.8); the LLM never
    runs raw shell and (except the dev agent) never writes.

_(The router and its tiers are a subsystem in their own right — see §6.8 Agents & Routing.)_

---

## 8. Extension Points

Where the architecture deliberately anticipates future evolution.

- **New agents on the shared foundation.** A supervisor/router plus a fleet of task-triggered
  agents (issue triage, documentation/ADR, onboarding, dependency mapper, sprint/release,
  design handoff, log analyser, Sentry autofix, security scan, scrum bot) all consume the same
  memory + code-intelligence + ops foundation. Adding one is "another agent with a named
  toolset" resumed on the shared thread.
- **Repository Context Layer implementation swap.** Intent tools (`find_definition`, …) let the
  semantic tier evolve; repowise is today's realisation, with workspace/cross-repo analysis as a
  further phase.
- **Memory backend swap.** supermemory is the committed backend; mem0/pgvector/Zep CE and the
  pgvector→Graphiti (AGE/FalkorDB) stack remain drop-in fallbacks behind the abstract "memory
  store" if the second-datastore trade-off ever needs revisiting.
- **Detectors as plugins.** New behavioral detectors and KPIs register without touching
  workflows; guardrails layer on top of detector output — see the
  **[Runtime Guardrails](./runtime-guardrails.md)** subsystem (attaches as an agent-loop
  middleware; ships shadow-mode first).
- **Optional command layer / new workflow types.** An `@harness` command API (summarize, approve,
  explain, security scan, doc review, test-impact) is a _possible_ future addition on top of the
  coarse-event triggers — each command would resume the existing thread. Not part of the
  canonical model (§6.4).
- **LLM Ops release loop.** Prompt/skill/model versioning gated by evals on a golden MR set.
- **Context Meter futures.** Cost estimation, token heatmap, context diff, prompt reconstruction.
- **Additional repository/design providers.** GitLab + Figma today; the manager/webhook layer is
  built to admit more later.

---

## 9. Future Directions (vision beyond current subsystem proposals)

Aspirational scope from the vision deck / PRD that is **not** yet backed by a subsystem design,
and should be treated as direction, not established architecture. Per **§10 Decision 5**,
everything in this section — plus the temporal entity graph (§6.3) — is **future scope behind
the v1 gate**: it is promoted only after the MR review agent meets its review-comment
acceptance-rate target on the golden MR eval set. Nothing here is cancelled; it is sequenced.

- The full **nine-capability agent fleet** beyond MR review — issue/bug triage, the four
  documentation agents, sprint/release agents, the design handoff agent, observability agents
  (log analyser, Sentry autofix), security scan, and the scrum bot. (MR review, memory, code
  intelligence, repository/git management, analytics, and the context meter are the
  designed-and/or-built core; the rest are planned capabilities.)
- **Ingestion beyond GitLab/Figma** (explicitly out of scope for v1).
- **A conversational chat interface** (explicitly _not_ the product — agents are task-triggered).
- **Automated deployment / infra changes** from agent output (explicitly out of scope).

**Product delivery phases** (PRD/deck) and **engineering build phases** (implementation plan)
are two different axes — both are roadmaps, neither supersedes the other:

- _Product phases:_ 1 Foundation → 2 Context Awareness → 3 Decision Intelligence →
  4 Observability & Security → 5 Design & Planning. Phase 1 is the **v1 gate** (Decision 5):
  phases 2–5 are entered only after the acceptance-rate target is met.
- _Engineering build phases:_ 1 Infrastructure (repowise, workspace manager) → 2 Tool inventory →
  3 LangGraph node flow → 4 Specialized agents → 5 Router.

---

## 10. Architectural Decisions (resolved conflicts)

Decision log. Decisions 1–4 resolve the tensions found between authoritative documents during
consolidation; Decision 5 is a delivery-scope decision. Each entry records the resolution, and
the sections above reflect it. Retained as a log so the reasoning behind each choice is
traceable (and revisitable if a premise changes).

1. **Trigger model — RESOLVED (coarse-event auto-trigger; no fine-grained scheduling; no command
   layer).** The canonical model auto-triggers on **MR open → initial review** and **push →
   re-review** through the debounced queue, reads replies/edits at the next push rather than
   scheduling on them, and relies on the **human to resolve threads and merge** — no `@harness`
   command is part of the loop (see §5, §6.4). This reconciles the sources: `review-replies.md`'s
   pivot is adopted _in the part that matters_ (no per-reply/discussion scheduling) but neither
   its "nothing runs without a command" claim nor its command API is taken as canonical;
   `architecture.md`'s BullMQ 5m debounce is retained as push/open debouncing; and the PRD/deck's
   "triggered on every MR open or update" + latency/coverage SLAs hold, because open and push are
   exactly those events. A command layer remains available as a future extension if a genuine
   on-demand need (e.g. `summarize`) appears.

2. **Code-intelligence integration — RESOLVED (seed-from-warm-base is the target; per-group MCP;
   agents MCP-only).** The `code-intelligence.md` **warm-base-index + seed-per-worktree** model
   is canonical _intent_; `implementation-plan.md`'s "per-path, no seeding" is a current repowise
   limitation, not a design choice — a fix to **seed an index from an existing index** is in
   flight, after which seeding is the norm (interim: escalated worktrees pay a full index). Cheap
   seeding also dissolves the CLI-vs-MCP tension: the stateless-CLI `repowise risk` "hot path"
   was mainly there to dodge indexing cost, so it becomes the **router's pre-agent triage
   signal**, while **agents always use MCP tools** (per `implementation-plan.md`). Deployment is
   **per-workspace-group MCP servers** (ports 7338+), which supersedes the older "one sidecar
   serves all" as newer, more detailed, and required for cross-repo grouping. (See §6.2.)

3. **Memory backend — RESOLVED (supermemory committed).** supermemory self-hosted is the chosen
   backend: the decision is to not reinvent its batteries-included memory features. The
   second-datastore cost (vs. reusing Postgres+pgvector) is accepted, kept trivial by the single
   `./.supermemory` directory. `architecture.md`'s pgvector→Graphiti-on-FalkorDB/AGE stack — plus
   mem0/pgvector/Zep CE — is superseded as the primary choice but retained as a documented
   **drop-in fallback**, since the layer stays backend-agnostic. (See §6.3.)

4. **Scheduler substrate — RESOLVED (BullMQ queue/debounce + Postgres advisory lock).**
   `review-replies.md` left this open (Postgres locks vs. a job system). The split: **BullMQ**
   (already built) owns queueing and the push/open debounce (§5); the **MR-level execution lock**
   lives in **Postgres** as a transaction-scoped advisory lock (`pg_advisory_xact_lock(mr_id)`,
   or `SELECT … FOR UPDATE SKIP LOCKED` on a run row). Rationale: the lock is co-located with the
   state it protects (the LangGraph thread/checkpoint already in Postgres), so run-liveness has a
   single source of truth rather than spanning Redis + Postgres; OSS BullMQ has no clean per-MR
   ("one job per MR") concurrency primitive, so the advisory lock is _less_ code; and the
   txn-scoped variant auto-releases on crash, pairing with git-management's startup
   reconciliation. Concurrent per-MR runs are already rare under the coarse-event trigger model
   (§6.4), so this is inexpensive mutual exclusion. (Reflected in §5 step 2 and §6.4.)

5. **v1 scope — RESOLVED (MR-review excellence + context records; everything else future scope,
   gated on acceptance rate).** v1 delivers one excellent reviewer, not a broad fleet: the
   **MR review agent** (§6.4), a **golden MR eval set** with **review-comment acceptance rate**
   as the gating metric (LLM Ops, §6.6), and **context records + retrieval** on the committed
   supermemory backend — structural (files/symbols) overlap + semantic recall (§6.3). The temporal entity graph and full
   fact-extraction pipeline move to **future scope** until extraction quality is proven on real
   data. Rationale: adoption hinges on comment precision — a noisy reviewer gets muted, and no
   amount of platform underneath recovers from that; memory's value compounds only after months
   of ingestion, so it cannot carry week-one quality; and entity-graph extraction accuracy is
   unproven with self-hosted models, where the traceability principle (§2.7) makes noisy
   extraction a product failure, not a degraded mode. **Nothing is removed:** the agent fleet,
   the entity graph, and product delivery phases 2–5 remain the target architecture (§9) — each
   is promoted from future scope only after the acceptance-rate gate is met. (Reflected in §6.3,
   §6.8, §9.)

---

## 11. Glossary

| Term                             | Definition                                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **langgraph-harness**            | The Engineering Context Platform — a self-hosted shared engineering memory that makes every agent context-aware.                                                                                                                                               |
| **Engineering Context Platform** | The product category: a continuously updated, queryable knowledge layer over engineering artefacts.                                                                                                                                                            |
| **Agent**                        | A task-triggered LLM component with a named toolset (e.g. mr-reviewer, context-builder, dev agent). Consumer and contributor of memory.                                                                                                                        |
| **Workflow**                     | A LangGraph graph implementing one kind of work; deterministic lifecycle nodes + LLM agent node(s).                                                                                                                                                            |
| **Thread**                       | The persistent LangGraph state for a subject — one per MR; resumed by every run (initial review, re-review).                                                                                                                                                   |
| **Run**                          | One execution of a workflow on a thread; unit of tracing and analytics; serialized per MR.                                                                                                                                                                     |
| **Event**                        | An item in the LangGraph execution stream; the single source of truth for observability.                                                                                                                                                                       |
| **Artifact**                     | A durable run output (description, comments, ADR, docs, tests, fix) — delivered and/or stored in memory.                                                                                                                                                       |
| **Context**                      | Everything assembled into a single LLM prompt; measured by the Context Meter, bounded by the Context Budget Manager.                                                                                                                                           |
| **Context Meter**                | Subsystem that measures/visualises/manages per-request context: estimation+calibration, breakdown, timelines, budget, auto-compaction.                                                                                                                         |
| **Context Budget Manager**       | Up-front manager that prioritises and trims _repository_ context collection before sending to the LLM.                                                                                                                                                         |
| **Memory layer**                 | Durable, retrievable institutional knowledge; procedural/semantic/episodic memory + temporal knowledge graph; backend = supermemory (swappable).                                                                                                               |
| **Context record**               | The structured payload memory ingests per MR/issue/bug (files, symbols, signals, rationale, outcome, summary).                                                                                                                                                 |
| **Temporal knowledge graph**     | Entity-centric, time-aware fact graph (Service, Repository, Issue, MR, ADR, Incident, Team, Developer, API, Dependency) preserving superseded facts.                                                                                                           |
| **Code intelligence**            | Analysis of code (risk, health, ownership, co-change, hotspots, why/ADRs) — engine: **repowise**. Never edits code.                                                                                                                                            |
| **repowise**                     | The chosen code-intelligence engine; per-workspace-group MCP servers exposing `get_context`, `get_why`, `get_risk`, etc.; warm base index seeded per worktree (target; per-path in the interim); workspace groups for cross-repo. Agents call it via MCP only. |
| **Code editing / dev agent**     | The read-write agent (**serena**) implementing features/fixes: orient (repowise) → edit (serena) → verify (`tsc`/eslint).                                                                                                                                      |
| **serena**                       | Compiler-grade, symbol-safe code-editing MCP tool; bound only to the dev agent; never loaded by the reviewer.                                                                                                                                                  |
| **Repository Context Layer**     | Intent-level repository tools (`find_definition`, `find_references`, …) whose implementation can evolve without changing the LLM interface; realised by repowise.                                                                                              |
| **RepositoryManager**            | The single owner of repository lifecycle (canonical bare repos, worktree leases, fetch, maintenance, reconciliation).                                                                                                                                          |
| **GitService**                   | Thin `execa`-based wrapper over the git CLI; the only path to git operations.                                                                                                                                                                                  |
| **Worktree**                     | A per-MR checkout (stable id like `mr-123`) from the canonical bare repo; acquired via a ref-counted lease.                                                                                                                                                    |
| **Filesystem MCP**               | Read-only file access exposed to the LLM (no write/move/delete/mkdir).                                                                                                                                                                                         |
| **Git tool**                     | Intent-based git operations exposed to the LLM (`get_diff`, `git_blame`, …); never raw shell.                                                                                                                                                                  |
| **Workspace group**              | A coupling-based cluster of repos forming one repowise workspace + MCP server; enables cross-repo analysis via `manual_links`.                                                                                                                                 |
| **Analytics (behavioral)**       | Derived layer over events: metrics → detectors → KPIs/insights; used for observability and benchmarking.                                                                                                                                                       |
| **Detector**                     | A pluggable analytics component (`onEvent`/`flush`) producing a behavioral signal (repeated-tool, novelty, momentum, waste, …).                                                                                                                                |
| **KPI / Insight**                | Actionable analytics output (reliability/efficiency/behavioral-quality/model-quality metrics, rankings, trends).                                                                                                                                               |
| **Guardrail**                    | Optional runtime intervention driven by detector output (inject reminder, summarize, pause, terminate).                                                                                                                                                        |
| **Phase (inferred)**             | An analytical label for a behavioral segment of a run (Context Gathering / Repository Exploration / Reporting) — not a graph node.                                                                                                                             |
| **LLM Ops**                      | Release-quality observability: Langfuse tracing, evals (LLM-as-judge on a golden MR set), diagnose → gate → release with prompt/skill/model versioning.                                                                                                        |
| **Checkpoint**                   | A persisted resumable snapshot (Postgres checkpointer); also a progress signal for analytics.                                                                                                                                                                  |
| **Router / Tier**                | Risk-based selection (via repowise `get_risk`) of which agents/tools run: Tier 0 trivial, 1 standard, 2 deep.                                                                                                                                                  |
| **Command**                      | _(Future/optional, not canonical — §6.4.)_ An `@harness …` instruction in a GitLab comment that would trigger a workflow on the MR thread (e.g. `summarize`). The canonical model triggers on coarse events (open, push), not commands.                        |
| **Skill**                        | Procedural memory as an `.md` document loaded via `load_skill`.                                                                                                                                                                                                |

```

```
