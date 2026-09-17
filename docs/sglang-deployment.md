# Deployment

SGLang runs as a Docker Compose stack on a single production server, serving Qwen3.6 models for MR review workflows. Unlike langgraph-harness, there is no CI-triggered deploy — model/config changes are applied manually by whoever's in the `harness`-equivalent access path for this service (see [Accounts and access](#accounts-and-access)). This doc covers the server-side setup: accounts, directory layout, launch configuration, and the known quantization gotchas specific to this model family.

## Server layout

Everything lives under the `sglang` service account's home directory:

```
/opt/sglang/                    # sglang's home
├── docker/
│   ├── compose.yaml
│   └── .env                    # SGLANG_UID / SGLANG_GID
├── hf-cache/
│   └── hub/                    # Hugging Face model cache (HF_HOME target)
│       ├── models--QuantTrio--Qwen3.6-35B-A3B-AWQ/     # production
│       └── models--cyankiwi--Qwen3.6-27B-AWQ-INT4/     # quality-comparison
├── test_tool_calling.sh
└── benchmark.sh
```

There is deliberately **no bare-metal Python venv** under `/opt/sglang` — an earlier bare-metal setup (`sglang-env/`) was used during initial evaluation and to debug several kernel/CUDA-toolkit issues (see [Known issues](#known-issues-and-history)), then removed once the Docker stack was confirmed working end-to-end. Confirmed absent as of the last server audit — if one reappears, treat it as a fresh evaluation artifact, not something to merge back into the production path.

`hf-cache/hub` is the **only** place model weights live. Every model download lands here via `HF_HOME`/`--local-dir`; never `rm -rf` a model directory without confirming nothing currently references it (check `docker compose ps` and the `--model-path` in `compose.yaml` first).

## Accounts and access

**`sglang`** — the account that owns everything under `/opt/sglang` and runs the Docker Compose stack.

- Created as a system account: `useradd -r -s /usr/sbin/nologin -d /opt/sglang -M sglang`.
- `nologin` shell is fine here, **unlike langgraph-harness's `harness-deploy`** — there is no forced-command SSH mechanism triggering deploys on this account, so there's no risk of `nologin` swallowing a forced command the way it would break langgraph-harness's CI path. If an automated deploy/update mechanism is ever added for SGLang (e.g. a CI job that pulls new model configs), revisit this the same way langgraph-harness's doc flags — a real shell would become necessary at that point.
- Password locked, no interactive login.
- Member of the `docker` group (`usermod -aG docker sglang`) — required to run `docker compose`. Group membership changes require a fresh login/session to take effect; mid-session, use `sg docker -c "..."` as a workaround.
- Owns `/opt/sglang` recursively (`chown -R sglang:sglang /opt/sglang`) — unlike langgraph-harness's `.harness/app`, there's no root-owned data directory carve-out here; everything under `/opt/sglang` is safe to `chown` to `sglang` freely, since Docker doesn't auto-create any of these mount targets as root the way it does for bind-mounted database directories elsewhere.

**No separate admin group exists yet**, unlike langgraph-harness's `harness` group — though the setup is simpler here to begin with, since there's no root-owned data directory forcing a distinction between the service account's own primary group and a separate shared-access group the way langgraph-harness's `.harness/app` does. Admins needing routine access are added directly to the `sglang` account's own primary group (`usermod -aG sglang <user>`), then run commands as `sudo -u sglang <command>` for anything needing the service account's identity specifically (starting/stopping the stack, editing `compose.yaml`).

Group write access is deliberately split by risk, mirroring how langgraph-harness routes `.harness/postgres`/`.harness/redis` through `docker exec` rather than direct group access:

- **`hf-cache/`** — `g+rwX` and setgid granted to the `sglang` group (`chmod -R g+rwX hf-cache && chmod g+s hf-cache hf-cache/hub`). Low-stakes: worst case is a wasted download or a model needing a re-pull. Admins in the group can `hf download` directly, no `sudo -u sglang` needed. The setgid bit matters going forward, not just now — without it, files admins create default to their own primary group, silently reintroducing the ownership drift this setup was built to avoid.
- **`docker/`** — **not** group-writable. `compose.yaml` and `.env` control what's actually running in production; editing them always goes through `sudo -u sglang`, deliberately keeping a small step of friction in front of the one thing where a casual mistake has real consequences.

## Docker Compose stack

| Service  | Image                     | Purpose                                           |
| -------- | ------------------------- | ------------------------------------------------- |
| `sglang` | `lmsysorg/sglang:v0.5.16` | Model server, OpenAI-compatible API, port `30000` |

Single-service stack — no database, no queue, no frontend. Pinned to `v0.5.16` explicitly, not `:latest` — an upgrade should be a deliberate, tested change (new FlashInfer/CUDA-toolkit combinations have been the source of most issues here; see below), not something that silently drifts on a routine restart.

### Required launch flags, and why each exists

Every one of these was arrived at through direct debugging, not copied from a generic example — removing any of them will very likely reintroduce a specific, already-diagnosed failure:

| Flag                                                          | Why it's required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dtype float16`                                             | Qwen3.6-35B-A3B-AWQ's Marlin kernel needs FP16, not the model's native BF16, on Ada Lovelace (SM89) hardware — confirmed directly from SGLang's own runtime warning ("Marlin kernel with bf16 on GPUs before SM90").                                                                                                                                                                                                                                                                                                                                                             |
| `SGLANG_MAMBA_CONV_DTYPE=float16`                             | Without this, the Mamba/GDN convolution state cache defaults to BF16 regardless of the flag above, colliding with the FP16 compute path and crashing with `Index put requires the source and destination dtypes match`. Both this **and** `--dtype float16` are required together — one alone is not a complete fix.                                                                                                                                                                                                                                                             |
| `--mamba-full-memory-ratio 0.9`                               | Without an explicit value, the Mamba/KV cache memory split can size the Mamba pool down to zero usable request slots (`max_num_reqs=0`) — this happened with the official FP8 release specifically, where the larger weight footprint left too little total budget.                                                                                                                                                                                                                                                                                                              |
| `--mem-fraction-static 0.85`                                  | Caps the total fraction of GPU memory SGLang claims upfront for its static pools (weights + Mamba/KV cache), leaving explicit headroom rather than relying on auto-sizing — added alongside the ratio flag above as a second lever on the same memory-budget problem.                                                                                                                                                                                                                                                                                                            |
| `--allow-auto-truncate`                                       | Added after a large summarization request exceeded the input length limit and errored outright. This flag truncates oversized input silently instead of rejecting the request — no signal is returned indicating truncation occurred. Worth a deliberate decision rather than a default: silent truncation trades a clear error for possibly-incomplete input reaching the model.                                                                                                                                                                                                |
| `--disable-custom-all-reduce`                                 | This server's two RTX 4090s have no NVLink and are on separate PCIe host bridges (`NODE` in `nvidia-smi topo`). Custom all-reduce fails against this topology; this flag accepts the slower fallback path rather than erroring. **Real root cause**: NVIDIA disables true peer-to-peer on GeForce cards at the driver level, confirmed by NVIDIA's own engineering team — this is not fixable via BIOS/motherboard settings, only by patching the driver itself (a real, demonstrated-elsewhere option, but not attempted here — see [Known issues](#known-issues-and-history)). |
| `--cuda-graph-backend-prefill=disabled`                       | Sidesteps a CUB library version-mismatch bug (`BlockAdjacentDifference` API changed between CUB releases) that otherwise fails prefill CUDA graph compilation. Costs some prefill throughput; decode graphs remain enabled.                                                                                                                                                                                                                                                                                                                                                      |
| `--reasoning-parser qwen3` / `--tool-call-parser qwen3_coder` | Required for correct tool-calling — without an explicit parser, tool calls silently fall through as plain text rather than a structured response.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--context-length 262144`                                     | Matches the model's native context; cheap to run at full size for this architecture specifically, since only 10 of 40 layers use traditional context-scaling KV cache (the rest are linear-attention/GDN layers with ~fixed memory cost regardless of context length).                                                                                                                                                                                                                                                                                                           |
| `--tp-size 2`                                                 | Splits the model across both GPUs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Three commented-out flags (`--log-level debug`, `--log-requests`, `--log-requests-level 3`) sit inactive in the live config — kept in place as a ready-to-enable debugging toggle rather than removed, useful if a future incident needs verbose per-request logging without re-deriving the flag names from scratch.

`.env` in `docker/` holds `SGLANG_UID`/`SGLANG_GID` — **currently unused** in the live `compose.yaml`. An earlier attempt to run the container as the `sglang` account's non-root UID failed (`lmsysorg/sglang` expects to run as root internally — confirmed via `docker compose run --user root ... id`, which returned `uid=0`), so the container currently runs as its image default (root inside the container). The isolation boundary is enforced at the container level instead, not via UID matching on the host mount.

## Model storage and status

Two models are kept in `hf-cache/hub`, both validated end-to-end (tool-calling correctness + throughput):

| Model                           | Quantizer | Role                               | Status                                                            |
| ------------------------------- | --------- | ---------------------------------- | ----------------------------------------------------------------- |
| `QuantTrio/Qwen3.6-35B-A3B-AWQ` | QuantTrio | **Production**                     | ✅ Passes tool-calling test; ~985 tok/s aggregate at 8 concurrent |
| `cyankiwi/Qwen3.6-27B-AWQ-INT4` | cyankiwi  | Quality-comparison (dense vs. MoE) | ✅ Passes tool-calling test; ~452 tok/s aggregate at 8 concurrent |

Known-broken quants for this model family — **kept out of the cache deliberately, do not re-download without re-validating**:

| Model                               | Quantizer | Failure mode                                                                                                                         |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `QuantTrio/Qwen3.6-27B-AWQ`         | QuantTrio | Repetition-loop garbage (`reasoning_content` full of a single repeated character) despite a structurally clean `tool_calls` response |
| `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` | cyankiwi  | Same repetition-loop failure, at the other model size                                                                                |

### Known issue: quantization-induced repetition loops

This is a **pattern across independent quantizers**, not isolated bad luck with any one provider — worth treating as a real risk class for this specific model family, not a reason to distrust any single source:

- QuantTrio's quant is fine at 35B-A3B, broken at 27B.
- cyankiwi's quant is fine at 27B, broken at 35B-A3B — the exact opposite pairing.
- Qwen's own official FP8 release has separately been reported (internally, this deployment) to show the same message-loop symptom.
- Intel's own model card for `Qwen3.6-35B-A3B-int4-mixed-AutoRound` states directly: _"Some users have reported an infinite loop issue in our INT4 version. We have added fallbacks for certain layers in this release, but it is still unclear whether the issue has been fully resolved."_

**Never trust a clean benchmark run alone.** A model can produce a structurally valid `tool_calls` response while its `reasoning_content` is pure repetition garbage — `test_tool_calling.sh` checks for this specifically, but any manual testing of a new quant must inspect the raw `reasoning_content` field directly, not just check for a non-null `tool_calls`.

Untested candidates, if further comparison is needed: `RedHatAI/Qwen3.6-35B-A3B-FP8-dynamic` (more conservative calibration than the official release — keeps vision encoder, linear-attention layers, MoE router, and embeddings at original precision), `palmfuture/Qwen3.6-35B-A3B-GPTQ-Int4` (different quantization algorithm entirely, smaller/less-established source).

## Manual operations

```bash
cd /opt/sglang/docker
docker compose ps                    # status
docker compose logs -f               # tail logs
docker compose stop                  # stop without removing
docker compose up -d                 # start, detached
docker compose restart                # restart in place
```

To switch models, edit `--model-path` in `compose.yaml`, then:

```bash
docker compose up -d --force-recreate
```

Validate any change before trusting it:

```bash
bash /opt/sglang/test_tool_calling.sh    # correctness — check reasoning_content manually too
bash /opt/sglang/benchmark.sh            # throughput
```

## Known issues and history

- **CUDA toolkit/driver mismatch**: the system-wide `/usr/bin/nvcc` is CUDA 12.0 (old Ubuntu package); SGLang's dependencies expect CUDA 13.x. Resolved by installing a pip-packaged CUDA 13.3 compiler (`nvidia-cuda-nvcc`) self-contained inside the venv/container, rather than touching the system-wide toolkit (a shared-box risk, avoided deliberately).
- **`flashinfer` / `flashinfer-jit-cache` version drift**: both packages must be pinned to matching versions (`0.6.14` at time of writing) or SGLang refuses to start with a version-mismatch error.
- **MoE tuning script bugs**: `benchmark/kernels/fused_moe_triton/tuning_fused_moe_triton.py` has real, unfixed bugs for `--dtype int4_w4a16` (wrong `block_shape` assumption; a follow-on dtype mismatch requiring dequantization logic the script doesn't implement). **Moot for this deployment anyway** — confirmed via source trace that AWQ MoE layers route through a separate Marlin-based kernel path that never touches the code this tuning script targets. The "Using default MoE kernel config" warning in server logs is expected and does not reflect real performance for this model+quant combination.
- **P2P/NVLink**: not present on RTX 4090 by design (NVIDIA driver restriction, confirmed by NVIDIA engineering, not a hardware limitation) — see the `--disable-custom-all-reduce` row above. A driver patch to unlock this has been demonstrated elsewhere (~10-30% throughput gain on similar hardware) but has not been attempted on this box, given the risk of modifying a production driver.

## First-time setup (new server)

1. Create the service account: `useradd -r -s /usr/sbin/nologin -d /opt/sglang -M sglang`. Add to `docker`: `usermod -aG docker sglang`.
2. `mkdir -p /opt/sglang/docker /opt/sglang/hf-cache/hub`, then `chown -R sglang:sglang /opt/sglang`.
3. Confirm the CUDA toolkit story before assuming anything: check `nvcc --version` — if it reports an older CUDA than the SGLang image expects, do not touch the system-wide toolkit; resolve it per-environment instead.
4. Write `docker/compose.yaml` with the flags table above, and `docker/.env` with `SGLANG_UID`/`SGLANG_GID` (currently unused by the live config, kept for a future attempt at non-root container execution).
5. Add any admins needing routine access to the `sglang` group (`usermod -aG sglang <user>`, fresh login required to take effect), then grant `hf-cache/` group-write per the [Accounts and access](#accounts-and-access) section above — deliberately not extended to `docker/`.
6. Pull models into `hf-cache/hub` via `hf download <repo> --local-dir /opt/sglang/hf-cache/hub`.
7. `docker compose up` (foreground, first time) to watch for errors live before detaching.
8. Run `test_tool_calling.sh` and `benchmark.sh` before considering any model change or fresh setup "done" — a server that starts cleanly is not the same claim as a server that answers correctly.
