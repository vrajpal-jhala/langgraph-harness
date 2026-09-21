---
name: create-github-issue
description: Draft a GitHub issue for this repo, saved to <short-kebab-title>.md at the repo root for review before it's filed. Use whenever the user wants to create or draft a GitHub issue for this repo, e.g. "create a github issue for X" — including turning any rough idea into one.
---

Discuss the item with the user until they have no more concerns, then write its `<short-kebab-title>.md`. If drafting several items in one sitting, do them one at a time rather than batching — each needs its own back-and-forth before it's committed to a file. Write every paragraph in the draft (and in this skill) as a single line in the source, no matter how long — Markdown collapses a paragraph to one flow regardless, so a mid-sentence line break only makes the raw file harder to edit and diff.

## 1. Draft the content

Sections: Summary, Why, Acceptance Criteria, Notes. Title and labels are tracked separately from these — see step 2 — never as a heading or section inside the body: GitHub already renders both natively (title field, labels sidebar), so writing them into the body just duplicates what the issue page already shows.

- **Summary/Why**: usually needs asking, not assuming — a bare idea or short phrase doesn't say what problem it solves or what "done" looks like. Ask.
- **Acceptance Criteria**: for a normal dev task, checkboxes of observable, testable behavior — what a reviewer can verify from the outside (when something fires vs. skips, what changes for the caller/user, what stays unchanged) — never implementation steps (which file to edit, which function or schema field to add, which existing helper to reuse). If a checkbox reads like a diff summary rather than something you could verify by exercising the feature, it belongs in Notes instead. For a research/monitoring item (how does the model react to X, monitor loop-detection accuracy) — phrase criteria as findings to produce, not pass/fail behavior: "write up observed failure modes for prompt variant A vs B", "report loop-detection false-positive rate over N sampled runs".
- **Notes**: context and pointers only (relevant files, a concrete trigger condition for deferred work, open questions) — this is also where implementation-level specifics steered out of Acceptance Criteria land (which file/function to touch, an existing helper to reuse, a schema key's exact type) — never restate what a label already says. "Not urgent yet" or "high priority" duplicates `priority: low`/`priority: high`; if it's worth saying, say the _reason_ (e.g. "revisit once X grows past Y"), not the priority itself. When pointing at code, name the file and a grep-able symbol/string (a function name, a marker), never a line number — line numbers go stale the next time the file changes, while a symbol is still findable by search even after it moves.
- **Relating to another issue**: reference it in prose with GitHub's own auto-linking (`#123`, or `owner/repo#123` for cross-repo) — GitHub turns these into real linked references automatically, no separate link-creation step needed.
- **Title**: `type: Title`, using the same lowercase Conventional Commits type as this repo's branch names/commit subjects (`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `test`). Settle on it while discussing the draft — it's what names the file (step 2) and fills `--title` (step 3), not something written inside the body.
- **Labels**: one `type: *` (`type: bug`, `type: feature`, `type: refactor`, `type: performance`, `type: maintenance`, `type: documentation`, `type: security`) and, if the conversation makes one obvious, one `priority: *` (`priority: high`, `priority: medium`, `priority: low`). These must already exist on the repo (`gh label list`) — if the one you need is missing, create it first: `gh label create "type: performance" --color <hex> --description "..."`. Don't invent a new label for a one-off item; pick the closest existing type. Settle on these the same way as the title — they fill `--label` in step 3, not a section in the body.

## 2. Write the file

Save to `<short-kebab-title>.md` at the repo root, named after the issue's title. This is a local scratch file, not something this skill files from on its own. Start the file directly at `## Summary` — no title heading above it (see Title, above).

## 3. Move on

Once the user confirms the draft has no more concerns, ask how they want it to land on GitHub:

- **Create it now**: `gh issue create --title "<type: Title>" --body-file <short-kebab-title>.md --label "type: <x>" [--label "priority: <x>"]` — but only after the user explicitly confirms, since this is a write to a shared system. Then delete the local draft file.
- **Manual copy-paste**: tell the user the intended title and labels in chat (they go in GitHub's separate title field and labels picker, not the body), then leave the file for them to paste as the description; delete it once they confirm it's been created.

Either way, the draft file doesn't stick around — go on to the next item.
