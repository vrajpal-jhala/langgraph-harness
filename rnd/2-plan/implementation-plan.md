# langgraph-harness — Implementation Plan

> **Domain:** _build sequencing_ — the order in which the platform is assembled. It does **not**
> define architecture: layers, concepts (_Thread/Run/Event/Workflow/Artifact_), the trigger model,
> the agent fleet, and routing tiers are canonical in **[Platform Architecture](../3-architecture/platform-architecture.md)**
> (agents & router → [§6.8](../3-architecture/platform-architecture.md#68-agents--routing)). Where this plan lists
> agents or tiers, treat Platform Architecture as the source of truth and this as the ordering. See
> Platform Architecture.

Status: In progress
Scope: ordered build plan — infrastructure → tools → toolsets → agents → router.
Related: `code-intelligence.md` (repowise detail) · `memory-layer.md` (supermemory) · `code-editing.md` (serena)

---

## Phase 1 — Infrastructure setup

### repowise (code intelligence)

Single installation from the published PyPI package:

```sh
uv tool install repowise   # installs all three modes
uv tool uninstall repowise # clean removal
```

- **CLI** — `repowise init`, `repowise update`, worktree registration. Runs as subprocesses from harness backend.
- **MCP server** — one `repowise mcp <workspace_root> --transport streamable-http --port <N>` process per workspace group. Default port is **7338**; each additional group gets the next port (7339, 7340, ...). All group servers plus the GitLab MCP server connect into harness's `MultiServerMCPClient`. Managed by the workspace manager layer (see below).
- **Dashboard** (optional) — `repowise serve` (default port configurable via `--port`). Not part of the agent loop — free observability bonus.

Transport: **streamable-http** (not stdio — stdio requires a process-per-client and is harder to pool).

### Index facts (confirmed from source)

- Index is **per-path**, not per-branch. No sharing or seeding across worktrees.
- `repowise init` is **CLI-only** — no REST or MCP equivalent.
- Index does **not auto-update** on remote pushes. Explicit `repowise update --repo <alias>` required after fetching new commits to a worktree.
- `repowise workspace add <path> --alias <alias>` registers + indexes; `--no-index` to register only.
- Repo paths in the workspace config are stored **relative** if the repo is inside the workspace root, **absolute** if outside it. All repos and worktrees can live anywhere on the filesystem — one workspace covers all of them.
- Post-commit hook fires on local commits to the main checkout only — not reliable for harness-managed worktrees.

### Workspace groups and cross-repo contracts

Repos are organised into **workspace groups** based on coupling. Each group is an independent repowise workspace with its own MCP server process. Groups are defined in harness config and managed by the workspace manager layer.

Two group types:

- **Coupled group** — 2–20 repos that communicate over HTTP/gRPC/topics or share packages (e.g. a cluster of microservices, or frontend + its backend). Cross-repo analysis enabled via `manual_links`.
- **Isolated group** — one shared workspace for all standalone repos with `detect_*: false`. Acts as a routing registry only — no cross-repo analysis.
- _(MR worktrees are never registered in any workspace — see custom tools below.)_

Each `.repowise-workspace.yaml` at the group workspace root:

```yaml
repos:
  - path: /opt/repos/svc-a
    alias: svc-a
    tags: [payments, backend]
  - path: /opt/repos/frontend
    alias: frontend
    tags: [ui, edge]

contracts:
  detect_http: false # always off — use manual_links only
  detect_grpc: false
  detect_topics: false
  manual_links:
    - from_repo: frontend
      to_repo: backend
      contract_type: http
      contract_id: /api/v1
      from_role: consumer

conformance:
  rules:
    - source: 'tag:ui'
      target: 'tag:data'
      description: UI tier must never call the data tier directly.
    - source: '*'
      target: legacy-payments
      description: No new dependencies on legacy-payments.
```

Auto-detection is disabled across all groups. `manual_links` is the explicit source of truth for cross-repo relationships. `conformance:` rules declare the intended architecture — violations surface in `get_risk` PR-mode and via `get_conformance`. Tags on repos enable tier-based rules (e.g. `tag:ui`, `tag:data`). Dependency cycle detection runs automatically on every workspace even with zero rules declared.

**`repowise update` hot-reloads cross-repo data** (system graph, contracts, co-changes) in the running MCP server without restart. The repo list itself is frozen at MCP server startup — adding a new repo to a group requires a repowise MCP subprocess restart (not a full harness restart).

### Workspace manager (harness layer)

langgraph-harness owns a workspace manager that bridges config → repowise processes → MCP client. This is the only place workspace group topology is known.

**Config shape (harness):**

```ts
workspaceGroups: [
  {
    name: 'payments',
    workspaceRoot: '/opt/harness/workspaces/payments',
    port: 7338,
    repos: ['svc-a', 'svc-b'],
  },
  {
    name: 'platform',
    workspaceRoot: '/opt/harness/workspaces/platform',
    port: 7339,
    repos: ['frontend', 'api'],
  },
  {
    name: 'isolated',
    workspaceRoot: '/opt/harness/workspaces/isolated',
    port: 7340,
    repos: ['tool-x'],
  },
];
```

**Responsibilities:**

- On startup: spawn one `repowise mcp` subprocess per group, build `MultiServerMCPClient` across all group servers + GitLab, compile LangGraph workflow with the resulting tool list.
- Repo → group routing: a flat map built from config (`svc-a → payments`, `frontend → platform`, ...). Used by the orchestrator to pass the correct `repo=alias` to MCP tool calls.
- On group change (new group added or repo moved): close current MCP client → update config → restart affected subprocess(es) → reinitialise `MultiServerMCPClient` + workflow. Fast (< 1s local HTTP connections + workflow compile). In-flight runs drain first.
- `tools.init()` must be re-callable with updated config to support reinit without a full harness restart.

**Directory layout:**

```
/opt/harness/
  workspaces/
    payments/   .repowise-workspace.yaml   ← group workspace roots (config only, no repos inside)
    platform/   .repowise-workspace.yaml
    isolated/   .repowise-workspace.yaml
  repos/                                    ← permanent checkouts (absolute paths in workspace configs)
    svc-a/  svc-b/  frontend/  api/  tool-x/
  worktrees/                                ← ephemeral MR worktrees, never in any workspace
    svc-a-mr-123/
```

> This is the **interim** on-disk layout for the current build (full checkouts, manual trigger).
> The canonical target storage model — one bare repo per remote + leased per-MR worktrees under
> `/harness-data/` — is defined in [Git Management](../4-subsystems/git-management.md) and
> Platform Architecture §6.1.

---

## Phase 2 — Tool inventory

### Repowise MCP (available immediately)

15 tools total: 10 default single-repo + 2 opt-in single-repo + 3 workspace-only
(verified against repowise v0.21.0).

`get_context` is the primary consolidation point — use `include=[...]` to pull callers/callees,
community, architecture diagrams, skeletons, health, and freshness into one call. `get_why` covers
decisions and ADR lineage. Six tools removed in unreleased (capabilities folded into these two):
`annotate_file`, `get_callers_callees`, `get_community`, `get_graph_metrics`,
`get_architecture_diagram`, `update_decision_records`.

Tool surface is configurable: `mcp.tools` block in `.repowise/config.yaml`, or `--tools`/`--all`
flag on `repowise mcp`. langgraph-harness uses `--all` (wired in `tools.ts`) to enable all single-repo tools.

**Single-repo default (10):**

```
get_overview        architecture summary, entry points, hotspots, bus factors
get_answer          RAG with citations and confidence level
get_context         triage cards: docs, ownership, decisions, freshness, skeletons, callers/callees, community
                    include=["skeleton"]           — indexed file with bodies elided (cheap context)
                    include=["callers_callees"]    — replaces removed get_callers_callees
                    include=["community"]          — replaces removed get_community
                    include=["health"]             — per-file score + top biomarkers
get_symbol          resolve symbol to source + location
search_codebase     semantic + FTS hybrid search over wiki
get_risk            hotspot score, dependents, will_break, missing_tests, security signals
get_why             architectural decisions, git archaeology, ADR lineage (replaces update_decision_records for reads)
get_health          biomarkers per file, refactoring targets, coverage
get_dead_code       unreachable code by confidence tier
list_repos          repos registered in the workspace/index (routing registry)
```

**Single-repo opt-in (2 — enabled via --all):**

```
get_dependency_path dependency path between files/modules
get_execution_flows dynamic flows from entry points
```

**Workspace-only (3 — deferred):**

```
get_blast_radius    cross-repo downstream impact — services that will break or may drift
get_conformance     architecture rule violations + dependency cycles
                    reads conformance: rules from .repowise-workspace.yaml; cycle detection always on
get_architecture    whole-system coupling score — architecture type, propagation cost %, per-service roles
```

**Workspace-mode `get_risk` extras (deferred):**

```
When called with changed_files=[...] against a workspace MCP server:
  will_break_consumers          — services structurally depending on the changed repo
  missing_cross_repo_cochanges  — services that historically co-change but aren't in the diff
  breaking_changes              — incompatible contract changes with exact impacted consumer files
  conformance_violations        — declared dependency-rule breaches
  dependency_cycles             — circular service dependencies
```

### GitLab MCP (already wired in tools.ts)

```
MR tools       get_merge_request, get_merge_request_diffs, list_merge_request_changed_files
Issue tools    get_issue, list_issue_links, list_issue_discussions
Note tools     create_merge_request_note, create_merge_request_thread
Sprint tools   list_milestones, list_merge_requests, list_issues
Pipeline tools list_pipeline_jobs, get_pipeline_job_output
```

### Lifecycle operations — deterministic LangGraph nodes (not LLM tools)

Operational/lifecycle operations are **pure LangGraph nodes**, not agent-callable tools. No LLM
involved — just conditional logic + subprocess calls. Each node emits `node_start` / `node_progress`
/ `node_end` events to the timeline stream alongside the existing tool events.

```
check_index   repowise status <path> — index age, last commit, page count
              emits: node_start → node_end {indexed: bool, age_days, page_count}

init_repo     repowise init <path>                [one-time; blocks until complete]
              emits: node_start → node_progress (init output lines) → node_end

sync_repo     git fetch + git reset --hard origin/<branch> + repowise update <path>
              emits: node_start → node_end {updated_files}
```

**Worktree / workspace lifecycle (deferred — Phase 3):**

```
create_worktree(repo, branch, dest)   git worktree add
delete_worktree(path)                 repowise delete -p <path> -f + git worktree remove
delete_repo(path)                     repowise delete -p <path> -f
generate_claude_md(path)              repowise generate-claude-md <path> --stdout
```

**`delete_repo` ordering:** `repowise delete -p <path> -f` first (removes all generated data), then remove the directory. Reversing leaves orphaned data.

**Throwaway workspace tools (Tier 2 MRs only — wired in Phase 5):**

```
create_mr_workspace(group, mr_alias, worktree_path)
  1. mkdir /opt/harness/mr-workspaces/<mr_alias>/
  2. repowise workspace add <worktree_path> --alias <mr_alias> --no-index  [MR branch]
  3. repowise workspace add <repo_path> --alias <alias>  [each base-branch repo in the group]
  4. repowise update --workspace --index-only            [rebuild system graph against MR branch code]
  returns: contract diff via system_graph.json — broken consumers, renamed/removed contracts

delete_mr_workspace(mr_alias)
  rm -rf /opt/harness/mr-workspaces/<mr_alias>/   [throwaway — no repowise delete needed, data lives here only]
```

No MCP server is spun up — all CLI subprocesses. When `repowise update --workspace` runs, it diffs the MR
branch contracts against the previously-indexed (base branch) set and populates `breaking_changes` in the
`get_risk` PR-mode directive: exact incompatible changes (removed route/field, type change, newly-required
field) with the specific consumer files that call them. Output also in `.repowise-workspace/breaking_changes.json`.
Conformance violations and dependency cycles are similarly surfaced via `conformance.json`.

**CLI vs MCP split:** Analysis commands (`repowise risk`, `repowise health`, `repowise dead-code`, `repowise search`) all have direct MCP equivalents (`get_risk`, `get_health`, `get_dead_code`, `search_codebase`). Agents always use the MCP tools — CLI analysis commands are never called from agent code.

`watch` mode is not used — harness receives push events explicitly via GitLab webhook, so index updates are triggered manually and deterministically via the `sync_repo` node.

### Memory layer (supermemory — to build)

```
store_context(record)          persist MR/issue/incident context record
recall_context(query, files?)  retrieve prior decisions, risk signals, outcomes
```

### Still to integrate (separate MCPs / custom wrappers)

```
Serena MCP         code editing — required for auto-fix agent (read-write, separate from repowise)
Sentry tools       custom API wrapper — get_sentry_issues, get_sentry_error_detail
load_custom_rules  load team-defined architecture/naming/pattern rules per repo
Slack MCP          informal context ingestion → structured facts / issues
```

---

## Phase 3 — LangGraph node flow

All lifecycle steps are deterministic LangGraph nodes. The LLM is only entered at the reviewer node.
Each node emits events (`node_start`, `node_progress`, `node_end`) that feed the frontend timeline
alongside tool events.

**Current (no workspace, manual trigger):**

```
START
  │
  ▼
ensure_repo node
  runs: git clone <url> <path>   [if repo not on disk]
        git fetch origin          [if already cloned]
  emits: node_start → node_end {cloned: bool}
  │
  ▼
check_index node
  runs: repowise status <path>
  ├─ not indexed       → init_repo node
  │                      runs: repowise init <path>   [blocks; streams progress lines]
  │                      emits: node_start → node_progress (init lines) → node_end
  ├─ indexed, stale    → sync_repo node
  │                      runs: repowise update <path>
  │                      emits: node_start → node_end {updated_files}
  └─ indexed, fresh    → (skip)
  emits: node_start → node_end {indexed: bool, age_days, page_count}
  │
  ▼
mr_reviewer node   ← LLM enters here
  tools: get_risk, get_health, get_context, get_why, get_execution_flows,
         get_dependency_path, get_symbol, search_codebase, gitlab MR tools, CI pipeline tools
  │
  ▼
END
```

**Future (webhooks + worktrees — deferred):**

```
trigger
  │
  ▼
ensure_repo node   [clone or fetch]
  │
  ▼
check_index node
  ├─ not indexed    → init_repo node
  ├─ stale          → sync_repo node
  └─ fresh          → (skip)
  │
  ▼
parallel MR check node
  ├─ no conflict → use base checkout directly
  └─ conflict    → create_worktree node → (worktree ready)
  │
  ▼
[reviewer + impact + context nodes — Phase 4 full graph]
  │
  ▼
MR push → ensure_repo + sync_repo nodes → re-run reviewer
MR close → delete_worktree node (if created)
```

---

## Phase 4 — Specialized agents

LLM agent nodes only. Deterministic lifecycle nodes are in Phase 3.
Each agent gets a named toolset — only the tools it needs.

| Agent                | Toolset                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **mr-reviewer**      | get_risk, get_health, get_context (include callers_callees), get_why, get_execution_flows, get_dependency_path, get_symbol, search_codebase, gitlab MR tools, CI pipeline tools |
| **impact-analyzer**  | get_blast_radius¹, get_risk, get_conformance¹, get_context                                                                                                                      |
| **context-builder**  | get_context, get_why, get_overview, search_codebase, gitlab issue tools, store_context                                                                                          |
| **doc-writer**       | get_overview, get_dependency_path, get_context, generate_claude_md                                                                                                              |
| **issue-triager**    | search_codebase, get_context, get_why, recall_context, gitlab issue tools                                                                                                       |
| **test-generator**   | get_context (include callers_callees), get_risk (missing_tests), gitlab MR diff tools                                                                                           |
| **security-scanner** | get_risk (security signals), get_conformance¹, get_context, load_custom_rules                                                                                                   |
| **release-agent**    | gitlab MR/milestone/commit tools (LLM generates changelog — no repowise needed)                                                                                                 |
| **auto-fix**         | Serena MCP, get_context, get_risk, gitlab MR tools                                                                                                                              |
| **memory-writer**    | store_context, recall_context (post-review, backfills outcome)                                                                                                                  |
| **sentry-fixer**     | Sentry tools, get_context, Serena MCP                                                                                                                                           |
| **design-handoff**   | Figma MCP, get_context                                                                                                                                                          |

¹ Workspace-only tools — deferred until workspace phase.

Agent nodes run after the deterministic lifecycle nodes complete. Which agents activate depends on
trigger type and tier (Phase 5 router).

---

## Phase 5 — Router (last)

Only added once the base flow is working end-to-end.

Routing signals: `get_risk` score + percentile, diff stats (files changed, paths, size), MR labels, trigger type.

| Tier         | Condition                                          | Agents activated                                |
| ------------ | -------------------------------------------------- | ----------------------------------------------- |
| 0 — trivial  | docs/config/test-only, tiny diff, low risk         | mr-reviewer only (no repowise tools)            |
| 1 — standard | normal change, moderate blast radius               | mr-reviewer + impact-analyzer + context-builder |
| 2 — deep     | core/auth/shared touched, high risk, cross-cutting | all review agents + memory recall               |

Non-MR triggers (issue created, sprint end, Sentry error) route directly to the relevant agent — no risk-based tiering needed.
