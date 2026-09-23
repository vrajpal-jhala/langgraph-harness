---
name: sync-architecture
description: >
  Check whether the work just done on this branch changes anything docs/architecture.md
  describes (harness structure, tool surface, data flow, or a Built/Partial/Pipeline status),
  and update the diagram and status prose in place if so. Use when the user says "sync
  architecture doc", "update architecture diagram", "/sync-architecture" — or when invoked by
  the update-changelog skill after it scopes a change touching harness/memory/ops structure.
---

Root `docs/architecture.md` is the source of truth for langgraph-harness's system architecture: four
harnesses (MR Review, Work Item Resolve, Task Resolve, Chat), the Memory layer, and LLM Ops, rendered as a
mermaid diagram with 🟩 Built / 🟨 Partial / ⬜ Pipeline status classes, plus matching
"Status breakdown" prose and a "Phasing note".

## 1. Scope the change

If invoked from the `update-changelog` skill, reuse the diff range it already computed — don't
recompute it.

Otherwise, diff since the last commit that touched the doc:

```
git log --oneline -- docs/architecture.md | head -1
git log --oneline <that-commit>..HEAD
git diff <that-commit>..HEAD
```

Only two kinds of change are "worthy" of a doc update:

- **Structural** — a component (node) added or removed, a harness's tool surface or data
  flow changed, a queue/loop/guardrail's actual behavior changed.
- **Status transition** — something the doc marks ⬜ Pipeline or 🟨 Partial actually shipped
  (now 🟩 Built), partially shipped (⬜ → 🟨), or something built regressed.

Skip anything else — internal refactors that don't change the shape described, dependency
bumps, test-only changes, prompt wording tweaks that don't change tool surface. If nothing in
the diff is worthy, say so explicitly and stop.

## 2. Update in place

Match the doc's existing density and tone — it names exact gaps ("a hard numeric cap on
comment count, which doesn't exist yet") rather than vague hand-waving. Don't soften or
generalize what you write.

- **Mermaid diagram**: add/remove/rename nodes and edges as needed; move a node between the
  `built`/`partial`/`pipeline` classDef groups on a status transition.
- **Status breakdown**: edit the matching bullet under the harness's `### 🟩 Built` /
  `### 🟨 Partial` / `### ⬜ Pipeline` section — move the bullet to its new section on a status
  transition rather than just rewording it in place.
- **Phasing note**: update only if the change affects sequencing (something planned for
  Phase 2 shipped in Phase 1, a stated prerequisite got resolved or introduced).

Don't restructure sections, rename harnesses, or change the diagram's overall layout beyond
what the change actually requires.

## 3. Commit

```
git status --short -- docs/architecture.md
```

Stage and commit just the doc, separately from the code change and from any changelog bump:

```
docs: sync architecture diagram
```

Count this subject line against this repo's 50/72-char limit (see `CLAUDE.md`). Don't fold in
unrelated uncommitted changes.
