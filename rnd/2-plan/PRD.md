# Product Requirements Document: Engineering Context Platform

> **Domain:** product requirements — problem, personas, capabilities, success metrics, delivery
> phases. It defines _what_ to build and _why_, not _how_. The architecture and its concepts
> (_Thread/Run/Event/Workflow/Artifact_) are canonical in
> **[Platform Architecture](../3-architecture/platform-architecture.md)**. See Platform Architecture for structure.

## Overview

This platform is an AI-powered engineering productivity system built around a shared organizational memory. It integrates with the tools engineers already use — GitLab, Figma, observability systems, and communication channels — and provides a layer of context-aware automation across the software delivery lifecycle.

The core bet is that most developer productivity tools fail because each agent operates in isolation. An MR reviewer that doesn't know why an API exists, a documentation generator that doesn't know what changed and why, a test generator that doesn't know the acceptance criteria — these produce shallow, low-trust outputs. The solution is not better individual agents; it is a shared knowledge foundation that every agent can query.

The platform is not a collection of bots. It is an **Engineering Context Platform**: a continuously updated institutional knowledge graph that makes historical decisions, system relationships, and engineering context discoverable and actionable.

---

## Problem Statement

Engineering teams lose context at every transition:

- When a developer joins, they reverse-engineer why the codebase is the way it is.
- When an MR is reviewed, the reviewer lacks context on the requirements that drove the change.
- When an incident occurs, responders spend hours tracing which services changed and why.
- When a design decision is made, it lives in a Slack thread or meeting notes and disappears.
- When a sprint ends, the reasoning behind prioritisation is never recorded.

The result is an organisation that accumulates code but loses knowledge. Agents built on top of this environment inherit the same problem — they can see what changed, but not why.

---

## Vision

A continuously updated, queryable knowledge layer that captures:

- **What** changed in the codebase and when
- **Why** it changed — the issue, user story, discussion, or incident that drove it
- **Who** made the decision and who approved it
- **What alternatives** were considered and rejected
- **What downstream effects** the change had or may have

Every agent in the platform is a consumer and contributor of this shared memory. Over time, the system becomes the institutional brain of the engineering organisation.

---

## User Personas

**Developer** — wants fast, context-rich feedback on MRs; doesn't want to write boilerplate documentation; needs help tracing why something was built a certain way.

**Tech Lead / Engineering Manager** — wants consistent engineering standards enforced without manual review; wants visibility into decisions made across the team; needs accurate release notes and sprint summaries.

**Product Manager** — wants to verify that implemented features match the original user stories; needs a bridge between design artefacts and code.

**New Team Member** — needs an onboarding guide that explains the architecture, key services, and non-obvious conventions.

**On-call Engineer** — needs to trace a live incident to the relevant services, recent changes, and historical context quickly.

---

## Core Capabilities

> **v1 scope** ([Platform Architecture §10, Decision 5](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts)):
> v1 delivers capability 2 (Merge Request Agent) plus a subset of capability 1
> (context records with structural + semantic recall — no entity graph yet), gated on the
> **review comment acceptance rate** measured against a golden MR eval set. Capabilities 3–9 and
> the full memory layer are **future scope** — sequenced behind that gate, not removed.

### 1. Engineering Memory Layer

The foundational capability. All other agents depend on it.

**What it does:** Continuously ingests engineering artefacts from GitLab (issues, MRs, comments, review threads, commits, labels, approvals, milestones) and extracts structured facts: service ownership, architectural decisions, API changes, incident causes, user story mappings, dependency relationships, and decision rationale.

**Key behaviours:**

- Facts are stored with temporal metadata — the system knows not just what is true now, but what was true at a given point in time.
- When a fact is superseded (e.g. an ADR is replaced), the system records both the old and new fact and the relationship between them.
- The graph is entity-centric: Service, Repository, Issue, MR, ADR, Incident, Team, Developer, API, and Dependency are first-class objects with typed relationships.
- The system handles contradictions — when new information conflicts with stored facts, it updates the graph and preserves the history.

**Example queries the memory layer must answer:**

- Why was the JWT refresh endpoint introduced?
- Which services were affected by Incident #456?
- Who approved the decision to use Redis over DynamoDB?
- What user story drove MR #789?
- What changed in the auth service between the last two releases?

---

### 2. Merge Request Agent

**Trigger:** Developer opens or updates an MR.

**Capabilities:**

- **MR Description Generator** — Drafts a structured description from the diff: what changed, why (linked to issues/user stories), how to test, impacted services.
- **Code Review Assistant** — Reviews the diff for logic errors, missing edge cases, security issues, and violations of team coding standards. Flags issues with inline comments.
- **User Story Verification** — Cross-references the MR changes against the linked issue or user story acceptance criteria and reports any gaps.
- **Custom Rules Enforcement** — Applies team-defined rules (architecture patterns, naming conventions, forbidden patterns) beyond what a linter checks.
- **Impact Analysis** — Uses the memory layer to surface which services, APIs, and downstream consumers may be affected by the change.
- **Efficient Re-review** — On subsequent pushes, identifies only the delta from the last reviewed version and focuses review on what changed, rather than re-reviewing the entire diff.
- **Auto Commit Fix** — For simple, well-understood issues (formatting, obvious null checks, naming), proposes or applies the fix directly.
- **Test Case Generation** — From the changed code and linked requirements, generates test stubs covering the happy path, edge cases, and failure scenarios.

---

### 3. Issue and Bug Triage Agent

**Trigger:** New issue or bug report created in GitLab.

**Capabilities:**

- Reads the issue and produces a structured triage summary: affected service, likely cause, severity assessment, suggested owner.
- Cross-references the memory layer to find related past issues, incidents, and MRs.
- Suggests labels, milestone, and assignee based on service ownership and historical patterns.
- Converts informal chat messages or meeting notes into structured GitLab issues with title, description, acceptance criteria, and labels.

---

### 4. Documentation Agents

**API Documentation Writer** — From a service's routes and models, drafts or updates API documentation covering endpoints, request/response shapes, error codes, and authentication requirements.

**Architecture Decision Records Drafter** — When a technical decision is described (in a comment, issue, or prompt), produces a full ADR: context, decision, rationale, alternatives considered, and trade-offs. Stores the ADR in the memory layer as a first-class fact.

**Onboarding Guide Generator** — Reads the repository, service map, and memory layer to produce a getting-started document: architecture overview, key services, how to run locally, ownership map, and common gotchas.

**Service Dependency Mapper** — Reads multiple repos and the memory layer to produce a plain-English summary and structured representation of how services depend on each other.

---

### 5. Sprint and Release Agents

**Sprint Retrospective Summariser** — Takes raw retro notes and produces a structured summary: what went well, what didn't, and action items with owners. Stores outcomes in the memory layer.

**Release Notes Generator** — From merged MRs in a sprint, produces user-facing or internal release notes grouped by feature, fix, and improvement.

**Commit Message Standardiser** — Takes a diff or draft commit message and rewrites it to match the team's agreed convention.

---

### 6. Design Handoff Agent

**Figma-to-Dev Handoff Notes** — Reads a Figma design and generates developer implementation notes: component breakdown, spacing, responsive states, edge cases, and interaction behaviour. Reduces the time developers spend reverse-engineering designs.

**Figma Component Audit** — Reviews a Figma file for inconsistencies: duplicate components, mismatched spacing, missing responsive variants, and deviations from the design system.

**UI-Kit Connector** — Maintains a live mapping between Figma components and codebase components, enabling design and code to stay in sync.

---

### 7. Observability Agents

**Log Analyser** — Analyses structured logs to identify anomalies, recurring errors, and patterns. Surfaces findings with context from the memory layer (which service, which recent changes, which team owns it).

**Sentry + Autofix** — Ingests Sentry errors, traces them to the relevant code, and proposes or applies fixes. Stores incident context in the memory layer for future reference.

---

### 8. Security Agent

**Security Scan** — Runs static analysis against MRs and repositories. Goes beyond linting by combining rule-based pattern matching with LLM reasoning to identify logic-level security issues — injection risks, authentication gaps, insecure defaults, and OWASP top-10 violations — that linters miss.

---

### 9. Scrum Bot

**Sprint Planning and Reporting** — Assists with sprint briefing and planning, tracks progress against commitments, and generates end-of-sprint reports.

---

## Knowledge Extraction Requirements

Raw artefacts (issues, MR diffs, comments) are not stored as-is in the memory layer. Each ingestion pipeline extracts canonical facts before storage.

Example fact types:

| Entity    | Fact Type    | Example                                 |
| --------- | ------------ | --------------------------------------- |
| Service   | ownership    | Auth Service owned by Platform Team     |
| Service   | dependency   | Auth Service depends on Redis           |
| MR        | modification | MR #456 modifies Auth Service           |
| Issue     | affects      | Issue #123 affects Auth Service         |
| ADR       | decision     | ADR-7 selected Redis over DynamoDB      |
| ADR       | rationale    | Redis selected for latency requirements |
| ADR       | supersession | ADR-7 supersedes ADR-3                  |
| Incident  | cause        | Incident #456 caused by JWT expiry bug  |
| Developer | reviewer     | Alice reviewed MR #456                  |
| API       | introduction | /refresh-token introduced by MR #456    |

The extraction pipeline runs as part of each agent's workflow and also as a background ingestion job over the full GitLab history.

---

## Non-Functional Requirements

**Latency** — MR-triggered agents (review, description generation) must complete within a timeframe that does not disrupt the developer's workflow. The review agent should return results before a human reviewer would typically begin.

**Incremental re-review** — On MR update, agents must only process the delta, not the full diff. This is critical for adoption — developers who push small fixes must not wait for a full re-review.

**Traceability** — Every agent output that makes a claim (e.g. "this change affects Service B") must include a reference to the source fact in the memory layer. Agents must not hallucinate relationships.

**Memory freshness** — The memory layer must reflect the current state of repositories and issues within a defined lag. Stale facts that have been superseded must not be returned as current.

**Auditability** — Decisions stored in the memory layer must include who recorded them and when. The system must support queries over historical state ("what did we know about Service X in April?").

**Self-hosted** — All components run within the organisation's infrastructure. No engineering artefacts, code, or internal decisions leave the organisation's control.

**Integration surface** — All agents are accessible via GitLab webhooks, direct API calls, and a simple web UI. No new tool should require developers to change their existing workflow significantly.

---

## Out of Scope (Initial Version)

- Real-time collaboration features
- User authentication and RBAC (handled at the integration layer)
- Ingestion from sources other than GitLab and Figma
- Natural language chat interface (agents are task-triggered, not conversational)
- Automated deployment or infrastructure changes based on agent output

---

## Success Metrics

- **Review comment acceptance rate** _(headline metric and v1 gate)_ — percentage of
  agent-flagged issues that a human reviewer agrees with and acts on, measured on a golden MR
  eval set. This is the adoption-critical number: a noisy reviewer gets muted. All post-v1
  expansion is gated on it (Platform Architecture §10, Decision 5).
- **MR description completeness rate** — percentage of MRs with a structured description generated before human review begins.
- **Time-to-context** — time for a new team member to find the answer to "why does Service X exist?" using the memory layer.
- **Incident trace time** — time to identify the relevant recent change and responsible team for a live incident, compared to before the platform.
- **Memory coverage** — percentage of services, MRs, and ADRs with at least one structured fact extracted and stored.
- **Re-review efficiency** — reduction in review turnaround time on subsequent MR pushes.

---

## Phased Delivery

> Phase 1 is the **v1 gate**: phases 2–5 are entered only after the review comment
> acceptance-rate target is met on the golden MR set. They remain committed scope — sequenced,
> not cut. (Platform Architecture §10, Decision 5.)

### Phase 1 — Foundation (v1 — the gate)

- GitLab ingestion pipeline (issues, MRs, comments)
- Context records with structural (files/symbols) + semantic recall
  (canonical fact schema / entity graph deferred to Phase 2+)
- MR Description Generator
- Code Review Assistant (basic diff review)
- Golden MR eval set + review comment acceptance-rate tracking

### Phase 2 — Context Awareness _(post-gate)_

- Full memory extraction pipeline over historical GitLab data (canonical fact schema,
  entity graph — promoted once extraction quality is proven)
- User Story Verification
- Impact Analysis on MRs
- Issue Triage Agent
- Service Dependency Mapper

### Phase 3 — Decision Intelligence _(post-gate)_

- ADR Drafter and storage
- Onboarding Guide Generator
- Release Notes Generator
- Efficient Re-review (delta-only)

### Phase 4 — Observability and Security _(post-gate)_

- Log Analyser
- Sentry integration and Autofix
- Security Scan agent
- Custom rules engine for MR review

### Phase 5 — Design and Planning _(post-gate)_

- Figma-to-Dev Handoff Notes
- Figma Component Audit
- UI-Kit Connector
- Scrum Bot
