# launchd Services — Stage 3.2 Cutover Reference

Two services replace v1 `com.jarvis.kos-api` (Python kos-api.py):

1. **com.jarvis.gemini-embed-shim** — port 7222, OpenAI→Gemini translator
   for pgvector embeddings. Requires `NANO_BANANA_API_KEY`.
2. **com.jarvis.kos-compat-api** — port 7220, drop-in HTTP replacement for
   kos-api.py. Talks to gbrain CLI. Inherits old KOS_API_TOKEN so Notion
   Knowledge Agent keeps working unchanged.

The actual `.plist` files in this directory are **gitignored** (they
embed secrets). Only the `.plist.template` files are tracked.

## First-time install

```bash
# From this directory, fill in secrets and copy to LaunchAgents
cp com.jarvis.gemini-embed-shim.plist.template com.jarvis.gemini-embed-shim.plist
cp com.jarvis.kos-compat-api.plist.template com.jarvis.kos-compat-api.plist

# Edit each .plist and replace:
#   <FILL:NANO_BANANA_API_KEY>  → your Google GenAI key
#   <FILL:KOS_API_TOKEN>        → same token as v1 kos-api plist
#     (inherit from ~/Library/LaunchAgents/com.jarvis.kos-api.plist)

# Install to LaunchAgents
cp com.jarvis.gemini-embed-shim.plist ~/Library/LaunchAgents/
cp com.jarvis.kos-compat-api.plist ~/Library/LaunchAgents/
```

## Cutover sequence (Stage 3.2)

Run these in order. After each step verify the expected state.

```bash
# 1. Stop v1 kos-api.py (keeps plist on disk for rollback)
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-api.plist
lsof -i :7220 -P  # expect: no listeners

# 2. Start the embed shim first (embedding is a dep of some gbrain queries)
launchctl load ~/Library/LaunchAgents/com.jarvis.gemini-embed-shim.plist
sleep 2
curl -s http://127.0.0.1:7222/health | jq .
# expect: {"status":"ok","upstream":"gemini","model":"gemini-embedding-2-preview"}

# 3. Start kos-compat-api (takes over 7220)
launchctl load ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
sleep 2
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7220/health | jq .
# expect: {"status":"ok","brain":"/Users/chenyuanquan/brain","engine":"gbrain"}

# 4. End-to-end check via kos.chenge.ink (same domain, new backend)
curl -s -H "Authorization: Bearer $TOKEN" https://kos.chenge.ink/status | jq .
# expect: total_pages=85
```

## Rollback

If any cutover step fails:

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
launchctl unload ~/Library/LaunchAgents/com.jarvis.gemini-embed-shim.plist
launchctl load ~/Library/LaunchAgents/com.jarvis.kos-api.plist
# v1 back in control, 30 seconds max downtime
```

## Archive old service (after 7-day dual-read proven stable)

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.kos-api.plist
mv ~/Library/LaunchAgents/com.jarvis.kos-api.plist ~/Library/LaunchAgents/_archive/
```

## Logs

- Shim:    `skills/kos-jarvis/gemini-embed-shim/shim.std{out,err}.log`
- Compat:  `server/kos-compat-api.std{out,err}.log`
- v1 (idle after cutover): `workers/kos-worker/server/kos-api.st*.log` (v1 repo)

## Watch the services

```bash
launchctl list | grep com.jarvis
# expect after cutover:
#   PID  0  com.jarvis.gemini-embed-shim
#   PID  0  com.jarvis.kos-compat-api
#   -    0  com.jarvis.kos-deep-lint   (unchanged, still lints v1 archive — fine)
```
