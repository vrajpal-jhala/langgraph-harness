# langgraph-harness — Code Intelligence (repowise)

> **Domain:** the code-intelligence engine (repowise) only. **Shared concepts** (_Thread_, _Run_,
> _Event_, _Workflow_, _Artifact_) and the platform's layers, triggers, and **review routing/tiers**
> are canonical in **[Platform Architecture](../3-architecture/platform-architecture.md)** (routing lives in
> [§6.8 Agents & Routing](../3-architecture/platform-architecture.md#68-agents--routing)). This document details
> the engine; it references, not redefines, those. Worktree/repo lifecycle → [Git Management](./git-management.md);
> the LLM-facing Repository Context Layer → [Context Management](./context-management.md).

Status: Design / pre-implementation
Scope: how langgraph-harness indexes and queries code intelligence (repowise) to **review** merge requests, and how that engine is wired into the LangGraph agent loop (MCP, worktrees, freshness).
Related: `code-editing.md` (the read-write dev agent — a separate layer, uses serena) · `memory-layer.md` (durable history/recall this engine's findings feed).

This doc is the **code-intelligence / review** layer only. Code editing (serena) and the memory layer (supermemory) are separate layers in their own docs.

---

## 1. Engine decision

- **repowise** — native, research-calibrated behavioral signals (risk, defect-calibrated health, ownership, co-change, hotspots, "why", ADRs): the verdict layer an MR review exists to produce, and the part the model can't compute itself.
- **AGPL is a non-issue** for internal/self-hosted use; the sidecar process boundary keeps langgraph-harness's code clean. (Rationale: agent memory `project_code_intel_tool_selection`.)
- Reads CI for type/lint signals. **Never edits code** — editing is the dev agent's job (see `code-editing.md`).

---

## 2. Integration mechanics

### MCP connection

- Connect repowise to the agents via LangChain's MCP adapter, so its tools register directly as agent tools. Deployment is **one repowise MCP server per workspace group** (ports 7338+), all joined into harness's `MultiServerMCPClient` by the workspace manager — canonical in [Platform Architecture §6.2 and §10 Decision 2](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts), which supersedes the earlier "one sidecar serves all" model.
- Transport: **streamable-HTTP** as a long-lived private-network service (stdio rejected — it needs a process per client and is harder to pool). No external exposure.

### Split usage (the operational rule)

- **CLI = pre-agent only.** `repowise risk base..HEAD` runs as a **stateless CLI subprocess** to supply the router's triage signal (PA §6.8), and the deterministic lifecycle nodes use `repowise status/init/update`. No worktree, no index, fully concurrent.
- **Agents always use MCP tools** (`get_risk`, `get_health`, `get_why`, `get_context`, ownership/co-change) against a worktree — agents never invoke the CLI (PA §10 Decision 2). Which repowise tools an agent gets is decided by the router's tier.

### Worktree handling (shared infra; reused by the dev agent)

> The warm-base + seed-per-worktree model below is the **target** (PA §10 Decision 2). Interim
> limitation: repowise today indexes per-path with no seeding, so an escalated worktree pays a
> full index until index seeding lands.

- Keep one **warm base checkout of `main`** with a warm repowise index.
- Escalated work: acquire a worktree from the **capped pool**, sparse-checkout the ref, point/seed the index, run tools, **guaranteed teardown** (`worktree remove` + drop per-worktree index).
- Hygiene: fetch once into the base before fanning out; serialize worktree creation + ref writes; no `git gc` during a review storm; orchestrator runs git once and passes the diff to tools.

### Index freshness

- Incremental refresh of the base index on **merge-to-`main`** via webhook (single serialized writer). Per-MR queries read the warm base; only escalated MRs needing the MR's _new_ symbols pay an incremental update inside their worktree.

---

## 3. Review routing

**Canonical:** review tiers (0/1/2) and router signals are defined in
**[Platform Architecture → §6.8 Agents & Routing](../3-architecture/platform-architecture.md#68-agents--routing)**.
Not repeated here. This engine's role in routing is to supply the risk signal
(`repowise risk` score + percentile) the router tiers on, and to provide the tier-appropriate
tools (`get_risk` / ownership / co-change at Tier 1; `get_why` / `get_health` / hotspots /
execution flows / cross-repo at Tier 2).

---

## 4. Review agent tool → task mapping

**Reviewer (read-only):** `repowise risk` (triage), `get_risk` (will_break / missing_tests / hidden_coupling), ownership/co-change, `get_health` + hotspots, blast radius, execution flows, surprising connections. Reads CI for type/lint. Never edits.

Each review emits a context record into the memory layer (see `memory-layer.md`).

---

## 5. Open questions

- Worktree pool size + queueing under peak MR load.
- Whether to run repowise's embeddings/LLM doc layer at all, or rely on the memory layer's recall (`memory-layer.md`).
- Exact router thresholds (tune against real `repowise risk` percentiles).
