import { useEffect, useRef, useState } from 'react';
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useDashboard } from '../dashboard-context';
import type { PageDetail, PageLockReason, PageRevertResponse, PageSaveResponse } from '../types';
import { kindLabel } from '../constants';
import { formatTimestampPT } from '../lib/time';
import { cn } from '@/lib/utils';
import { MarkdownEditor } from './MarkdownEditor';
import { VersionHistoryDialog } from './VersionHistoryDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Why an uneditable page is locked, and how to explain it (design.md §3).
const LOCK_INFO: Record<Exclude<PageLockReason, null>, { label: string; tip: string; className: string }> = {
  fenced: {
    label: '只读 · 围栏',
    tip: '含 takes/facts 围栏，编辑会永久丢失围栏内容，暂不开放',
    className: 'border-destructive/40 text-destructive',
  },
  unsupported_page_kind: {
    label: '只读 · 非 markdown',
    tip: 'code / image 页保存会被转成 markdown 并破坏其分块，不可编辑',
    className: 'border-warning/40 text-warning',
  },
  non_default_source: {
    label: '只读 · 非 default 源',
    tip: '仅 default 源可写回',
    className: 'border-warning/40 text-warning',
  },
};

function LockBadge({ reason }: { reason: Exclude<PageLockReason, null> }) {
  const info = LOCK_INFO[reason];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-full">
          <Badge variant="outline" className={info.className}>
            {info.label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{info.tip}</TooltipContent>
    </Tooltip>
  );
}

interface PageDetailPaneProps {
  /** The row selected in the left list, or null. Only `source_id` + `slug` are
   * load-bearing here — everything else is refetched authoritatively via
   * `/pages/detail` (the server re-decides editability). */
  selected: { source_id: string; slug: string } | null;
}

/** Right pane: read-only header + markdown editor + save/version controls.
 * detail/versions/save/revert all target the page's OWN source_id explicitly
 * via `authFetch` — NOT the global source tab (design.md §3 correctness rule). */
export function PageDetailPane({ selected }: PageDetailPaneProps) {
  const { authFetch } = useDashboard();
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<PageSaveResponse['result'] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [versionsToken, setVersionsToken] = useState(0);

  const sourceId = selected?.source_id ?? null;
  const slug = selected?.slug ?? null;
  const query = sourceId && slug ? `?source=${encodeURIComponent(sourceId)}&slug=${encodeURIComponent(slug)}` : null;
  // Always-current selection key so an in-flight save can tell whether the user
  // has since selected another page and must NOT apply its response to it (codex).
  const queryRef = useRef(query);
  queryRef.current = query;
  // Monotonic operation token. The query string is identical for two saves of
  // the SAME page, so string equality (queryRef) can't tell an OLD save on page
  // A from the CURRENT one (codex: A→B→A / overlapping-save race). Every
  // save/revert and every selection/retry bumps this; a response only applies —
  // and only clears `saving` — when its captured token is still the latest.
  const opSeq = useRef(0);

  // Loads detail on a page-selection change or an explicit retry only. Save and
  // revert do NOT run this effect — they update `detail`/`content` LOCALLY from
  // the write response (no refetch), which removes the whole refetch-vs-editor
  // clobber surface and the stuck-read-only-on-a-hung-fetch failure mode (codex).
  // Because the effect doesn't run on a write, a save's feedback alert survives.
  useEffect(() => {
    opSeq.current += 1; // a new selection (or retry) invalidates any in-flight save/revert
    if (!query) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setSaveResult(null);
    setSaveError(null);
    setSaving(false); // a save on the previous page must not leave this one read-only
    authFetch<PageDetail>(`/pages/detail${query}`)
      .then(res => {
        if (cancelled) return;
        setDetail(res);
        setContent(res.content);
      })
      .catch(err => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, retryTick]);

  if (!selected) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        从左侧选择一个页面开始编辑
      </div>
    );
  }

  if (detailError) {
    return (
      <Alert variant="destructive" className="state-enter">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{detailError}</span>
          <Button variant="outline" size="sm" onClick={() => setRetryTick(t => t + 1)}>
            重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-[60vh] rounded-md" />
      </div>
    );
  }

  const editable = detail.editable;
  const dirty = content !== detail.content;

  // Classify the save outcome (codex: don't report skipped/partial as success).
  const wt = saveResult?.write_through;
  const saveWritten = saveResult?.status === 'created_or_updated';
  const diskIssue = wt ? Boolean(wt.error) || (Boolean(wt.skipped) && wt.skipped !== 'dry_run') : false;

  const onSave = async () => {
    const target = query; // the page this save is for
    const op = ++opSeq.current; // this save's unique token
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      const res = await authFetch<PageSaveResponse>('/pages/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: detail.source_id,
          slug: detail.slug,
          content,
          expected_content_hash: detail.content_hash,
        }),
      });
      if (queryRef.current !== target || opSeq.current !== op) return; // navigated away, or a newer save/revert superseded this one
      setSaveResult(res.result);
      if (res.result.status === 'created_or_updated') {
        setVersionsToken(t => t + 1);
        // Local update, no refetch: the editor already holds the saved content,
        // so reset `dirty` (detail.content := content), refresh the concurrency
        // token, and refresh the header meta (title/type/kind) from the write
        // response.
        setDetail(d =>
          d
            ? {
                ...d,
                content,
                content_hash: res.page?.content_hash ?? d.content_hash,
                updated_at: res.page?.updated_at ?? d.updated_at,
                title: res.page?.title ?? d.title,
                type: res.page?.type ?? d.type,
                kind: res.page?.kind ?? d.kind,
              }
            : d,
        );
      }
    } catch (err) {
      if (queryRef.current === target && opSeq.current === op) {
        // A 30s AbortSignal.timeout rejects here, but the backend put_page is
        // NOT cancelled (codex #1) — steer the user to reload rather than blindly
        // retry, so the retry's expected_content_hash catches a late zombie write.
        const name = (err as { name?: string } | null)?.name;
        const msg =
          name === 'TimeoutError' || name === 'AbortError'
            ? '保存超时。后端可能仍在写入——请先重新选择本页确认最新状态,再决定是否重试(直接重试可能与仍在进行的写入并发)。'
            : err instanceof Error
              ? err.message
              : String(err);
        setSaveError(msg);
      }
    } finally {
      if (queryRef.current === target && opSeq.current === op) setSaving(false);
    }
  };

  // A confirmed rollback (from the modal dialog, so the editor wasn't being
  // typed into) hands back the reverted content + fresh meta; apply it locally.
  const onReverted = (reverted: PageRevertResponse['page']) => {
    opSeq.current += 1; // a completed revert supersedes any in-flight save on this page
    setSaveResult(null);
    setSaveError(null);
    setContent(reverted.content);
    setDetail(d =>
      d
        ? {
            ...d,
            content: reverted.content,
            content_hash: reverted.content_hash,
            updated_at: reverted.updated_at,
            title: reverted.title,
            type: reverted.type,
            kind: reverted.kind,
          }
        : d,
    );
    setVersionsToken(t => t + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="mono truncate text-sm text-muted-foreground">{detail.slug}</span>
            {!editable && detail.lock_reason && <LockBadge reason={detail.lock_reason} />}
          </div>
          <h2 className="truncate text-lg font-semibold">{detail.title}</h2>
          <p className="text-xs text-muted-foreground">
            {detail.type} · {kindLabel(detail.kind)} · 更新 {formatTimestampPT(detail.updated_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
            版本历史
          </Button>
          <Button size="sm" disabled={!editable || saving || !dirty} onClick={onSave}>
            {saving && <Loader2Icon className="animate-spin" />}
            保存
          </Button>
        </div>
      </div>

      {saveResult &&
        (saveWritten ? (
          <Alert
            className={cn(
              'state-enter',
              diskIssue ? 'border-warning/40 [&>svg]:text-warning' : 'border-success/40 [&>svg]:text-success',
            )}
          >
            {diskIssue ? <TriangleAlertIcon /> : <CheckCircle2Icon />}
            <AlertTitle>{diskIssue ? '已保存（磁盘写入异常）' : '保存成功'}</AlertTitle>
            <AlertDescription>
              重建 {saveResult.chunks.toLocaleString('zh-CN')} 个 chunk
              {diskIssue ? `；磁盘 .md 未同步（${wt?.error ?? wt?.skipped}）` : ''}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="state-enter border-warning/40 [&>svg]:text-warning">
            <TriangleAlertIcon />
            <AlertTitle>未写入</AlertTitle>
            <AlertDescription>
              put_page 返回 status「{saveResult.status}」——内容未变更或被上游拒绝，编辑仍保留，请检查后重试。
            </AlertDescription>
          </Alert>
        ))}
      {saveError && (
        <Alert variant="destructive" className="state-enter">
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <MarkdownEditor value={content} onChange={setContent} readOnly={!editable || saving} />

      {editable && (
        <p className="text-xs text-muted-foreground">
          标签为增量：在 frontmatter 新增 tag 会生效，删除 tag 不会（上游 tag 协调为 add-only），保存后会复现。
        </p>
      )}

      <VersionHistoryDialog
        source={detail.source_id}
        slug={detail.slug}
        editable={editable}
        dirty={dirty}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        refreshToken={versionsToken}
        onReverted={onReverted}
      />
    </div>
  );
}
