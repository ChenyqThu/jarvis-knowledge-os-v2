#!/usr/bin/env bun
/**
 * kos-compat-api.ts — Drop-in replacement for knowledge-os v1 kos-api.py.
 *
 * Exposes the same HTTP contract that kos-worker (Notion Worker) calls:
 *   POST /query    { question }      → gbrain ask <question>
 *   POST /ingest   { url, slug? }    → URL → staging .md → gbrain import
 *   GET  /digest   ?since=N          → latest kos-patrol digest or live synth
 *   GET  /status                     → inventory snapshot (pages, kinds, conf.)
 *   GET  /health                     → { status, brain }
 *
 * Auth: Authorization: Bearer <token> (KOS_API_TOKEN env, optional).
 * Port: KOS_API_PORT env (default 7220 to match old kos-api.py).
 *
 * Usage:
 *   bun run server/kos-compat-api.ts --port 7220
 *   KOS_API_TOKEN=secret bun run server/kos-compat-api.ts
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.KOS_API_PORT ?? readFlag("--port") ?? 7220);
const TOKEN = process.env.KOS_API_TOKEN ?? "";
const BRAIN = process.env.GBRAIN_HOME ?? join(homedir(), "brain");
const DIGEST_DIR = join(BRAIN, "agent", "digests");

function readFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function gbrain(args: string[], timeoutMs = 120_000): { code: number; stdout: string } {
  const r = spawnSync("gbrain", args, { encoding: "utf-8", timeout: timeoutMs });
  const out = stripAnsi((r.stdout ?? "") + (r.stderr ?? ""));
  return { code: r.status ?? 1, stdout: out };
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  const payload = typeof body === "string" ? { result: body } : body;
  res.end(JSON.stringify(payload, null, 2));
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!TOKEN) return true;
  const h = req.headers.authorization ?? "";
  if (h === `Bearer ${TOKEN}`) return true;
  send(res, 401, { error: "unauthorized" });
  return false;
}

// ─── handlers ───

function handleHealth(res: ServerResponse) {
  send(res, 200, { status: "ok", brain: BRAIN, engine: "gbrain" });
}

function handleStatus(res: ServerResponse) {
  const list = gbrain(["list", "--limit", "10000"], 30_000);
  if (list.code !== 0) return send(res, 500, list.stdout);
  const rows = list.stdout.trim().split("\n").filter(Boolean);
  const byType: Record<string, number> = {};
  for (const line of rows) {
    const type = line.split("\t")[1] ?? "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
  }
  send(res, 200, {
    total_pages: rows.length,
    by_type: byType,
    engine: "gbrain (pglite)",
    brain: BRAIN,
    note: "v2 inventory snapshot; DIKW/confidence rollup via kos-patrol",
  });
}

function handleDigest(res: ServerResponse, sinceDays: number) {
  // Prefer latest kos-patrol digest file if present.
  try {
    const files = readdirSync(DIGEST_DIR)
      .filter((f) => f.startsWith("patrol-") && f.endsWith(".md"))
      .sort()
      .reverse();
    if (files.length > 0) {
      const body = readFileSync(join(DIGEST_DIR, files[0]), "utf-8");
      return send(res, 200, body);
    }
  } catch {
    // digest dir doesn't exist yet
  }
  // Fallback: live inventory summary
  const list = gbrain(["list", "--limit", "10000"], 30_000);
  const rows = list.stdout.trim().split("\n").filter(Boolean);
  const text = `[knowledge-os] (live, since ${sinceDays}d): ${rows.length} pages in gbrain.
Patrol digest file not found at ${DIGEST_DIR}. Run kos-patrol first.`;
  send(res, 200, text);
}

async function handleQuery(req: IncomingMessage, res: ServerResponse) {
  let body: { question?: string };
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const q = body.question?.trim();
  if (!q) return send(res, 400, { error: "question is required" });
  const r = gbrain(["ask", q, "--no-expand"], 120_000);
  send(res, r.code === 0 ? 200 : 500, r.stdout);
}

async function handleIngest(req: IncomingMessage, res: ServerResponse) {
  let body: { url?: string; slug?: string };
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const url = body.url?.trim();
  if (!url) return send(res, 400, { error: "url is required" });
  const slug =
    body.slug?.trim() ||
    url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .slice(0, 80);

  // Fetch URL → write staging .md → gbrain import
  const stage = join(tmpdir(), `gbrain-ingest-${Date.now()}`);
  mkdirSync(stage, { recursive: true });

  let fetched: string;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "kos-compat-api/1.0 (gbrain-ingest)" },
    });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    fetched = await r.text();
  } catch (e) {
    return send(res, 502, { error: `failed to fetch url: ${String(e)}` });
  }

  // Minimal HTML strip — full opencli 79-platform routing handled by v1 during
  // transition; Week 4 replaces this with a proper ingest-via-idea-ingest path.
  const plain = fetched
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50_000);

  const today = new Date().toISOString().slice(0, 10);
  const md = `---
id: source-${slug}
kind: source
status: draft
created: '${today}'
updated: '${today}'
owners:
  - jarvis
confidence: low
source_of_truth: raw
source_refs:
  - ${url}
tags: [ingest-via-compat-api]
---

# ${slug}

> Fetched via kos-compat-api /ingest on ${today}.
> Source: ${url}

${plain}
`;
  const path = join(stage, `${slug}.md`);
  writeFileSync(path, md, "utf-8");

  const importRes = gbrain(["import", stage, "--no-embed"], 180_000);
  if (importRes.code !== 0) {
    return send(res, 500, {
      imported: false,
      slug,
      staged_at: path,
      output: importRes.stdout,
    });
  }

  // Auto-embed the new page so vector/semantic search works immediately.
  // Requires OPENAI_BASE_URL (gemini shim) and OPENAI_API_KEY in env —
  // provided by launchd plist. Non-fatal on failure: ingest still succeeds,
  // page just lacks vectors until next `gbrain embed --stale`.
  const embedRes = gbrain(["embed", slug], 120_000);
  const embedded = embedRes.code === 0;

  send(res, 200, {
    imported: true,
    embedded,
    slug,
    staged_at: path,
    output: importRes.stdout + (embedded ? "" : `\n[embed failed] ${embedRes.stdout}`),
    next: embedded
      ? "page is searchable via keyword + vector; dikw-compile recommended for strong-link network"
      : "page imported but not embedded — retry `gbrain embed " + slug + "` manually",
  });
}

// ─── server ───

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }
  if (!checkAuth(req, res)) return;

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/health") return handleHealth(res);
    if (req.method === "GET" && path === "/status") return handleStatus(res);
    if (req.method === "GET" && path === "/digest") {
      const since = Number(url.searchParams.get("since") ?? "7");
      return handleDigest(res, since);
    }
    if (req.method === "POST" && path === "/query") return await handleQuery(req, res);
    if (req.method === "POST" && path === "/ingest") return await handleIngest(req, res);
    send(res, 404, { error: `unknown endpoint: ${req.method} ${path}` });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`kos-compat-api listening on http://127.0.0.1:${PORT}`);
  console.log(`Brain: ${BRAIN}`);
  console.log(`Auth: ${TOKEN ? "Bearer token required" : "none (dev mode)"}`);
  console.log(`Endpoints: GET /health /status /digest | POST /query /ingest`);
});
