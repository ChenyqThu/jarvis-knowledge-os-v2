import { useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { useDashboard } from '../dashboard-context';
import type { PageVersion, PageVersionsResponse, PageRevertResponse } from '../types';
import { formatTimestampPT } from '../lib/time';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface VersionHistoryDialogProps {
  source: string;
  slug: string;
  /** When false the page is locked (fenced / non-default / non-markdown) and
   * rollback is disabled — rollback is a write and must obey the same gate as
   * save (codex HIGH). */
  editable: boolean;
  /** When true the editor has unsaved edits; rollback is disabled because it
   * snapshots the STORED content (not the buffer) and then refetches, which
   * would silently discard those edits (codex MEDIUM). */
  dirty: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped by the pane after a save so the version list refetches on next
   * open (a save creates a new snapshot). */
  refreshToken: number;
  /** Called after a successful (DB-committed) revert with the reverted content +
   * fresh meta, so the pane applies it locally (no refetch). */
  onReverted: (page: PageRevertResponse['page']) => void;
}

/** Version-history drawer (design.md §3): lists `page_versions` snapshots for
 * one page — read straight from the RO plane, so the page's OWN source_id is
 * passed explicitly via `authFetch` (never the global tab). Each row can be
 * rolled back, gated behind a destructive confirm AlertDialog (emil: confirm
 * before destructive). Rollback is disabled unless the page is editable and
 * clean. */
export function VersionHistoryDialog({
  source,
  slug,
  editable,
  dirty,
  open,
  onOpenChange,
  refreshToken,
  onReverted,
}: VersionHistoryDialogProps) {
  const { authFetch } = useDashboard();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<PageVersion | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const query = `?source=${encodeURIComponent(source)}&slug=${encodeURIComponent(slug)}`;

  const rollbackDisabled = !editable || dirty;
  const disabledNote = !editable
    ? '此页当前只读（围栏 / 非 default 源 / 非 markdown），不可回滚。'
    : dirty
      ? '有未保存的编辑，回滚会丢弃它们；请先保存或放弃修改后再回滚。'
      : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVersions(null);
    setError(null);
    authFetch<PageVersionsResponse>(`/pages/versions${query}`)
      .then(res => {
        if (!cancelled) setVersions(res.versions);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source, slug, refreshToken]);

  const doRevert = async () => {
    if (!confirmVersion) return;
    setReverting(true);
    setRevertError(null);
    try {
      const res = await authFetch<PageRevertResponse>('/pages/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, slug, version_id: confirmVersion.id }),
      });
      // Rollback replays through put_page — classify the result exactly like a
      // save (codex HIGH: don't report a skipped/disk-failed revert as success).
      const wt = res.result.write_through;
      const written = res.result.status === 'created_or_updated';
      const diskIssue = wt ? Boolean(wt.error) || (Boolean(wt.skipped) && wt.skipped !== 'dry_run') : false;
      if (!written) {
        setRevertError(`回滚未写入（put_page 返回 status「${res.result.status}」），请重试`);
        setConfirmVersion(null);
        return; // nothing changed — keep the dialog open, don't refresh the pane
      }
      onReverted(res.page); // real DB write → apply reverted content locally
      if (diskIssue) {
        setRevertError(`已回滚（DB），但磁盘 .md 未同步（${wt?.error ?? wt?.skipped}）`);
        setConfirmVersion(null);
        return; // keep the dialog open so the disk warning is seen
      }
      setConfirmVersion(null);
      onOpenChange(false);
    } catch (err) {
      // Same non-cancellable-timeout caveat as save (codex): a 30s AbortSignal
      // rejects here but the revert's put_page keeps running server-side, so
      // steer the user to reload-first rather than blindly retry.
      const name = (err as { name?: string } | null)?.name;
      setRevertError(
        name === 'TimeoutError' || name === 'AbortError'
          ? '回滚超时。后端可能仍在写入——请关闭本面板、重新选择该页确认最新状态后再操作,不要直接重试。'
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setReverting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
            <DialogDescription className="mono text-xs">{slug}</DialogDescription>
          </DialogHeader>

          {disabledNote && (
            <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              {disabledNote}
            </p>
          )}

          {error ? (
            <Alert variant="destructive" className="state-enter">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : versions === null ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无历史版本。</p>
          ) : (
            <ul className="flex max-h-[56vh] flex-col divide-y divide-border overflow-y-auto">
              {versions.map(v => (
                <li key={v.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-sm tabular-nums">{formatTimestampPT(v.snapshot_at)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      #{v.id} · {formatBytes(v.bytes)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rollbackDisabled}
                    onClick={() => {
                      setRevertError(null);
                      setConfirmVersion(v);
                    }}
                  >
                    回滚到此版
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {revertError && (
            <Alert variant="destructive" className="state-enter">
              <AlertTitle>回滚问题</AlertTitle>
              <AlertDescription>{revertError}</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmVersion !== null}
        onOpenChange={o => {
          if (!o && !reverting) setConfirmVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回滚到此版本？</AlertDialogTitle>
            <AlertDialogDescription>
              将把页面内容回滚到
              {confirmVersion ? ` #${confirmVersion.id}（${formatTimestampPT(confirmVersion.snapshot_at)}）` : '该'}
              版本，并重建 chunk/embedding 与磁盘文件。当前已保存的内容会先自动存为新快照，可再次回滚。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={reverting}
              onClick={e => {
                // Keep the confirm open while the request is in flight; close
                // it ourselves on success/failure.
                e.preventDefault();
                void doRevert();
              }}
            >
              {reverting && <Loader2Icon className="animate-spin" />}
              确认回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
