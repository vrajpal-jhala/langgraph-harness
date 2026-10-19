---
name: update-server-deps
description: >
  Plan and run an update of a deployment's server-side components: audit what the
  deployment is running, look up newer upstream releases (SGLang, Lightpanda,
  Redis, Postgres, supermemory, OpenSandbox, Docker/containerd/Kata, NVIDIA,
  base images), read their release notes against our config, and sequence the
  host/SGLang bumps and the repo pin PR. Use when the user says "update server
  deps", "what's outdated on the server", "update deployment components", or
  "/update-server-deps" — not for package.json bumps (see bump-npm-deps).
---

You usually can't reach the deployment from the dev machine. The user runs every
command there and pastes the output back — never SSH or run anything on the
deployment unless they explicitly say so. Don't trust a written version table
(docs go stale in days); audit first.

## 1. Audit what the deployment runs

Ask which account runs Docker and which has sudo; they may differ. Send chunks of
~8 lines — long pasted blocks get mangled by the terminal and sections silently
go missing. `<install-dir>` is the checkout the stack is deployed from.

As the account that runs Docker:

```bash
cd <install-dir>
git log -1 --format='%h %s (%cd)' --date=short
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.CreatedAt}}\t{{.Status}}'
docker exec harness_postgres postgres --version
docker exec harness_redis redis-server --version
docker exec harness_lightpanda /bin/lightpanda version
docker exec harness_opensandbox pip show opensandbox-server | grep -E '^(Name|Version)'
```

```bash
docker version --format 'docker-ce {{.Server.Version}}'; docker compose version; docker buildx version
containerd --version; containerd-shim-kata-v2 --version
docker -H unix:///run/docker-kata/docker.sock image ls
systemctl is-active docker containerd docker-kata containerd-kata
docker inspect sglang --format '{{.Config.Image}}'
docker exec sglang pip list 2>/dev/null | grep -iE 'sglang|flashinfer|torch|triton'
```

As an account with sudo:

```bash
uname -r; dpkg -l 'linux-image-*' | awk '/^ii/{print $2,$3}'
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; nvidia-ctk --version | head -1
apt list --upgradable 2>/dev/null | wc -l    # 1 = only the "Listing..." header, nothing pending
sudo iptables -t nat -S POSTROUTING | grep -E '172\.20|MASQ'
sudo ufw status | head -3
```

Skip the lines for components the deployment doesn't use (no GPU host, no Kata,
SGLang elsewhere). Don't `grep` the apt list before judging "nothing pending" —
it hides every package you didn't name. `supermemory` and `monitoring` show only
image IDs; read their versions from the repo pins.

## 2. Look up upstream (from the dev machine)

`gh api repos/<owner>/<repo>/releases/latest --jq '[.tag_name,.published_at[:10]]|join("  ")'` for:
`containerd/containerd`, `kata-containers/kata-containers`, `sgl-project/sglang`,
`lightpanda-io/browser`, `NVIDIA/nvidia-container-toolkit`, `moby/moby`
(`docker-vX` tags), `docker/compose`, `docker/buildx`,
`Tecnativa/docker-socket-proxy`, `alibaba/OpenSandbox`,
`supermemoryai/supermemory` (`server-v*`), `redis/redis`. PyPI for
`opensandbox-server`. Docker Hub tags for `postgres`/`redis` (`X.Y-alpine`) and
`last_updated` for the floating `nginx:alpine`, `python:3.12-slim`, `node:22-slim`.

Pins live in `docker-compose.yml`, `docker-compose.dev.yml`,
`services/supermemory/Dockerfile` (install URL and version),
`services/opensandbox/Dockerfile`, `services/opensandbox/sandbox.toml`
(`execd`/`egress` release tags), `@alibaba-group/opensandbox` in `backend` and
`services/monitoring`, and the matching lines in `docs/deployment.md`. The SGLang
tag exists only in the server's `compose.yaml` (see `docs/sglang-deployment.md`).

Report one short table (component, running, latest). Host packages (Docker,
containerd, NVIDIA, kernel) come through `apt`, not the repo.

**Majors and EOL watch** (report only, never applied in the same window): Node,
Python (the `opensandbox` image) and the Postgres major are migrations, not bumps —
native deps and the `@langchain/core` patch need their own testing. Get Node's
dates from `https://nodejs.org/dist/index.json` and
`https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`, flag
anything in maintenance or nearing end of life, and hand it to `create-github-issue`.

Also check that the `@types/node` major in each package matches the Node major in
its Dockerfile (types newer than the runtime let `tsc` accept APIs Node doesn't have).

## 3. Read the notes before taking latest

Exact pins exist because "latest" has broken deployments before (a published
`opensandbox-server` wheel once omitted a package and crash-looped the service).
For each candidate, grep the release notes for breaking/removed/deprecated and
check it against our config.

- **SGLang:** flags are generated from dataclass fields under
  `python/sglang/srt/arg_groups` (grepping `server_args.py` finds nothing).
  Compare the definitions of every flag in the server's `compose.yaml` between
  the two tags.
- **supermemory:** read the release notes in full — a bump can migrate the
  store (and drop duplicate documents), require the API key, or remove settings
  (`WORKFLOW_ENGINE=direct` in 0.0.9).
- **Lightpanda:** smoke-test old vs new with
  `docker run --rm --entrypoint /bin/lightpanda lightpanda/browser:<v> fetch --dump html <url>`
  (the image entrypoint is tini, so bare `fetch` fails). Cover a redirect and a 404 too.
- **Redis/Postgres:** start the new image locally and ping/query it.

## 4. Apply

Order: host → SGLang → one repo pins PR → deploy. One branch/PR per kind of change.

**Host:** `apt full-upgrade`, reboot. Afterwards check the four units are `active`,
the `docker-kata0` MASQUERADE rule survived (`/etc/ufw/before.rules`), and a Kata
container can reach the internet (the npm registry) — a sandbox that merely
creates and runs `uname -r` doesn't prove outbound traffic works.

**SGLang** is server-only; `docs/sglang-deployment.md` covers how to edit
`compose.yaml`, restart, and validate. On top of that: `docker pull` the new tag
first (the old one keeps serving), copy `compose.yaml` to a `.bak` before editing,
and restart when no run is active — the first start takes minutes and kills
in-flight reviews. Check `/health` and the startup `server_args` dump against our
flags, then run `test_tool_calling.sh` and the benchmark at the concurrency the
deployment normally serves. Run the benchmark **twice** — the first run after a
cold start is warm-up — and compare steady-state throughput to what
`docs/sglang-deployment.md` records. Then one real MR review. Rollback: restore
the `.bak` and `docker compose up -d`. Afterwards refresh the pinned tag and
throughput figures in `docs/sglang-deployment.md`.

**Repo pins:** branch off `main` (`chore/bump-server-pins`), follow the commit and
branch rules in `.claude/CLAUDE.md`, and put the deploy prerequisites in the PR
description.

**Deploy:** `deployment/update.sh` ships whatever is on the checked-out branch.
Before it:

- supermemory changing → back up `${DATA_PATH}/supermemory` and check
  `services/supermemory/.env` for settings the new version removed.
- postgres tag changing → `pg_dump` first; `update.sh` recreates it through the
  `db-migrate` dependency.
- Redis is **not** touched by `update.sh`. After the deploy, with no run active:
  `cd <install-dir> && set -a && source backend/.env && set +a && docker compose up -d redis`.
- Fresh base images need one manual `docker compose build --pull` (tags float on
  purpose and `update.sh` has no `--pull`).

## 5. Verify

Re-run the audit's version lines, `curl -sf localhost:3698/health`, then one real
run (scheduled task or MR review) and a chat that uses project-memory search.
Check the supermemory startup log finished without errors — but it prints its API
key, so filter it: `docker logs harness_supermemory --tail 50 | grep -vi 'api key'`,
and never paste it unredacted.

Don't count on supermemory's own `/data.upgrade-backups/...` as a backup; it
appears to live in the container filesystem and goes when the container is recreated.

`unattended-upgrades` can move the kernel or NVIDIA packages on its own, so after
any such update check `nvidia-smi` works and the driver matches the loaded modules.

## 6. Clean up

Only after a real run has passed — until then the old versions are the rollback.
Remove the SGLang `compose.yaml.<old>.bak` and the old SGLang image, stale
`execd`/`egress` images on the Kata daemon (`docker -H unix:///run/docker-kata/docker.sock image ls`),
and any audit files you wrote. Refresh the pins in `docs/deployment.md` and
`docs/sglang-deployment.md`.
