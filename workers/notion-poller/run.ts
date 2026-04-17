#!/usr/bin/env bun
/**
 * notion-poller — 5-min cron pull from Notion DBs into the brain.
 *
 * Flow per monitored DB:
 *   databases.query(sort=last_edited_time desc, filter last_edited_time > cursor)
 *     → for each page, retrieve page + all children blocks
 *     → flatten blocks to markdown
 *     → POST /ingest { markdown, title, source:"notion:<id>", notion_id, kind }
 *     → update cursor
 *
 * See ./README.md for config and failure modes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ── config ──

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const DB_IDS = (process.env.NOTION_DATABASE_IDS ?? "")
  .split(",")
  .map((s) => s.trim().replace(/-/g, ""))
  .filter(Boolean);
const KOS_API_BASE = process.env.KOS_API_BASE ?? "http://127.0.0.1:7220";
const KOS_API_TOKEN = process.env.KOS_API_TOKEN ?? "";
const STATE_PATH =
  process.env.POLLER_STATE_PATH ??
  join(homedir(), "brain", "agent", "notion-poller-state.json");
const NOTION_VERSION = "2022-06-28";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const BACKFILL = args.includes("--backfill");

// ── state ──

type DbState = { last_edited_time: string | null };
type State = Record<string, DbState>;

function loadState(): State {
  if (BACKFILL || !existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: State) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// ── notion REST ──

async function notion(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (r.status === 429) {
    const retry = Number(r.headers.get("Retry-After") ?? "1");
    await new Promise((res) => setTimeout(res, retry * 1000));
    return notion(path, init);
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Notion ${init.method ?? "GET"} ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

type NotionPage = {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
  url: string;
  archived: boolean;
};

async function queryDatabase(dbId: string, since: string | null): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  while (true) {
    const body: any = {
      page_size: 50,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    };
    if (since) {
      body.filter = {
        timestamp: "last_edited_time",
        last_edited_time: { on_or_after: since },
      };
    }
    if (cursor) body.start_cursor = cursor;
    const resp = await notion(`/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const p of resp.results as NotionPage[]) pages.push(p);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
    // Cap defensively on backfill
    if (pages.length >= 500) break;
  }
  return pages;
}

async function fetchChildren(blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  while (true) {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const resp = await notion(`/blocks/${blockId}/children?${params}`);
    for (const block of resp.results) out.push(block);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return out;
}

// ── property → title ──

function extractTitle(page: NotionPage): string {
  for (const [, prop] of Object.entries(page.properties)) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((t: any) => t.plain_text ?? "").join("").trim() || "(untitled)";
    }
  }
  return "(untitled)";
}

// ── block → markdown ──

function richTextToMd(rts: any[] | undefined): string {
  if (!Array.isArray(rts)) return "";
  return rts
    .map((rt) => {
      let t = rt.plain_text ?? "";
      const ann = rt.annotations ?? {};
      if (ann.code) t = `\`${t}\``;
      if (ann.bold) t = `**${t}**`;
      if (ann.italic) t = `*${t}*`;
      if (ann.strikethrough) t = `~~${t}~~`;
      if (rt.href) t = `[${t}](${rt.href})`;
      return t;
    })
    .join("");
}

async function blocksToMarkdown(blocks: any[], depth = 0): Promise<string> {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  for (const b of blocks) {
    const type = b.type;
    const content = b[type] ?? {};
    switch (type) {
      case "heading_1":
        lines.push(`# ${richTextToMd(content.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`## ${richTextToMd(content.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`### ${richTextToMd(content.rich_text)}`);
        break;
      case "paragraph": {
        const t = richTextToMd(content.rich_text);
        if (t.trim()) lines.push(`${indent}${t}`);
        break;
      }
      case "bulleted_list_item":
        lines.push(`${indent}- ${richTextToMd(content.rich_text)}`);
        break;
      case "numbered_list_item":
        lines.push(`${indent}1. ${richTextToMd(content.rich_text)}`);
        break;
      case "to_do": {
        const mark = content.checked ? "x" : " ";
        lines.push(`${indent}- [${mark}] ${richTextToMd(content.rich_text)}`);
        break;
      }
      case "quote":
        lines.push(`${indent}> ${richTextToMd(content.rich_text)}`);
        break;
      case "callout":
        lines.push(`${indent}> 💡 ${richTextToMd(content.rich_text)}`);
        break;
      case "code": {
        const lang = content.language ?? "";
        const code = richTextToMd(content.rich_text);
        lines.push("```" + lang, code, "```");
        break;
      }
      case "divider":
        lines.push("---");
        break;
      case "bookmark":
      case "embed":
      case "link_preview":
        if (content.url) lines.push(`${indent}🔗 ${content.url}`);
        break;
      case "image": {
        const url = content.external?.url ?? content.file?.url;
        if (url) lines.push(`${indent}![image](${url})`);
        break;
      }
      case "toggle":
        lines.push(`${indent}<details><summary>${richTextToMd(content.rich_text)}</summary>`);
        break;
      case "child_page":
      case "child_database":
        lines.push(`${indent}_[nested ${type}: ${content.title ?? ""}]_`);
        break;
      case "table":
      case "synced_block":
      case "column_list":
      case "column":
        lines.push(`${indent}_[${type} — open in Notion for full content]_`);
        break;
      default:
        // Last-ditch: dump plain_text if present
        if (content.rich_text) {
          const t = richTextToMd(content.rich_text);
          if (t.trim()) lines.push(`${indent}${t}`);
        }
    }
    if (b.has_children && ["toggle", "bulleted_list_item", "numbered_list_item", "to_do"].includes(type)) {
      const kids = await fetchChildren(b.id);
      const sub = await blocksToMarkdown(kids, depth + 1);
      if (sub.trim()) lines.push(sub);
    }
  }
  return lines.join("\n");
}

// ── slug derive ──

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || `notion-${Date.now()}`;
}

// ── ingest ──

async function ingest(payload: {
  title: string;
  markdown: string;
  notion_id: string;
  source: string;
  slug: string;
}): Promise<string> {
  const url = `${KOS_API_BASE}/ingest`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KOS_API_TOKEN}`,
    },
    body: JSON.stringify({
      markdown: payload.markdown,
      title: payload.title,
      slug: `notion/${payload.slug}`,
      kind: "source",
      source: payload.source,
      notion_id: payload.notion_id,
      tags: ["notion", "notion-poller"],
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ingest ${r.status}: ${text.slice(0, 300)}`);
  return text;
}

// ── main ──

async function main() {
  console.log(`=== notion-poller @ ${new Date().toISOString()} ===`);
  console.log(`Mode: ${DRY ? "DRY" : BACKFILL ? "BACKFILL" : "DELTA"}`);

  if (!NOTION_TOKEN) {
    console.log("NOTION_TOKEN not set in env — skipping run. Fill .env.local.");
    process.exit(0);
  }
  if (DB_IDS.length === 0) {
    console.log("NOTION_DATABASE_IDS empty — skipping run. Fill .env.local with one or more UUIDs.");
    process.exit(0);
  }

  const state = loadState();
  let totalSeen = 0;
  let totalIngested = 0;

  for (const dbId of DB_IDS) {
    console.log(`\n[DB ${dbId.slice(0, 8)}…]`);
    const prev = state[dbId] ?? { last_edited_time: null };
    const since = prev.last_edited_time;
    if (since) console.log(`  since: ${since}`);
    else console.log(`  since: (backfill, no prior cursor)`);

    let pages: NotionPage[];
    try {
      pages = await queryDatabase(dbId, since);
    } catch (e) {
      console.error(`  ✗ query failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    console.log(`  ${pages.length} pages match`);
    totalSeen += pages.length;

    let newest = since;
    let ingested = 0;
    for (const page of pages) {
      if (page.archived) continue;
      if (since && page.last_edited_time <= since) continue;

      const title = extractTitle(page);
      const slug = slugify(title);
      console.log(`    • ${page.id.slice(0, 8)} ${title.slice(0, 60)}`);
      if (DRY) {
        ingested++;
      } else {
        try {
          const blocks = await fetchChildren(page.id);
          const md = await blocksToMarkdown(blocks);
          const notionRef = page.id.replace(/-/g, "");
          await ingest({
            title,
            markdown: md,
            notion_id: notionRef,
            source: `notion:${notionRef}`,
            slug,
          });
          ingested++;
        } catch (e) {
          console.error(`      ✗ ingest failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (!newest || page.last_edited_time > newest) newest = page.last_edited_time;
    }
    totalIngested += ingested;
    console.log(`  ${ingested} ingested${DRY ? " (dry)" : ""}`);
    if (!DRY && newest) state[dbId] = { last_edited_time: newest };
  }

  if (!DRY) saveState(state);

  console.log(`\nSummary: ${DB_IDS.length} DBs, ${totalSeen} pages seen, ${totalIngested} ingested${DRY ? " (dry)" : ""}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
