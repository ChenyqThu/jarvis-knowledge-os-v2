import { homedir } from 'node:os';
import { resolve } from 'node:path';

// F7 ops-action registry (PRD F7 / m3-editor design). Every action is a FIXED
// command template — an argv array assembled here from a closed allowlist, never
// a shell string and never free-text concatenation. Actions run as spawned
// children of the dashboard (jobs.ts owns the process + its log), NOT via a
// shell, so nothing a caller sends can escape argv. The only caller-supplied
// values are the embed action's (source, slugs), and those are re-derived and
// re-validated server-side against the live chunkless set before they reach
// buildEmbedArgv (see ops/slugs.ts + routes/ops.ts).
//
// Design choice: run the SAME commands the vetted launchd crons run, rather than
// `launchctl kickstart` them. The two bash scripts self-`cd` to the repo root
// and self-source `.env.local` (chunkless also `unset ANTHROPIC_BASE_URL`), so
// spawning them is equivalent to the cron path but gives us one uniform,
// log-owning job model + exit code instead of parsing scattered launchd logs.

// The repo root — the dashboard's launchd WorkingDirectory, and where the fork
// scripts + `bin/gbrain` live. Resolved from this module's location so it holds
// regardless of the process CWD. (src/ops/registry.ts → up 3 = repo root.)
export const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

// The compiled, deployed gbrain binary — the exact one the serve daemon and the
// chunkless-backfill cron use for the embed path, so ad-hoc embeds land in the
// identical vector space (openai:text-embedding-3-large@1536). Override for a
// non-standard install via KOS_DASH_GBRAIN_BIN.
const GBRAIN_BIN = process.env.KOS_DASH_GBRAIN_BIN ?? resolve(REPO_ROOT, 'bin', 'gbrain');
const BUN_BIN = process.env.KOS_DASH_BUN_BIN ?? resolve(homedir(), '.bun', 'bin', 'bun');
const BASH_BIN = '/bin/bash';

// Ceiling on how many slugs one embed action may target — bounds the OpenAI
// spend a single button press can trigger, and keeps the argv sane. A larger
// backlog is what the scheduled chunkless-backfill cron is for.
export const MAX_EMBED_SLUGS = 100;

export type Danger = 'read' | 'write' | 'spend';

export interface ActionSpec {
  id: string;
  /** Chinese UI label. */
  label: string;
  /** Chinese one-line description of exactly what runs. */
  desc: string;
  /** Drives the UI's confirm level + badge color. */
  danger: Danger;
  /** Require a destructive-confirm dialog before running (all write/spend
   * actions). */
  confirm: boolean;
  /** embed-selected takes {source, slugs}; the rest are parameterless. */
  needsParams: boolean;
  /** Fixed argv for the parameterless actions. embed-selected has none here —
   * its argv is built per-request in routes/ops.ts after slug validation. */
  argv?: string[];
}

// The closed action set. NOTE what is deliberately EXCLUDED: a real (non-dry)
// enrich-sweep and dream-cycle (unbounded LLM spend) are not exposed to the web
// surface this wave; enrich-sweep is dry-run-only here. embed-selected is the
// only parameterized action, and its parameters are constrained to the live
// chunkless set.
export const ACTIONS: Record<string, ActionSpec> = {
  doctor: {
    id: 'doctor',
    label: '运行 doctor',
    desc: '健康诊断（gbrain doctor --json），不写库；含一次极小的 embedding 探活调用（亚分钱）。',
    danger: 'read',
    confirm: false,
    needsParams: false,
    argv: [GBRAIN_BIN, 'doctor', '--json'],
  },
  'enrich-sweep-dry': {
    id: 'enrich-sweep-dry',
    label: 'enrich-sweep 预演',
    desc: '实体抽取 sweep 的 --dry 计划预览：不调用 Haiku/Tavily、不写库、零花费。',
    danger: 'read',
    confirm: false,
    needsParams: false,
    argv: [BUN_BIN, 'run', resolve(REPO_ROOT, 'skills/kos-jarvis/enrich-sweep/run.ts'), '--dry'],
  },
  'label-normalize': {
    id: 'label-normalize',
    label: '标签归一化',
    desc: '把 content_chunks 的 zembed 误标改回 openai:te3（纯 SQL、config 守卫、零花费）。',
    danger: 'write',
    confirm: true,
    needsParams: false,
    argv: [BASH_BIN, resolve(REPO_ROOT, 'scripts/jarvis-embedding-label-normalize.sh')],
  },
  'kos-patrol': {
    id: 'kos-patrol',
    label: 'kos-patrol 巡检',
    desc: '每日盘点/缺口报告，写 markdown 报告 + 少量 LLM 花费。',
    danger: 'spend',
    confirm: true,
    needsParams: false,
    argv: [BUN_BIN, 'run', resolve(REPO_ROOT, 'skills/kos-jarvis/kos-patrol/run.ts')],
  },
  'chunkless-backfill': {
    id: 'chunkless-backfill',
    label: 'chunkless 补齐',
    desc: '给无 chunk 的页补 chunk+embed（单次上限 3000 页；真实 OpenAI 花费）。',
    danger: 'spend',
    confirm: true,
    needsParams: false,
    argv: [BASH_BIN, resolve(REPO_ROOT, 'scripts/jarvis-chunkless-backfill.sh')],
  },
  'embed-selected': {
    id: 'embed-selected',
    label: 'embed 选中页',
    desc: '对健康页选中的 chunkless 页做 embed（--source 先于 --slugs，永不 --all；真实 OpenAI 花费）。',
    danger: 'spend',
    confirm: true,
    needsParams: true,
    // argv built per-request (buildEmbedArgv) after slug re-validation.
  },
};

/**
 * The ONLY place an embed argv is assembled. Enforces the CLAUDE.md iron rules
 * structurally, as defense-in-depth on top of the route's slug validation:
 *   - a non-empty source (embed --all is never reachable — no slugs, no run),
 *   - `--source` positioned BEFORE `--slugs` (an unscoped embed silently
 *     no-ops on another source's same-named page),
 *   - each slug a separate argv element (matches the vetted chunkless cron:
 *     `--slugs` swallows every following non-`--` token), so no shell, no CSV,
 *     no injection.
 */
export function buildEmbedArgv(source: string, slugs: string[]): string[] {
  if (!source || typeof source !== 'string') throw new Error('embed: source required');
  if (source.startsWith('-')) throw new Error('embed: source must not look like a flag');
  if (slugs.length === 0) throw new Error('embed: refusing an empty slug set (never embed --all)');
  if (slugs.length > MAX_EMBED_SLUGS) throw new Error(`embed: too many slugs (max ${MAX_EMBED_SLUGS})`);
  // CRITICAL (codex BLOCKER): a slug beginning with `-` would be parsed by
  // `gbrain embed` as a CLI flag, not a positional value — e.g. a page literally
  // named `--all` or `--background` after `--slugs` turns the run into an
  // all-source embed, defeating the count bound AND the never-`--all` iron rule.
  // Since `--slugs` swallows every following non-`--` token as a separate argv
  // element (no shell, no CSV), the ONLY escape is a flag-shaped value. Reject
  // any such slug outright — real page slugs never start with `-`.
  const flagLike = slugs.filter(s => s.startsWith('-'));
  if (flagLike.length > 0) {
    throw new Error(`embed: refusing flag-like slug(s): ${flagLike.slice(0, 3).join(', ')}`);
  }
  return [GBRAIN_BIN, 'embed', '--source', source, '--slugs', ...slugs];
}
