---
name: create-gitlab-task
description: Draft a GitLab work item for this repo using .gitlab/issue_templates/task.md and its type::*/status::*/priority::* label conventions, saved to <short-kebab-title>.md at the repo root for copy-paste into GitLab. Use whenever the user wants to create or draft a GitLab task/issue for this repo, e.g. "create a gitlab task for X" — including turning any rough idea into one.
---

Discuss the item with the user until they have no more concerns, then write its `<short-kebab-title>.md`. If drafting several items in one sitting, do them one at a time rather than batching — each needs its own back-and-forth before it's committed to a file. Write every paragraph in the draft (and in this skill) as a single line in the source, no matter how long — Markdown collapses a paragraph to one flow regardless, so a mid-sentence line break only makes the raw file harder to edit and diff.

## 1. Draft the content

Fill `.gitlab/issue_templates/task.md`'s sections (Summary, Why, Acceptance Criteria, Notes, `/label` line) for this one item.

- **Summary/Why**: usually needs asking, not assuming — a bare idea or short phrase doesn't say what problem it solves or what "done" looks like. Ask.
- **Acceptance Criteria**: for a normal dev task, checkboxes of observable, testable behavior — what a reviewer can verify from the outside (when something fires vs. skips, what changes for the caller/user, what stays unchanged) — never implementation steps (which file to edit, which function or schema field to add, which existing helper to reuse). If a checkbox reads like a diff summary rather than something you could verify by exercising the feature, it belongs in Notes instead. For a research/monitoring item (how does the model react to X, monitor loop-detection accuracy in prod) — common in this repo since it's about agents/local LLMs — phrase criteria as findings to produce, not pass/fail behavior: "write up observed failure modes for prompt variant A vs B", "report loop-detection false-positive rate over N sampled runs". Don't invent a separate template or label for this; same template, just different Acceptance Criteria phrasing.
- **Notes**: context and pointers only (relevant files, a concrete trigger condition for deferred work, open questions) — this is also where the implementation-level specifics steered out of Acceptance Criteria land (which file/function to touch, an existing helper to reuse, a schema key's exact type) — never restate what a label on the `/label` line already says. "Not urgent yet" or "high priority" duplicates `priority::low`/`priority::high`; if it's worth saying, say the _reason_ (e.g. "revisit once X grows past Y"), not the priority itself. When pointing at code, name the file and a grep-able symbol/string (a function name, a marker like `<project_memories>`), never a line number — line numbers go stale the next time the file changes, while a symbol is still findable by search even after it moves.
- **Relating to another issue** (related/blocks/blocked-by): don't encode it as a plain-text "Related: #N" mention in the description — GitLab has a real linked-items feature for this. Note the target iid and relation while drafting, then wire it with `create_issue_link` in step 4 once the item exists. The description can still explain _why_ it's related in prose, just not as a cross-reference line duplicating what the link already shows.
- **`/label` line**: defaults are `type::task`/`status::backlog`/`priority::medium`. Swap `type::task` for whichever fits (`type::bug`, `type::feature-request`, `type::refactor`, `type::performance`, `type::maintenance`, `type::documentation`, `type::security`) and adjust status/priority if the conversation makes one obvious. If this repo doesn't use `type::user-story`/`type::ux-story`/`type::tech-story` labels (some teams' Agile conventions add these; check the actual label list before assuming), a purely internal/technical item (no user-facing behavior change, e.g. "reuse BE types") is `type::refactor` if it's pure restructuring or `type::maintenance` if it's housekeeping, not a story type. This list can drift — if unsure whether a label still exists or a new one was added, check with the GitLab MCP connector's `list_labels` against this repo's actual GitLab project path (ask the user, or derive it from `git remote get-url origin` if it points at a GitLab host) rather than trusting a hardcoded list.

## 2. Title the draft

The GitLab title field is separate from the description template, so the prefix below is a heading in the draft file, not a section of `.gitlab/issue_templates/task.md`. Prefix by the `/label` line's `type::*` value:

| type::*         | Prefix       |
| --------------- | ------------ |
| task            | `[TASK]`     |
| bug             | `[BUG]`      |
| feature-request | `[FEAT]`     |
| refactor        | `[REFACTOR]` |
| performance     | `[PERF]`     |
| maintenance     | `[CHORE]`    |
| documentation   | `[DOC]`      |
| security        | `[SEC]`      |

Put it as `# [PREFIX] Title` at the top of the draft file, above the Summary section.

## 3. Write the file

Save to `<short-kebab-title>.md` at the repo root, named after the task's title (same convention as this repo's branch names, e.g. `thread-search-rag.md`). This is a local scratch file, not something this skill creates issues from on its own.

## 4. Move on

Once the user confirms the draft has no more concerns, ask how they want it to land in GitLab:

- **Create it now**: call the GitLab MCP connector's `create_work_item` (`project` = this repo's GitLab project path — ask the user, or derive it from `git remote get-url origin` if it points at a GitLab host; `title` from step 2 including the bracket prefix; `description` from step 1's template body; `labels` from the `/label` line; `type: "task"` unless the user says otherwise) — but only after the user explicitly confirms, since this is a write to a shared system. If the draft names another issue as related/blocks/blocked-by, follow up with `create_issue_link` (`project_id`/`issue_iid` = the new item, `target_project_id`/`target_issue_iid` = the other one, `link_type` = `relates_to`/`blocks`/`is_blocked_by`) so it shows up as a real linked item, not just prose. Then delete the local draft file.
- **Manual copy-paste**: leave the file for the user to paste into GitLab themselves; delete it once they confirm it's been created — note any related-issue link for them to wire up manually too, since this path has no tool call to do it automatically.

Either way, the draft file doesn't stick around — go on to the next item.
