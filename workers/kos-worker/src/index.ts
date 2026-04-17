/**
 * KOS Worker — Notion Worker for Jarvis Knowledge OS v2
 *
 * Provides 4 tools for Notion AI agents (notion jarvis):
 * - kosQuery: Search the knowledge base and get compiled answers
 * - kosIngest: Ingest a URL OR a markdown blob into the knowledge base
 * - kosDigest: Get recent knowledge changes summary
 * - kosStatus: Get knowledge base health metrics
 *
 * These tools call the kos-compat-api server on Lucien's Mac
 * (exposed via cloudflared at https://kos.chenge.ink, port 7220 locally).
 *
 * v2 changes (2026-04-17):
 * - Default KOS_API_BASE now 7220 (v1 was 7720)
 * - kosIngest accepts optional `markdown` / `title` / `source` / `kind` / `tags`
 *   so notion jarvis can ingest Notion-page content without re-fetching a URL.
 *   This is the companion to the /ingest markdown field added to kos-compat-api
 *   on the same day.
 */

import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

const worker = new Worker();
export default worker;

// KOS API base URL (set via ntn workers env push).
// Default 7220 for v2; deployed worker talks to https://kos.chenge.ink.
const KOS_API_BASE = process.env.KOS_API_BASE ?? "http://localhost:7220";
const KOS_API_TOKEN = process.env.KOS_API_TOKEN ?? "";

async function kosApi(
	endpoint: string,
	method: "GET" | "POST" = "GET",
	body?: Record<string, unknown>,
): Promise<string> {
	const url = `${KOS_API_BASE}${endpoint}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (KOS_API_TOKEN) {
		headers["Authorization"] = `Bearer ${KOS_API_TOKEN}`;
	}

	const res = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`KOS API error (${res.status}): ${text}`);
	}

	return res.text();
}

// ─── Tool: kosQuery ───

worker.tool("kosQuery", {
	title: "Knowledge Query",
	description:
		"在 Jarvis Knowledge OS 中检索知识并获得编译级回答。" +
		"基于 55+ 编译页面的 wiki 网络（概念/综合/决策/对比/协议），" +
		"涵盖 harness engineering、context engineering、agent 架构等主题。" +
		"适用于需要深度、跨来源综合答案的问题。",
	schema: j.object({
		question: j
			.string()
			.describe("要查询的问题（中文优先）"),
	}),
	execute: async ({ question }) => {
		const result = await kosApi("/query", "POST", { question });
		return result;
	},
});

// ─── Tool: kosIngest ───

worker.tool("kosIngest", {
	title: "Knowledge Ingest",
	description:
		"将 URL 或 markdown 内容摄入 Jarvis Knowledge OS。" +
		"- 提供 url 时：服务端 fetch → strip → source page → embed。" +
		"- 提供 markdown 时：直接入库,适合 Notion 页面正文、会议纪要、PRD 草案等已经在手的文本内容。" +
		"两种方式都会自动 embed(Gemini),随后可通过 kosQuery 检索。" +
		"适用于值得长期保留的内容。耗时 2-10 秒。",
	schema: j.object({
		url: j
			.string()
			.describe("要摄入的 URL。与 markdown 二选一。")
			.nullable(),
		markdown: j
			.string()
			.describe(
				"要摄入的 markdown 正文。与 url 二选一。" +
				"如果包含 YAML frontmatter(--- 开头)将被原样保留,否则服务端会补上合理的默认 frontmatter。",
			)
			.nullable(),
		title: j
			.string()
			.describe("页面标题,用于生成 slug 和 <h1>。默认从 markdown/URL 推断。")
			.nullable(),
		slug: j
			.string()
			.describe("自定义 slug(英文短横线格式)。默认 title → slugify 推断。")
			.nullable(),
		kind: j
			.string()
			.describe(
				"页面 kind: source|concept|project|decision|synthesis|protocol|timeline|comparison|entity。默认 source。",
			)
			.nullable(),
		source: j
			.string()
			.describe(
				"来源标识。URL / notion:<page_id> / manual:<note> 等。默认从 url 或 notion_id 推断。",
			)
			.nullable(),
		notion_id: j
			.string()
			.describe("Notion 页面 ID(UUID)。会转为 source=notion:<id> 存入 frontmatter。")
			.nullable(),
		tags: j
			.array(j.string())
			.describe("追加到 frontmatter.tags 的额外标签。")
			.nullable(),
	}),
	execute: async ({ url, markdown, title, slug, kind, source, notion_id, tags }) => {
		if (!url && !markdown) {
			throw new Error("kosIngest: 必须提供 url 或 markdown 之一");
		}
		const payload: Record<string, unknown> = {};
		if (url) payload.url = url;
		if (markdown) payload.markdown = markdown;
		if (title) payload.title = title;
		if (slug) payload.slug = slug;
		if (kind) payload.kind = kind;
		if (source) payload.source = source;
		if (notion_id) payload.notion_id = notion_id;
		if (tags && tags.length > 0) payload.tags = tags;

		const result = await kosApi("/ingest", "POST", payload);
		return result;
	},
});

// ─── Tool: kosDigest ───

worker.tool("kosDigest", {
	title: "Knowledge Digest",
	description:
		"获取最近 N 天的知识库变更摘要。" +
		"包含新增页面、更新页面、编译统计，以及可回流到 MEMORY 的格式化条目。" +
		"默认 7 天。",
	schema: j.object({
		since: j
			.number()
			.describe("回溯天数（默认 7）")
			.nullable(),
	}),
	execute: async ({ since }) => {
		const days = since ?? 7;
		const result = await kosApi(`/digest?since=${days}`);
		return result;
	},
});

// ─── Tool: kosStatus ───

worker.tool("kosStatus", {
	title: "Knowledge Status",
	description:
		"获取 Jarvis Knowledge OS 健康状态。" +
		"包含页面数、编译率、知识密度、信心分布等指标。",
	schema: j.object({}),
	execute: async () => {
		const result = await kosApi("/status");
		return result;
	},
});
