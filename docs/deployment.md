# Deployment

This is how we run langgraph-harness in production: a single Docker Compose stack on one server, deployed by GitLab CI on every push to `master`. Use this as a reference for standing up your own — it covers the server-side setup: accounts, SSH, directory layout, and what `deployment/update.sh` actually does, plus the gotchas we hit getting sandboxed execution working reliably. Application env vars are documented in [`backend/README.md`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/backend/README.md); this doc is about the box, not the app config.

## Server layout

Everything lives under the `harness-deploy` service account's home directory:

```
/opt/harness/                   # harness-deploy's home
├── .ssh/
│   ├── authorized_keys         # single forced-command key (CI deploy access)
│   ├── config                  # Host gitlab.com -> IdentityFile harness_deploy
│   └── harness_deploy          # outbound deploy key, read access to the GitLab repo
├── harness/                    # git checkout — the actual repo
│   ├── docker-compose.yml
│   ├── deployment/update.sh
│   ├── backend/.env            # secrets, never committed
│   ├── backend/
│   ├── frontend/
│   └── services/
│       ├── monitoring/
│       ├── opensandbox/
│       └── supermemory/.env    # secrets, never committed
└── .harness/                   # DATA_PATH target (absolute path, set in backend/.env)
    ├── postgres/               # bind-mounted into the postgres container
    ├── redis/                  # bind-mounted into the redis container
    ├── app/                    # bind-mounted into the backend container at /data/app
    ├── supermemory/            # bind-mounted into the supermemory container at /data
    └── opensandbox/            # bind-mounted into the opensandbox container at /root/.opensandbox
```

`.harness/postgres` and `.harness/redis` are a database engine's own on-disk format — don't read or edit them directly, use `docker exec` (see [Manual operations](#manual-operations)). `.harness/app` (including the `app` directory itself, not just what's inside it) is owned by **`root`**, all the way down — Docker auto-creates a bind-mount source directory as root the first time a container mounts it, and the backend's `Dockerfile` has no `USER` directive, so it runs as root too and clones/checks out git repos there (for MR review) as root. Git refuses to operate on a repository whose directory owner doesn't match the running process's UID ("detected dubious ownership") — so **never recursively `chown` (owner, not group) the whole `/opt/harness` tree**, and don't assume anything under `.harness/app` is safe to re-own just because it looks like plain data. `chgrp` for shared group access is fine (that's how admins get read/write into `.harness/app` without disturbing root ownership); changing the _owner_ is what breaks the backend on its next restart.

`.harness/supermemory` and `.harness/opensandbox` are also root-owned (same auto-create-as-root mechanism) but, unlike `.harness/app`, deliberately **not** opened up to the `harness` group — both hold a service's own internal state (supermemory's data, OpenSandbox's sandbox-lifecycle sqlite db) that admins have no established reason to read or edit directly, so there's no `chgrp`/`chmod` step for either.

## Accounts and access

**`harness-deploy`** — the account CI deploys as.

- Shell is `/bin/bash`, **not** `/usr/sbin/nologin` — SSH's `command=` forced-command restriction (below) executes the command _through the account's shell_, and `nologin` swallows the argument, refusing to run anything and breaking CI entirely. The account stays fully locked down via the other two points below regardless of shell.
- Password is locked (`*` in `/etc/shadow`) — no password login, ever.
- Hidden from the GDM login screen via an explicit AccountsService override (`/var/lib/AccountsService/users/harness-deploy` → `SystemAccount=true`), not via the shell — `accounts-daemon` (what GDM actually queries) also hides accounts whose shell is in a denylist, but relying on that instead would break CI per the point above.
- Member of the `docker` group (needed to run `docker compose`).

**`harness`** — a _group_, not a login account. Admins who need to poke around (read logs, edit `backend/.env`, restart services) get added to this group with their own personal accounts — no shared login, so `sshd`/`sudo` logs still show who did what. Members: `harness-deploy`, plus individual admins as needed (`sudo usermod -aG harness <user>`).

- `harness/` (the repo) and `.harness/app` (app data) are group-owned, `g+rwX`, with the setgid bit on directories so new files inherit the group. Owner stays `harness-deploy` for `harness/`, but stays **`root`** for `.harness/app` and everything under it — see the callout above.
- `.harness/postgres` and `.harness/redis` are **not** group-shared — go through `docker exec` for those.
- Admins also need the `docker` group to run compose commands directly.

**`.harness/app/worktrees` and `.harness/app/repositories` need a default ACL, not just the setgid `chmod` above.** Setgid on a directory only propagates _group ownership_ to new files/directories created inside it — it does **not** propagate the group-_write_ bit. `git worktree add`/`git clone` (run by the backend, as root) create their files with the process's own umask (`022`), so every fresh worktree comes out `644`/`755` — group gets read, never write — no matter how permissive the parent directory is. mr-review's sandboxes only ever read from a worktree; work-item-resolve's sandboxes write back into one. Under Kata, these writes land as root (owner UID `0`, group inherited via setgid as `harness`'s GID) — root bypasses permission-bit checks entirely, so this fix isn't what makes work-item-resolve's own sandbox writes succeed. It's kept for a different, still-real reason: human/admin access into the same tree via the `harness` group (an admin's own account, not root) does need the group-write bit, and setgid alone doesn't provide it. A one-time `chmod -R g+rwX` fixes existing content but doesn't survive the next `git worktree add`, so this needs a **default ACL** (POSIX ACLs, self-healing regardless of the creating process's umask):

```bash
sudo chmod -R g+rwX /opt/harness/.harness/app/worktrees /opt/harness/.harness/app/repositories
sudo setfacl -R -d -m g:harness:rwX /opt/harness/.harness/app/worktrees /opt/harness/.harness/app/repositories
sudo setfacl -R -m g:harness:rwX /opt/harness/.harness/app/worktrees /opt/harness/.harness/app/repositories
```

Requires the `acl` package (`setfacl`/`getfacl`) and a filesystem that supports POSIX ACLs (default on `ext4`/`xfs`, no special mount option needed on a modern kernel). Verify with `getfacl <path>` — a healthy directory shows both a `group:harness:rwx` entry and a `default:group:harness:rwx` entry; the `default:` one is what makes it self-healing.

## SSH deploy mechanism

`harness-deploy`'s `authorized_keys` has exactly one entry, restricted with a forced command:

```
command="cd /opt/harness/harness && bash deployment/update.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... harness-deploy
```

Whoever holds the matching private key (GitLab CI, via the `SSH_PRIVATE_KEY` variable) can only ever trigger `deployment/update.sh` — no interactive shell (`no-pty`), no forwarding. There is no second, unrestricted key on this account; if you ever see one, it defeats the whole point of the restriction above and should be removed.

> **Upgrading an existing server:** `update.sh` moved to `deployment/update.sh`. This path is baked into `authorized_keys`, not tracked by git, so pulling the new layout alone does **not** update it — edit the `command=` restriction on the server (as shown above) _before or at the same time as_ deploying past this change, or the next CI-triggered deploy will fail with a "no such file" error.

Outbound access (this account pulling from GitLab) uses a **separate** key pair, configured in `~/.ssh/config`:

```
Host gitlab.com
  IdentityFile ~/.ssh/harness_deploy
```

That key is registered as a deploy key on the GitLab repo (read access), unrelated to the CI-facing key above — don't confuse the two.

**Required GitLab CI/CD variables** (see [`.gitlab-ci.yml`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/.gitlab-ci.yml) and the root [`README.md`](https://github.com/vrajpal-jhala/langgraph-harness#cicd) for the full table): `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_KNOWN_HOSTS`. The deploy path itself is **not** a CI variable — it's baked into the `command=` restriction above, so changing it means editing `authorized_keys` on the server, not GitLab's CI/CD settings.

## Docker Compose stack

| Service       | Image / build                          | Purpose                                                                               |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `postgres`    | `postgres:18-alpine`                   | Checkpoint + memory storage                                                           |
| `redis`       | `redis:8-alpine`                       | BullMQ queue backing store                                                            |
| `backend`     | build: `./backend`                     | Elysia API + LangGraph agent, port `3698`                                             |
| `frontend`    | build: `./frontend`                    | Static React UI, port `5173`                                                          |
| `db-migrate`  | build: `./backend` (profile `migrate`) | Runs pending migrations, one-shot                                                     |
| `opensandbox` | build: `./services/opensandbox`        | Sandboxed command/file execution for the dev-agent workflow, driven via `docker.sock` |

Volumes are keyed off a single `${DATA_PATH}` variable (set in `backend/.env`, **must be an absolute path** — `backend/src/utils/config.ts` throws on startup if it isn't) — resist the urge to hardcode absolute paths per-service; this is what let the whole `.harness` data directory move house without touching `docker-compose.yml`. The `backend` service's own `environment:` block also gets this same host-rooted value under the key `DATA_PATH`, plus a second key, `APP_DATA_PATH: /data` — the _container-internal_ mount point the app code actually reads/writes through. Backend code needs both: `APP_DATA_PATH` for its own file I/O (`config.dataPath`), and `DATA_PATH` (`config.hostDataPath`) to translate a path into one OpenSandbox can use, since OpenSandbox's Docker daemon resolves mount sources against the host, not against the backend's own container (`toHostDataPath()` in `backend/src/utils/config.ts` does that translation). `opensandbox` itself also reads `${DATA_PATH}` directly (not just as a volume source) for the same host-path reason — its `entrypoint.sh` needs the real host path to tell the Docker daemon what a sandbox is allowed to bind-mount. A relative value would silently resolve against whatever directory the process happens to run from — fine in dev (a real repo checkout), meaningless in the built container (resolves to `/`) — so this is enforced at startup rather than left as a convention.

Because volume paths are resolved (and baked into each container's mount config) at `docker compose up` time, moving `.harness` on the host doesn't retarget an already-running container — it has to be recreated (`docker compose down` + `up`, or `deployment/update.sh`'s `--force-recreate`) to pick up a new location.

`docker-compose.yml` pins the default network's subnet to `172.18.0.0/16` (`networks.default.ipam`) rather than leaving it Docker-assigned — the [UFW rule](#opensandbox) that lets `backend` reach a sandbox's published port on the host is scoped to this subnet as its source IP range, so an unpinned network reassigning itself on a stack rebuild would silently break it.

**Multiple Docker daemons, one shared iptables table.** Once you add OpenSandbox's Kata sandboxes (see [OpenSandbox](#opensandbox)), your host ends up running two independent `dockerd` instances: the main one (this Compose stack) and a rootful daemon at `/opt/kata-docker`. Docker's `DOCKER-FORWARD`/`DOCKER-BRIDGE`/`DOCKER-CT`/`DOCKER-USER` iptables chains are global to the host kernel, not namespaced per daemon.

Only the main daemon manages these chains. `docker-kata`'s `/opt/kata-docker/docker/daemon.json` sets `"iptables": false`, so it never writes to them — required, not optional: a daemon that does manage iptables rewrites the shared chains with only its own bridge's rules on every restart, silently dropping every other daemon's already-installed per-bridge rules for networks it doesn't know about. Any additional Docker daemon added to this host must set `"iptables": false` too (or use explicit systemd ordering plus a post-boot resync check) — this doesn't happen automatically.

Symptom of a daemon misconfigured this way: DNS resolution keeps working (hairpinned to the host's local resolver, no kernel forwarding needed), but every real outbound connection from an affected container hangs indefinitely — no error in `docker logs`, nothing in the kernel log. Diagnose with:

```bash
sudo iptables -L FORWARD -n -v --line-numbers       # policy DROP, and packets falling through to it?
sudo iptables -L DOCKER-BRIDGE -n -v --line-numbers # does the affected bridge (e.g. br-cec97df3ef26) have its own rule, alongside any others?
```

If the affected bridge's rule is missing, restart the daemon that owns the shared chains to force a resync:

```bash
sudo systemctl restart docker
```

`"live-restore": true` is set in the main daemon's `/etc/docker/daemon.json` so a restart like this (or a future upgrade) doesn't stop every running container while it happens.

**`br_netfilter` must be loaded** for any of the above to work at all — without it, bridged traffic between containers on different networks (or between a container and the host's own bridge-gateway address) never reaches iptables/nftables in the first place, regardless of what rules exist. Loaded via `modprobe br_netfilter`, persisted in `/etc/modules-load.d/br_netfilter.conf`, with `net.bridge.bridge-nf-call-iptables`/`-ip6tables` set to `1` in `/etc/sysctl.d/99-docker-bridge-nf.conf`. Verify with `sysctl net.bridge.bridge-nf-call-iptables` — if that path doesn't exist at all (`No such file or directory`, not just reading `0`), the module isn't loaded.

**`host.docker.internal` resolves to the wrong bridge.** Docker's `host-gateway` special value (used in `extra_hosts`) always resolves to the _default_ bridge's gateway (`docker0`, `172.17.0.0/16`) — never to the gateway of whatever custom network a container is actually attached to. `backend`/`opensandbox`/`supermemory` are on `harness_default` (`172.18.0.0/16`), not `docker0`, so relying on `host-gateway` silently points them at an unreachable address. There's no per-network variant of this keyword; the alternative, a daemon-wide `--host-gateway-ip` flag, is still one fixed value for the whole host, not computed per-network. `docker-compose.yml` hardcodes the real gateway instead, via an anchor (`x-host-gateway: &hostGateway '172.18.0.1'`, referenced by each service's `extra_hosts`) — update this anchor if `networks.default.ipam`'s subnet ever changes, the same way the UFW rule above needs to.

**`docker compose build` can fail DNS lookups that `docker compose up` never would.** BuildKit's build-step containers don't get the same automatic "loopback nameserver detected, substitute a public default" handling that regular container creation applies — so on a host using `systemd-resolved`'s stub (`nameserver 127.0.0.53` in `/etc/resolv.conf`), a `RUN npm ci`-style step can fail with `EAI_AGAIN` on every real registry fetch while `docker compose up`'s containers resolve DNS fine. Confirm the host's own resolution is healthy first (`resolvectl status`, `getent hosts <registry>`) before assuming this is the cause — if the host itself can't resolve, that's a different, bigger problem. Fixed by setting explicit resolvers in the main daemon's `/etc/docker/daemon.json`: `"dns": ["8.8.8.8", "1.1.1.1"]`.

## OpenSandbox

`opensandbox` creates sibling containers (sandboxes) via the Docker API for the dev-agent workflow's sandboxed command/file execution — access to that API is otherwise equivalent to root on the host, so several mitigations are in place.

**Secure runtime (Kata Containers).** Sandboxes run as Kata Containers VMs (QEMU) — each sandbox gets its own guest kernel, not just syscall interception on top of the host's, the way the previous gVisor runtime worked. Kata runs on its own dedicated **rootful** Docker daemon, `docker-kata` (`/opt/kata-docker/`), with its own `containerd` instance too (`containerd-kata.service`, own config/socket/data root under `/opt/kata-docker/containerd`) — the main daemon's `docker.service` explicitly points at the system `containerd` (`--containerd=/run/containerd/containerd.sock`), so sharing it would put both daemons' containers in the same namespace, defeating the isolation this design relies on. A modern `containerd` (we're on v2.2.6) uses config schema `version = 3` — generate the real default (`containerd config default`) rather than hand-writing one from an older schema; plugins are disabled via a top-level `disabled_plugins` list, and CRI's plugin ID is split into `io.containerd.cri.v1.images`/`io.containerd.cri.v1.runtime`.

```json
// /opt/kata-docker/docker/daemon.json
{
  "data-root": "/opt/kata-docker/docker",
  "exec-root": "/run/docker-kata/execroot",
  "pidfile": "/run/docker-kata/docker.pid",
  "hosts": ["unix:///run/docker-kata/docker.sock"],
  "containerd": "/run/containerd-kata/containerd.sock",
  "bridge": "docker-kata0",
  "runtimes": { "kata": { "runtimeType": "io.containerd.kata.v2" } },
  "iptables": false
}
```

`"iptables": false` is required, not optional — see [Multiple Docker daemons, one shared iptables table](#docker-compose-stack) above; without it, every restart of this daemon overwrites the main daemon's per-bridge rules for `harness_default`/sglang, silently breaking outbound traffic for the whole stack, not just sandboxes. Registration is `runtimeType: "io.containerd.kata.v2"` under a runtime named `"kata"` — not the legacy `--add-runtime kata=<path>` form, which registers the binary the `runc`-CLI way and fails against Kata's Rust shim (`flag provided but not defined: -root`; shim-v2 binaries don't speak that CLI). `opensandbox/sandbox.toml` has `[secure_runtime] type = "kata"`, `docker_runtime = "kata"` — the server validates this at startup and refuses to boot if it's misconfigured.

**Bridge interface name collision.** `bip` and `bridge` are mutually exclusive dockerd options — `bip` auto-creates and configures a bridge itself, always named `docker0`; `bridge` attaches to an already-existing bridge that must be created separately. `bip` must not be used here: the main daemon already owns a bridge named `docker0` (`172.17.0.0/16`), and two independent dockerd instances with no shared coordination end up fighting over the same interface name — whichever one (re)starts last silently overwrites `docker0`'s IP, leaving every container's gateway pointing at an address no longer present on the interface. Outbound traffic from either daemon's containers — including DNS — then black-holes with no error. Already-running containers keep working (their routes were established before the collision); only new connections through the broken gateway fail, which is why this surfaces as npm's generic `Exit handler never called!` during a `docker compose build` rather than as a stack-wide outage. Diagnose by comparing <code v-pre>docker network inspect bridge --format '{{json .IPAM.Config}}'</code> (what the main daemon believes) against `ip addr show docker0` (what the interface actually has) — a mismatch confirms it.

`bridge: "docker-kata0"` avoids the collision, but `-b`/`bridge` mode requires the bridge to already exist — dockerd won't create one itself the way `bip` does. A systemd drop-in pre-creates it before `dockerd` starts:

```bash
# /etc/systemd/system/docker-kata.service.d/pre-create-bridge.conf
[Service]
ExecStartPre=/bin/sh -c 'ip link show docker-kata0 >/dev/null 2>&1 || { ip link add name docker-kata0 type bridge && ip addr add 172.20.0.1/16 dev docker-kata0 && ip link set docker-kata0 up; }'
```

Docker persists a created network's bridge-name binding in its own local state (`<data-root>/network`) and reuses that binding on every subsequent start regardless of what `daemon.json` currently says — changing the `bridge` key doesn't retroactively rebind an already-created default network. If `docker-kata`'s default network was ever created while `bip` was set, the collision recurs identically after switching to `bridge`, now with the same IP duplicated across `docker0` and `docker-kata0` simultaneously. Fix: confirm no sandboxes are running (`docker -H unix:///run/docker-kata/docker.sock ps -a`), stop `docker-kata`, move `/opt/kata-docker/docker/network` aside, delete both the `docker0` and `docker-kata0` interfaces (`ip link delete`), restart the main daemon first so it recreates `docker0` cleanly, then start `docker-kata` — with no stale network record left, it creates its default network fresh against the current `bridge` config.

Unlike gVisor's rootless setup, `docker-kata` needs no dedicated unprivileged host account, no subuid/subgid range, no `rootlesskit`, and no AppArmor profile for unprivileged user namespaces — a rootful daemon gets normal cgroup v2 delegation and normal DNAT-based port-publishing, neither of which needed the workarounds the rootless daemon did.

**Host firewall (UFW).** UFW's default policy denies incoming traffic, which blocks every sandbox's health check (surfaces as `SandboxReadyTimeoutException` — the sandbox itself comes up fine, its published port just isn't reachable) unless this rule is present:

```bash
sudo ufw allow from 172.18.0.0/16 to any port 40000:60000 proto tcp
```

Scoped to `harness_default`'s pinned subnet (see [Docker Compose stack](#docker-compose-stack)) and OpenSandbox's own configured port range (`port_range_min`/`port_range_max` in `opensandbox/sandbox.toml`). This rule was originally written for the old rootless daemon, where RootlessKit's port-publishing does a real `bind()`/`listen()` in the host's root network namespace and is therefore subject to `INPUT` filtering — unlike normal Docker port-publishing, which is DNAT via `PREROUTING`/`FORWARD` and never touches `INPUT`. **Required under `docker-kata` too, though not for the reason "rootful vs. rootless" would suggest.** `docker-kata`'s `"iptables": false` (needed to stop it clobbering the main daemon's shared bridge rules, above) also disables Docker's own DNAT rule for its containers' published ports, which pushes port-publishing onto `docker-proxy` instead — a userspace relay that does the same real `bind()`/`listen()` on the host RootlessKit did. Any daemon with `iptables: false` ends up needing this rule regardless of rootful/rootless. `ufw allow` writes straight to `/etc/ufw/user.rules`, so this survives a reboot on its own; re-add it only if `ufw` itself is reinstalled or `ufw reset` is ever run, either of which wipes that file.

**Docker API socket proxy.** `docker-socket-proxy-kata` (`tecnativa/docker-socket-proxy`) sits between `docker-kata`'s socket and `opensandbox`, which reaches it over `DOCKER_HOST: tcp://docker-socket-proxy-kata:2375` — `opensandbox` never has the raw socket bind-mounted directly. `CONTAINERS`, `IMAGES`, `POST`, `SYSTEM`, and `INFO` are enabled; swarm/secrets/volumes/networks/nodes/plugins stay off. `SYSTEM` and `INFO` are both needed for `opensandbox`'s startup runtime check, which calls the Docker API's `/info` endpoint — this proxy image version gates `/info` behind `INFO` specifically, separate from the more commonly-documented `SYSTEM` category.

The proxy mounts the socket's **directory**, not the file (`/run/docker-kata:/run/docker-sock-dir:ro`, `SOCKET_PATH` pointed at the file inside it). `docker-kata.service` uses systemd's `RuntimeDirectory=`, which removes and recreates `/run/docker-kata` on **every** service restart — a crash, a manual restart, a host reboot, not just an internal `dockerd` restart inside an already-running service. A file-level mount would snapshot the old inode and go stale on every such restart; the directory mount keeps following the live file across those, but a proxy container recreate is still needed after any `docker-kata.service` restart specifically: `docker compose up -d --force-recreate docker-socket-proxy-kata`. This isn't a one-time setup step, it's a standing operational rule for this daemon. Symptom if missed: `opensandbox` logs `503 Service Unavailable` from `docker-socket-proxy-kata` on every sandbox operation; confirm with `docker exec harness_docker_socket_proxy_kata ls -la /run/docker-sock-dir/` — an empty listing means it's stale.

**A freshly-created sandbox can be unreachable with no config explanation.** Both the direct connection path and `useServerProxy: true`'s server-side proxy through `opensandbox` can time out against a brand-new sandbox even with `docker-kata`'s `iptables: false` intact and `docker-proxy` alive and correctly configured for the port. Suspected cause (not confirmed): corrupted/orphaned veth-peer state left behind by a high volume of sandbox create/destroy cycles in a short window — a manual-retesting pattern, not expected under normal production traffic, so it may not recur outside heavy testing. Fix: restart both `containerd-kata` and `docker-kata`, which clears it for subsequent sandboxes; this counts as a `docker-kata.service` restart, so `docker-socket-proxy-kata` needs recreating immediately after (above). If a sandbox creates successfully but hangs on its health check with no other explanation, try this restart before assuming a new networking regression.

**Egress enforcement doesn't work under this deployment's Docker backend.** `sandbox.toml`'s `[egress]` block is `mode = "dns+nft"`, and `opensandbox` attaches a per-sandbox egress sidecar (`opensandbox/egress`) whenever `networkPolicy` is set. The sidecar only intercepts a sandbox's traffic if both containers share one Kata guest VM's network namespace — a CRI-level pod-sandbox grouping driven by Kubernetes' `RuntimeClass`, with no Docker-backend equivalent. `opensandbox/sandbox.toml`'s `docker_runtime = "kata"` (what this deployment uses) has no way to express that grouping, so the sidecar and sandbox always end up as two independent Kata VMs — the sidecar's policy never sees the sandbox's real traffic, even with Docker's own `NetworkMode: container:<id>` set correctly. `backend/src/components/workflows/work-item-resolve/sandbox.ts` doesn't pass `networkPolicy` to `Sandbox.create()` because of this; the per-project-type domain allowlist (`allowedEgressDomains`/`commonEgressDomains`/`PROJECT_EGRESS_DOMAINS`) has been removed entirely rather than left as unenforced guidance. Lateral movement stays out of scope regardless: sandboxes run on Kata's own per-sandbox networking on `docker-kata`'s own bridge (`172.20.0.0/16`), a separate daemon and network entirely from `harness_default` (`172.18.0.0/16`) where `postgres`/`redis`/`backend`/`docker-socket-proxy-kata` live, with no route between them. `opensandbox` already supports a Kubernetes backend where this works natively (`RuntimeClass` grouping) — enforcing egress means migrating this deployment to it, not waiting on an upstream fix.

**`docker-kata0` has no outbound path unless explicitly opened.** The main daemon owns the shared iptables chains (see above) and only populates `DOCKER-BRIDGE` for bridges it created itself — `docker-kata0` isn't one of them, so traffic from a sandbox or its egress sidecar leaving the host falls through `FORWARD`'s default `DROP` with no error, no log, nothing in `docker logs`. Fixed with a standing UFW rule, not a raw `iptables` rule a main-daemon restart would wipe:

```bash
sudo ufw route allow in on docker-kata0 out on <your-uplink-interface>
```

Find your uplink interface with `ip route show default` (the `dev` field on the default route) — ours was `enp36s0f0`, yours will likely be named differently.

Symptom: sandboxes create successfully (creation only needs the Docker API via `docker-socket-proxy-kata`, on `harness_default`) but every outbound connection from inside one — including the egress sidecar's own upstream DNS — hangs until timeout. Diagnose with `sudo iptables -L DOCKER-BRIDGE -n -v` (no entry for `docker-kata0`) or a live capture on `docker-kata0` vs. the physical uplink to see where packets stop.

**Audit log.** Every sandbox lifecycle call the dev-agent workflow makes is captured as a `RunEvent`: `Sandbox.create`/teardown as explicit `run_step_start`/`run_step_end` pairs (`work-item-resolve/index.ts`), and `commands.run`/`files.writeFiles` automatically via LangGraph's tool-call instrumentation (`stream-translator.ts`), output capped at 40k chars per call.

**Capabilities, seccomp, PID limits.** Enforced globally, not per-sandbox: `sandbox.toml`'s `[docker]` block applies `drop_capabilities`/`no_new_privileges`/`pids_limit` to every sandbox regardless of task. `seccomp_profile`/`apparmor_profile` are left empty in that same block — per OpenSandbox's own docs, empty doesn't mean "no profile," it means Docker's own default seccomp profile and `docker-default` AppArmor profile apply, the same as any other container; this was already true under gVisor too, where syscall interception made a host-level profile largely redundant in practice even though it was never actually disabled. Under Kata it's more meaningful, since `containerd-shim-kata-v2` applies that same default via its own OCI runtime layer inside the guest, with no syscall-interception layer making it moot. Per-task tuning isn't possible either way: the installed OpenSandbox SDK's `CreateSandboxRequest` has no capability/seccomp/AppArmor/PID field, only CPU/memory (`resourceLimits`, currently `{ cpu: '2', memory: '4Gi' }`).

Its API key (`OPENSANDBOX_SERVER_API_KEY` on the container, checked against the `OPEN-SANDBOX-API-KEY` request header) is a plain generated secret, not something OpenSandbox issues — set it once as `OPENSANDBOX_API_KEY` in `backend/.env` (same file, one value, used by both sides: compose substitutes it into `opensandbox`'s environment, and the backend presents it as a client).

## nginx reverse proxy

`nginx` on the host (not part of the Compose stack) terminates TLS for your public hostname and proxies to `backend` (`127.0.0.1:3698`) and `frontend` (`127.0.0.1:5173`) by path. It lives at `/etc/nginx/sites-enabled/default` on the box, outside this repo.

## `deployment/update.sh`

What CI actually triggers via the forced SSH command:

```bash
if [ "${HARNESS_UPDATE_REEXECED:-}" != "1" ]; then
  git pull
  exec env HARNESS_UPDATE_REEXECED=1 bash "$0"
fi

set -a && source backend/.env && set +a   # loads DATA_PATH, GITLAB_API_URL, etc. into the shell
docker compose build backend frontend db-migrate supermemory opensandbox monitoring
docker compose --profile migrate run --rm db-migrate
docker compose up -d lightpanda supermemory docker-socket-proxy-kata opensandbox docker-socket-proxy-system monitoring
docker compose up -d --no-deps --force-recreate backend frontend
docker builder prune -af --filter "until=168h"
```

`postgres` and `redis` are left running (`restart: unless-stopped`) rather than recreated on every deploy — only `backend`/`frontend` get force-recreated, since those are what actually change on a code push. New services (like `lightpanda`, `supermemory`, `docker-socket-proxy-kata`, `opensandbox`, `docker-socket-proxy-system`, `monitoring`) need their own explicit line added here — this flow never creates one automatically; a plain `up -d` after `build` already recreates a container whose image changed, so no extra flag is needed for those. `docker-socket-proxy-kata` must stay in this list despite `opensandbox depends_on` it — a config change to it (see [OpenSandbox](#opensandbox)) would silently never take effect on deploy otherwise. `supermemory`, `opensandbox`, and `monitoring` need an explicit `build` too (unlike `lightpanda`'s pulled image) since they have their own `Dockerfile`s.

A change to `docker-compose.yml`'s network config (like the subnet pin above) needs a full stack cycle, not a normal deploy — this flow only stops/recreates specific services, so the other containers stay attached to the old network and Compose can't remove+recreate it. It fails partway through, leaving `postgres` stopped and every command after it in the script unrun. Recover with a manual cycle before the next deploy: `docker compose down && docker compose --profile migrate run --rm db-migrate && docker compose up -d`.

`git pull` replaces this file via an atomic rename, which doesn't affect the already-running process's open file descriptor — everything after the pull would otherwise keep executing the pre-pull version. The guard re-execs the script once, immediately after the pull, via `bash "$0"`, which opens the file fresh; `HARNESS_UPDATE_REEXECED=1` on that re-exec skips the pull-and-re-exec branch the second time so it runs the rest of the script instead.

## Manual operations

For anyone in the `harness` group:

```bash
cd /opt/harness/harness
docker compose ps                              # status
docker compose logs -f backend                 # tail logs
docker compose exec postgres psql -U postgres -d harness   # DB access, don't touch data files directly
docker compose exec redis redis-cli
```

To run `docker compose` commands that need `${DATA_PATH}` (recreating containers, not just `ps`/`logs`), source the env first: `set -a && source backend/.env && set +a`.

## First-time setup (new server)

1. Create the service account with `--system` (keeps it in the sub-1000 UID range, which `accounts-daemon` also uses to decide what to hide from the login screen) and a real shell: `useradd --system -m -s /bin/bash harness-deploy`. Lock its password (`passwd -l`), add it to `docker`.
2. Hide it from the display manager via AccountsService (`SystemAccount=true` override), **not** by changing the shell.
3. Generate a dedicated deploy key pair for CI; install the public half in `authorized_keys` with the `command=`/`no-pty` restriction above, base64-encode the private half into GitLab's `SSH_PRIVATE_KEY` variable.
4. Generate a separate key pair for outbound GitLab access, add it as a repo deploy key, and point `~/.ssh/config` at it for `Host gitlab.com`.
5. Clone the repo, copy `backend/.env.example` → `backend/.env` and fill in secrets (see `backend/README.md`'s env table) plus `DATA_PATH`.
6. `docker compose up -d` once manually to confirm the stack comes up healthy, then let CI take over from there.
7. Create the `harness` group, add admin accounts, `chgrp -R harness` + `chmod g+rwX` on `harness/` and `.harness/app`.
8. Install Kata Containers and stand up the `docker-kata`/`containerd-kata` daemon pair for `opensandbox` — see [OpenSandbox](#opensandbox) above for the daemon config and the `iptables: false` requirement. Two gotchas not covered there: the pre-built Kata release tarball can ship a dangling `configuration.toml` symlink that needs repointing at the Rust-runtime QEMU config, and a modern `containerd` (schema `version = 3`) needs its default regenerated (`containerd config default`) rather than hand-written from an older schema.
9. Set the default ACL on `.harness/app/worktrees` and `.harness/app/repositories` (see the default-ACL note under [Accounts and access](#accounts-and-access)) — skipping this leaves worktree writes silently failing for any sandbox that needs to write back into its checkout, since step 7's `chmod` alone doesn't survive a fresh `git worktree add`.
10. Confirm `br_netfilter` is loaded and persisted (see the callout under [Docker Compose stack](#docker-compose-stack)) — without it, cross-network container traffic silently fails regardless of any iptables/nftables rule being correct.
