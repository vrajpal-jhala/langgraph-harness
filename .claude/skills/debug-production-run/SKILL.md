---
name: debug-production-run
description: >
  Investigate a specific production thread/run on a `<host>` running this
  app — why an event didn't fire, why a run failed, what a model actually
  saw — by pulling the run's raw event log from the live API and
  cross-referencing it against the current code. Use when the user pastes a
  `<host>/threads/<threadId>` URL, asks "why didn't this run do X", "why is
  this run stuck/failed", or otherwise wants a production run's behavior
  explained rather than reproduced locally.
---

This is a **read-only investigation** skill: it fetches data from the live
production API to explain behavior, never to change it. Never call a
mutating endpoint (`retry`, `abort`, `delete`) against prod through this
skill — those need the user's explicit go-ahead, asked for at the time, same
as any other action affecting shared/production state.

## 1. Get the thread/run id and credentials

A URL from this app looks like:

```
<host>/threads/<threadId>?run=<runId>
```

where `<host>` is whichever address the user pasted — public hostname or an
internal/LAN address, depending on how their instance is deployed. The
`/threads/<id>?run=<id>` shape is the same regardless of `<host>`. `threadId`
is the path segment, `runId` is the `run` query param. If the URL has no
`run=`, the page is showing whichever run the frontend defaulted to — ask
the user which run they mean, or list all runs on the thread first (step 2)
and ask them to pick one.

Auth is per-user GitLab sign-in (see `backend/src/components/auth/index.ts`
and `authMacro` in `backend/src/utils/auth.ts`) — there's no static server
secret to grab from `.env` anymore. To hit the API from a terminal you need
a real, signed-in session cookie:

- Ask the user to open DevTools on a tab where they're already signed into
  `<host>`, go to Application/Storage → Cookies, and copy the value of
  whichever cookie name contains `session_token` (better-auth names it
  `better-auth.session_token`, or `__Secure-better-auth.session_token`
  under HTTPS).
- Only ever ask for that already-issued cookie value — never a password or
  GitLab credential. It grants no more than the user can already do signed
  in via the browser, and expires/rotates like any other session.

**The server enforces this itself** (not nginx), so it's required no matter
which `<host>` you hit — public URL or internal/on-premise address alike.

If self-hosted on-premise, `<host>` may resolve two ways that are
**not interchangeable**:

- An internal/LAN address (ask the user for the current IP/port — these
  aren't guaranteed stable) — only reachable from a machine physically on
  that network.
- A public hostname, through nginx or another reverse proxy — the only
  option from anywhere outside that network.

Don't default to one or try both — determine which applies from where this
session is actually running / what the user tells you. If this environment
has no route to the LAN (the common case — e.g. a cloud-hosted session), an
internal address will simply time out; use the public one. Only use the
internal address if the user has said this session/machine is on that
network. The session cookie is required either way — see above.

## 2. Pull the run

```bash
SESSION_COOKIE='better-auth.session_token=<value from the user>'
HOST="<host, see §1>"
curl -s -H "Cookie: $SESSION_COOKIE" \
  "$HOST/api/threads/<threadId>/runs/<runId>" -o /tmp/.../run.json
```

To list every run on a thread instead (no specific run id yet):

```bash
curl -s -H "Cookie: $SESSION_COOKIE" "$HOST/api/threads/<threadId>/runs"
```

Save the response to a scratch file and read it with `python3 -m json.tool`
or a small inline script — the `events` array is usually large. A quick shape
check before digging in:

```bash
python3 -c "
import json
d = json.load(open('/tmp/.../run.json'))
print('model:', d['input']['model'], '| status:', d['status'])
kinds = {}
for e in d['events']: kinds[e['event']] = kinds.get(e['event'], 0) + 1
print(kinds)
"
```

## 3. Know the event vocabulary

Don't guess event names — the full, current union is defined in
`backend/src/types.ts` (search `event: '`). Cross-reference with
`backend/src/components/workflows/emit.ts` — every event kind has a matching
`emit*Event` function there, which is the fastest way to jump from "this
event is missing/wrong" to "here's the exact code that decides whether to
emit it."

Common investigation pattern: find the `emit*` call for the event in
question, read backwards from there to the condition that gates it (a
threshold check, a config flag, a try/catch that swallows a failure), then
check whether the run's own `input.model`/`input.query`/etc. would satisfy
that condition. The qwen3.6:27b summarization case (missing `tokenizerRepo`
→ pre-check always computed 0 tokens → `summarize_context_start` never
fired, even though `summarize_context_end` did) is the shape of bug this
usually is: an event's _emission_ is gated separately from the _effect_ it's
describing, and the two can drift out of sync per-model or per-config.

## 4. Cross-check against model/provider config if relevant

If the run's behavior depends on which LLM handled it (tokenizer counting,
context window, provider-specific quirks), check `backend/src/utils/config.ts`'s
`llms` array for that model's entry — pay attention to fields that are
`?`-optional (e.g. `tokenizerRepo`), since a missing optional field is a
common silent-degradation bug (falls back to an approximation instead of
erroring).

For Ollama-hosted models, you can query the model's real metadata (tokenizer
family, context length, architecture) directly:

```bash
OLLAMA_BASE_URL=$(grep "^OLLAMA_BASE_URL=" backend/.env | cut -d= -f2)
OLLAMA_API_KEY=$(grep "^OLLAMA_API_KEY=" backend/.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $OLLAMA_API_KEY" \
  "$OLLAMA_BASE_URL/api/show" -d '{"name":"<model-name>"}' | python3 -m json.tool
```

`OLLAMA_BASE_URL` is the public `.../ollama` path — the `Bearer
$OLLAMA_API_KEY` header is only required there because **nginx** is what
enforces it on that path, not Ollama itself. If instead hitting Ollama
directly on-premise by IP/port (bypassing nginx), drop the auth header
entirely — Ollama has no built-in auth, so on the LAN it just answers.
This is the opposite of the server's auth (always required, see §1) — don't
assume the same rule applies to both.

Useful fields: `details.family`, `model_info."tokenizer.ggml.pre"`, and the
various `tokenizer.ggml.*_token_id` values — matching special-token ids
across two models is good evidence they share a tokenizer (see
`Qwen 3.6 (27B)`'s entry in `config.ts`, which points at the 35B's
`tokenizerRepo` for exactly this reason).

## 5. If a route/path/pattern above no longer matches

This skill hardcodes today's shape of things (route paths, header names,
file locations). When the codebase has moved on, don't guess — search
outward from a stable anchor:

- **API route 404s or shape looks different**: routes are all defined in
  `backend/src/components/index.ts` — grep `\.group\(` and `\.get\(`/`\.post\(`
  there for the current path. Auth is applied via `.use(authMacro)` at the
  top of that file; grep `backend/src/utils/auth.ts` for the current
  session-resolution logic if the `Cookie` header stops working.
- **Session cookie name doesn't match**: grep `advanced.cookies` in
  `backend/src/components/auth/index.ts` — an override there changes the
  name away from better-auth's `session_token` default used in §1-2.
- **A `<host>` that used to work stops responding, and it isn't just an
  on-premise-vs-outside mix-up**: prod may have moved — check `APP_URL` in
  `backend/.env` for the current value and confirm the new `<host>` with the
  user.
- **Event shape changed**: re-derive the vocabulary from `backend/src/types.ts`
  and `emit.ts` as in §3, rather than trusting a name listed here.

## 6. Keep this skill current

After any investigation where step 5 kicked in (something here was stale),
update the specific section that was wrong rather than leaving it to rot for
the next session — this skill is only useful if its concrete paths/commands
stay accurate. Don't add speculative future-proofing (e.g. supporting a
routing scheme that doesn't exist yet) — just correct what was actually
found to be wrong, when it's found.
