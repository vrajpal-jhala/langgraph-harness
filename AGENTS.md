# Agent Instructions

## Implementing Features and Bug Fixes

As you work, maintain an `AI_NOTICE.md` file in the repo root that records:

- What the user asked you to do.
- How much context or direction they gave you.
- How the work evolved — did the user review, correct, or iterate with you, or was this largely autonomous?

**If the user asks you to commit:** include `AI_NOTICE.md` in the commit alongside the code changes.

**If the user asks you to create an MR:** use the content of `AI_NOTICE.md` to fill out the MR description (see below), then delete the file and amend or follow up with a cleanup commit before pushing.

`AI_NOTICE.md` is intentionally a dead man's switch. If a human reviewed the changes, they would remove it. Its presence in a commit or MR signals that the changes were not reviewed before submission.

## Merge Requests

Before creating a merge request, read file `.gitlab/merge_request_templates/ai_disclosure.md` and include template's content in the MR description exactly as specified.

The `ai_disclosure.md` template is **mandatory**. Check the box that accurately reflects your level of involvement, and use the content of `AI_NOTICE.md` verbatim for the agent context paragraph. The goal is genuine insight into how the change was made — not a boilerplate disclaimer.
