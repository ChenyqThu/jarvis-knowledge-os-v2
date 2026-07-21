# launchd Services — Install Reference

Current production lineup (verified against `~/Library/LaunchAgents/`
on **2026-07-21**, §6.43):

| Service | Schedule | Role |
|---|---|---|
| **gbrain-serve-http** | KeepAlive daemon, :7225 | native `gbrain serve --http` — OAuth 2.1 + MCP JSON-RPC; the origin behind `kos.chenge.ink` |
| **gbrain-backup** | 03:33 daily | `pg_dump` the production Postgres |
| **dream-cycle** | 03:11 daily | nightly `gbrain dream` cycle via `dream-wrap` |
| **chunkless-backfill** | 07:00 daily | chunks cycle-born pages that `embed --stale` structurally cannot see (upstream #2163 — §6.41) |
| **kos-patrol** | 08:07 daily | fork lint/patrol; `SuccessfulExitCodes` includes 2 (warn) |
| **embedding-label-normalize** | 08:25 daily | fixes the cosmetic per-chunk `model` mislabel (§6.32) |
| **enrich-sweep** | 22:13 Sun weekly | entity enrichment, via `scripts/minions-wrap/enrich-sweep.sh` |

`image-ingest` has a tracked template but is **not currently loaded** on
this box.

The four query-path services (`gbrain-serve-http`, `dream-cycle`,
`kos-patrol`, `enrich-sweep`) carry the §6.32/§6.41 embedding env block
(`openai:text-embedding-3-large` @1536 on an **official** OpenAI key) plus
the §6.42 `GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000`. **Never add
`OPENAI_BASE_URL`** — there is no relay on the embedding path any more, and
reverting the model to gemini/zeroentropy re-splits the vector space. The
other three need only `HOME` + `PATH`.

Retired: **kos-compat-api** (§6.28, 2026-05-17 — the KOS-v1 Bearer wire that
used to own :7225), **notion-poller**, and **gemini-embed-shim** (port 7222
OpenAI→Gemini translator, retired at M3). Their templates live in
`_archived/` and describe a lineup that no longer exists — read them as
history, not as reference.

## Templates vs working copies

Only the `.plist.template` files are tracked. The `.plist` files are
gitignored because they embed real secrets.

> **The `.plist` working copies are deploy-time artifacts, not a
> reference.** You create one, substitute the secrets, `cp` it to
> `~/Library/LaunchAgents/`, and from that moment it is frozen while the
> template and the live service keep moving. Four of them sat here for
> months carrying an obsolete `GBRAIN_HOME` that was a known P0 (it pointed
> gbrain's config loader at a non-existent path and broke the dream-cycle
> cron) — long after the live plists had been fixed. During the §6.43 sync
> they were misread as evidence that production was misconfigured.
>
> They are now **deleted after install**. If you find a `.plist` sitting in
> this directory, it is stale by construction: trust the template, or read
> `~/Library/LaunchAgents/` for what is actually running.

## First-time install

```bash
# Seven services as of 2026-07-21
SVCS="gbrain-serve-http gbrain-backup dream-cycle chunkless-backfill kos-patrol embedding-label-normalize enrich-sweep"

for svc in $SVCS; do
  cp com.jarvis.$svc.plist.template com.jarvis.$svc.plist
done

# Edit each .plist and replace the placeholders:
#   <FILL:OPENAI_API_KEY>       → official OpenAI key (NOT a relay key — §6.41)
#   <FILL:ANTHROPIC_API_KEY>    → CRS key (gbrain-serve-http only)
#   <FILL:NANO_BANANA_API_KEY>  → Google GenAI key (vestigial for embedding; image work only)

for svc in $SVCS; do
  cp com.jarvis.$svc.plist ~/Library/LaunchAgents/
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.$svc.plist
done

# Delete the working copies — they carry secrets and go stale immediately.
rm -f com.jarvis.*.plist
```

## Cutover sequence (Stage 3.2 — historical, 2026-04-16)

> ⚠️ This section describes the original v1 → v2 cutover. The
> `gemini-embed-shim` step has been retired by M3 cutover (2026-05-10).
> For a fresh install today, skip steps 2 + 5 below — `kos-compat-api`
> talks directly to the native v0.27 Vercel AI SDK gateway, no shim
> needed. The four cron services (dream-cycle, kos-patrol, enrich-sweep,
> notion-poller) just need their plists copied + bootstrapped; they
> inherit the same Google embedding env block.

```bash
# 1. Stop v1 kos-api.py (keeps plist on disk for rollback)
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-api.plist
lsof -i :7225 -P  # expect: no listeners

# 2. [RETIRED M3] Embed shim used to run on 7222 — no longer needed.
#    Native gateway uses GOOGLE_GENERATIVE_AI_API_KEY directly from the
#    plist EnvironmentVariables block.

# 3. Start kos-compat-api (takes over 7225)
launchctl load ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
sleep 2
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7225/health | jq .
# expect: {"status":"ok","brain":"/Users/chenyuanquan/brain","engine":"gbrain"}

# 4. End-to-end check via kos.chenge.ink (same domain, new backend)
curl -s -H "Authorization: Bearer $TOKEN" https://kos.chenge.ink/status | jq .
# expect: total_pages=2718 (or current count)
```

## Rollback

If any cutover step fails:

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.kos-api.plist
# v1 back in control, 30 seconds max downtime
```

## Archive old service (after 7-day dual-read proven stable)

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-api.plist
mv ~/Library/LaunchAgents/com.jarvis.kos-api.plist ~/Library/LaunchAgents/_archive/
```

## Logs

- Compat:  `server/kos-compat-api.std{out,err}.log`
- Shim (retired M3, kept for git-history audit): `skills/kos-jarvis/_archived/gemini-embed-shim/shim.std{out,err}.log`
- v1 (idle since cutover 2026-04-16): `workers/kos-worker/server/kos-api.st*.log` (v1 repo)

## Watch the services

```bash
launchctl list | grep com.jarvis
# expect (2026-07-21):
#   PID  0  com.jarvis.gbrain-serve-http          (KeepAlive, :7225)
#   -    0  com.jarvis.gbrain-backup              (cron, daily 03:33)
#   -    0  com.jarvis.dream-cycle                (cron, daily 03:11)
#   -    0  com.jarvis.chunkless-backfill         (cron, daily 07:00)
#   -    0  com.jarvis.kos-patrol                 (cron, daily 08:07)
#   -    0  com.jarvis.embedding-label-normalize  (cron, daily 08:25)
#   -    0  com.jarvis.enrich-sweep               (cron, weekly Sun 22:13)
# (com.jarvis.cloudflared and com.jarvis.star-office-ui-backend also appear
#  but are not managed from this directory.)
```

## Verify a template still matches what is running

The templates are the repo's only claim about production, so check them
rather than assume. This compares every field, masking secret values:

```bash
norm() { sed -E 's/<FILL:[A-Z_]+>/PLACEHOLDER/g' "$1" \
  | plutil -convert json -o - - \
  | python3 -c 'import json,sys,re
d=json.load(sys.stdin); env=d.get("EnvironmentVariables",{})
for k in list(env):
    if re.search(r"KEY|TOKEN|SECRET",k): env[k]="<MASKED>"
print(json.dumps(d,sort_keys=True,indent=1))'; }

for n in gbrain-serve-http gbrain-backup dream-cycle chunkless-backfill \
         kos-patrol embedding-label-normalize enrich-sweep; do
  printf '%-28s ' "$n"
  diff -q <(norm "com.jarvis.$n.plist.template") \
          <(norm ~/Library/LaunchAgents/com.jarvis.$n.plist) >/dev/null \
    && echo 'template == live' || echo 'DRIFT'
done
```

> Use `plutil`, not Python's `plistlib`, to read these files. Several plists
> have XML comments containing `--` (`embed --stale`, `--dry-run`), which is
> illegal in XML: `plistlib`'s expat parser rejects them outright while
> `plutil` and launchd accept them. A comparison built on the strict parser
> silently degrades to comparing two empty strings and reports a false pass.
