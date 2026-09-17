# langgraph-harness — Code Editing / Dev Agent (serena)

> **Domain:** the read-write dev agent (serena) only. **Shared concepts** and the platform's
> layers, triggers, and routing are canonical in **[Platform Architecture](../3-architecture/platform-architecture.md)**
> (the router that dispatches task/bug/auto-fix here → [§6.8](../3-architecture/platform-architecture.md#68-agents--routing)).
> Shared worktree/repo lifecycle → [Git Management](./git-management.md). This document references,
> not redefines, those. See Platform Architecture.

Status: Design / pre-implementation
Scope: the read-write agent that implements features / bugs / auto-fixes — distinct from the read-only review agent. Uses code intelligence to orient, serena to edit, `tsc`/eslint to verify.
Related: `code-intelligence.md` (shared repowise engine + worktree/routing infra it reuses) · `memory-layer.md`.

This is the **code-editing** layer. It is _not_ code intelligence (analysis) and _not_ the memory layer — it modifies code.

---

## 1. Why serena, and only here

- serena = **compiler-grade symbol-safe edits** (rename across the codebase, replace a function body, insert after a symbol — no line-number fragility) + **lazy per-file invalidation** (stays correct _inside_ an edit loop without re-indexing).
- It's a code-editing tool — not code intelligence, and **never loaded by the reviewer**. Bound only to this agent's toolset, as its own MCP sidecar.
- Selection rationale: agent memory `project_code_intel_tool_selection`.

---

## 2. Flow: orient → edit → verify

- **Orient** — repowise (search, callers/callees, blast radius) for up-front understanding. See `code-intelligence.md` for how repowise is wired; this agent reuses the same sidecar.
- **Edit** — serena symbol-safe edits.
- **Verify** — `tsc --noEmit` / eslint on live files. The graph is used for orientation only; correctness comes from `tsc`, so there's **no graph re-query mid-edit** (and serena's lazy invalidation keeps it consistent if you do).

---

## 3. Integration notes

- Reuses the **shared worktree pool + MCP wiring** from `code-intelligence.md`; each task gets a dedicated worktree.
- Trigger: the router ([Platform Architecture §6.8](../3-architecture/platform-architecture.md#68-agents--routing)) classifies an event as task / bug / auto-fix → routes here.
- serena is single-active-project per server, so one serena stack per task worktree.

---

## 4. Open questions

- Whether to add serena now or defer until large mechanical refactors appear (review is primary; the dev agent is secondary).
- Auto-fix scope and guardrails (when the agent may push edits vs. only propose them).
