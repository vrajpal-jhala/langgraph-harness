# langgraph-harness — Context Management

> **Domain owned by this document:** how context is **gathered, assembled, measured, and
> bounded** for every LLM request. This covers the read-only repository surfaces the LLM uses
> (Filesystem MCP, Git tool, Repository Context Layer), context collection and budgeting, and the
> Context Meter.
>
> **Shared concepts are not redefined here.** _Run_, _Workflow_, _Thread_, and _Event_ are
> defined in **[Platform Architecture → §3 Core Concepts](../3-architecture/platform-architecture.md#3-core-concepts)**.
> **Context** as a platform primitive is defined there too; this document details how it is
> produced and controlled. See Platform Architecture.
>
> **Boundary:** internal git plumbing and repository/worktree _lifecycle_ belong to
> **[Git Management](./git-management.md)**; the semantic code-intelligence engine belongs to
> **[Code Intelligence](./code-intelligence.md)**. This document owns only the context surfaces
> and their measurement.

**Context** is everything assembled into a single prompt: system prompt, conversation, memory,
retrieval, repository content, tool schemas, tool results, MCP resources, and the current
message. Two mechanisms manage it: the **Context Budget Manager** trims collection up-front; the
**Context Meter** measures each assembled prompt and drives compaction.

---

## Read surfaces exposed to the LLM

Repository exploration relies on **local filesystem + git** against the MR's worktree (provided
by [Git Management](./git-management.md)), not repeated GitLab API calls. The LLM never runs
shell commands and never mutates repository contents.

### Filesystem MCP (read-only)

Expose only read operations:

```
list_directory   read_file   read_multiple_files
directory_tree   search_files   search_text   stat
```

Do **not** expose `write`, `move`, `delete`, or `mkdir`.

### Git tool (intent-based, read-only)

Expose intent-based operations, never arbitrary git commands:

```
get_diff        get_diff_for_file   list_changed_files
get_commit      get_merge_base      git_log
git_blame       show_commit
```

### Repository Context Layer

Higher-level intent tools so the LLM need not hand-search the repository:

```
find_definition      find_references        read_related_files
get_directory_summary  get_module_context   search_symbols
search_imports         search_callers       search_implementations
```

These are an **interface**: the implementation can evolve from filesystem traversal to
Tree-sitter / LSP / a code graph **without changing the LLM-facing contract**. In langgraph-harness this
tier is realised by **[Code Intelligence (repowise)](./code-intelligence.md)**.

---

## Context Collection

Collection is explicit and ordered, so the highest-value material survives the budget:

```
Changed files → Related files → Tests → Configuration
    → estimate token usage → prioritize → trim or summarize → send to LLM
```

Typical exploration flow: GitLab MR metadata → git diff → filesystem exploration → (post results
back via GitLab). One fetch per repository before analysis; tools never fetch themselves.

## Context Budget Manager

Bounds collection _before_ assembly to prevent exceeding model context limits while preserving
the most relevant information: estimate token usage across the collected material, prioritize,
then trim or summarize. This is the up-front counterpart to the Context Meter's per-request
accounting below.

---

## Context Meter

The Context Meter measures, visualizes, and manages the context window of **every** LLM request.
Unlike assistants that show only a single usage percentage, langgraph-harness exposes **what** consumes
context, **how** it changes over time, and **why** — model-agnostic, with accurate measurement
for self-hosted Ollama models.

**Placement.** It runs immediately after prompt assembly and before the LLM call, so it naturally
covers system prompt, conversation, memories, retrieval, tool schemas, tool results, MCP
resources, and the current message.

```
Prompt assembly → Context Meter (estimate · section usage · emit event · decide compaction)
    → call Ollama → receive prompt_eval_count → update actual usage / timeline
```

### Live estimation + calibration

Ollama returns `prompt_eval_count` / `eval_count` only **after** generation, so it cannot drive a
live indicator. Before each request langgraph-harness estimates locally using the exact deployed model's
Hugging Face tokenizer (e.g. `Qwen/Qwen3.6-35B-A3B`), loaded once and cached. After the response
it compares estimate vs. `prompt_eval_count` and learns the average wrapper/template overhead —
producing increasingly accurate live estimates.

```
Estimated 153201   Actual 153224   Difference 23
```

### Breakdown & explorer

Usage by section (System, Conversation, Repository, Memory, Retrieval, Tools, Current message)
with drill-down into folders → files → token counts, and the same for retrieved documents, MCP
resources, memories, and tool outputs — full transparency into the constructed prompt.

### Timelines

- **Total timeline** — context per request over a Run, so gradual growth is visible.
- **Delta timeline** — explains each change: `+8,412 Repository search`, `+1,224 Tool output`,
  `-18,500 Conversation compacted`, `+384 User message`. Answers _why did context change_, not
  just _how large is it now_.

### Budget & remaining capacity

A progress bar with thresholds — green <60%, yellow 60–80%, orange 80–90%, red >90% — plus
remaining capacity in tokens **and** intuitive units (≈ pages, ≈ large source files), since
developers reason about headroom more easily than percentages.

### Automatic compaction

Above a configurable threshold (~80–85%), compact: summarize older conversation, drop obsolete
tool outputs, compress retrieval — while preserving recent conversation, long-term memories, and
system prompts. Compaction is a visible timeline event (`Compacted conversation — recovered
18,542 tokens`).

### Data model

```
ContextUsage       estimatedTokens · actualTokens · contextLimit · percentage
SectionUsage       system · conversation · retrieval · repository · memories · tools · mcp · currentMessage
ContextDelta       source · change · timestamp
RunContextSnapshot timestamp · totalTokens · estimated · actual
```

(Context-growth signals and token/context figures feed [Behavioral Observability](./analytics.md).)

---

## Future enhancements

- **Cost estimation** — approximate input/output cost for hosted providers.
- **Token heatmap** — highlight files by token contribution so large files stand out.
- **Context diff** — compare two Runs and attribute the largest increase.
- **Prompt reconstruction** — inspect the exact prompt sent, for debugging, prompt engineering,
  reproducibility, and auditing.

**Guiding principle.** The Context Meter answers not just _"how much context am I using?"_ but
_what is consuming it, why did it change, what changed since last request, how much room remains,
what can be compacted,_ and _what exactly was sent to the model_ — the observability that makes
langgraph-harness an Engineering Context Platform rather than another chat interface.
