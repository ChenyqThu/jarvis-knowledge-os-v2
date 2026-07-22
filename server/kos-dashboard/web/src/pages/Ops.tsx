import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2Icon, PlayIcon, TriangleAlertIcon } from 'lucide-react';
import { useDashboard } from '../dashboard-context';
import type {
  ChunklessPageRow,
  HealthResponse,
  OpsAction,
  OpsActionsResponse,
  OpsDanger,
  OpsJob,
  OpsJobDetail,
  OpsJobsResponse,
  OpsRunResponse,
} from '../types';
import { ALL_SOURCES } from '../api';
import { formatTimestampPT } from '../lib/time';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const EMBED_MAX = 100; // must match MAX_EMBED_SLUGS on the server (registry.ts)

function DangerBadge({ danger }: { danger: OpsDanger }) {
  if (danger === 'read') return <Badge variant="secondary">只读</Badge>;
  if (danger === 'write') return <Badge variant="outline">写库</Badge>;
  return (
    <Badge variant="outline" className="border-warning/40 text-warning">
      花钱
    </Badge>
  );
}

function statusLabel(job: OpsJob): string {
  if (job.status === 'running') return '运行中';
  if (job.status === 'done') return '完成';
  if (job.timed_out) return '超时被终止';
  return `失败（exit ${job.exit_code ?? '?'}）`;
}

/** Ops panel (F7): trigger a fixed allowlist of maintenance actions + watch the
 * single in-flight job's live log. Every action is a server-side fixed command
 * template — the client only picks an action id (+ for embed-selected, a source
 * and a subset of the live chunkless list). Actions are single-flight, so while
 * one runs every trigger is disabled. */
export function Ops() {
  const { authFetch, refreshKey, notifyLoaded, source, sourceIds } = useDashboard();

  const [actions, setActions] = useState<OpsAction[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<OpsJob[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsJobDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<OpsAction | null>(null);
  const [starting, setStarting] = useState(false);

  // embed-selected panel
  const initialEmbedSource = source !== ALL_SOURCES ? source : (sourceIds[0] ?? 'default');
  const [embedSource, setEmbedSource] = useState<string>(initialEmbedSource);
  const [chunkless, setChunkless] = useState<ChunklessPageRow[] | null>(null);
  const [chunklessError, setChunklessError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embedConfirm, setEmbedConfirm] = useState(false);

  const busy = runningId !== null || starting;

  const refreshJobs = useCallback(async () => {
    try {
      const r = await authFetch<OpsJobsResponse>('/ops/jobs');
      setJobs(r.jobs);
    } catch {
      /* keep prior list */
    }
  }, [authFetch]);

  // Load the action catalog + job history. `running` in the catalog seeds the
  // live view after a page reload while a job is mid-flight.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    authFetch<OpsActionsResponse>('/ops/actions')
      .then(res => {
        if (cancelled) return;
        setActions(res.actions);
        notifyLoaded();
        if (res.running) {
          setRunningId(res.running.id);
          setSelectedJobId(res.running.id);
        }
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    void refreshJobs();
    return () => {
      cancelled = true;
    };
  }, [authFetch, refreshKey, notifyLoaded, refreshJobs]);

  // Poll the selected job's log while it runs; a recursive timeout stops itself
  // once the job leaves the running state (no wasted polling of a finished job).
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedJobId;
  useEffect(() => {
    if (!selectedJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = await authFetch<OpsJobDetail>(`/ops/jobs/${selectedJobId}`);
        if (cancelled) return;
        setDetail(d);
        if (d.job.status === 'running') {
          timer = setTimeout(tick, 1500);
        } else {
          setRunningId(cur => (cur === selectedJobId ? null : cur));
          void refreshJobs();
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]);

  const run = useCallback(
    async (action: OpsAction, extra?: Record<string, unknown>) => {
      setActionError(null);
      setStarting(true);
      try {
        const res = await authFetch<OpsRunResponse>('/ops/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action.id, ...extra }),
        });
        setRunningId(res.job.id);
        setSelectedJobId(res.job.id);
        setDetail({ job: res.job, log: '' });
        void refreshJobs();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    },
    [authFetch, refreshJobs],
  );

  const onTrigger = (action: OpsAction) => {
    if (action.confirm) setConfirming(action);
    else void run(action);
  };

  // Tracks the live embed source so an in-flight chunkless fetch started under
  // source A can be discarded if the user switches to B before it resolves
  // (codex MEDIUM: a stale fetch could repopulate the wrong source's list).
  const embedSourceRef = useRef(embedSource);
  embedSourceRef.current = embedSource;

  // Load the chunkless list for the embed panel's chosen source.
  const loadChunkless = useCallback(async () => {
    const src = embedSource;
    setChunklessError(null);
    setChunkless(null);
    setSelected(new Set());
    try {
      const r = await authFetch<HealthResponse>(`/health?source=${encodeURIComponent(src)}`);
      if (embedSourceRef.current !== src) return; // source changed mid-fetch — drop stale result
      setChunkless(r.chunkless);
    } catch (err) {
      if (embedSourceRef.current !== src) return;
      setChunklessError(err instanceof Error ? err.message : String(err));
    }
  }, [authFetch, embedSource]);

  // Clear the loaded list + selection whenever the embed source changes, so a
  // selection made under source A can never be submitted after switching to B
  // (codex MEDIUM). Runs on mount too (already empty → no-op).
  useEffect(() => {
    setChunkless(null);
    setChunklessError(null);
    setSelected(new Set());
  }, [embedSource]);

  const toggleSlug = (slug: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < EMBED_MAX) next.add(slug);
      return next;
    });
  };

  const embedAction = actions?.find(a => a.id === 'embed-selected') ?? null;
  const cardActions = actions?.filter(a => !a.needs_params) ?? [];

  if (loadError) {
    return (
      <Alert variant="destructive" className="state-enter">
        <AlertTitle>操作面板加载失败</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {busy && (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          有任务正在运行——运维动作单飞，结束前其余触发已禁用。
        </p>
      )}
      {actionError && (
        <Alert variant="destructive" className="state-enter">
          <AlertTitle>无法启动</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Parameterless action cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {actions === null
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
          : cardActions.map(action => (
              <Card key={action.id} className="gap-3 py-4">
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{action.label}</span>
                    <DangerBadge danger={action.danger} />
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{action.desc}</p>
                  <Button
                    variant={action.danger === 'spend' ? 'outline' : 'default'}
                    size="sm"
                    disabled={busy}
                    onClick={() => onTrigger(action)}
                    className="w-full"
                  >
                    <PlayIcon />
                    运行
                  </Button>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* embed-selected panel */}
      {embedAction && (
        <Card className="gap-4 py-4">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{embedAction.label}</span>
                <DangerBadge danger={embedAction.danger} />
              </div>
              <span className="text-xs text-muted-foreground">
                已选 {selected.size} / 上限 {EMBED_MAX}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{embedAction.desc}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={embedSource} onValueChange={setEmbedSource}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceIds.map(id => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => void loadChunkless()} disabled={busy}>
                载入该源 chunkless 页
              </Button>
              <Button
                size="sm"
                disabled={busy || selected.size === 0}
                onClick={() => setEmbedConfirm(true)}
              >
                <PlayIcon />
                embed 选中（{selected.size}）
              </Button>
            </div>

            {chunklessError && (
              <Alert variant="destructive" className="state-enter">
                <AlertTitle>加载失败</AlertTitle>
                <AlertDescription>{chunklessError}</AlertDescription>
              </Alert>
            )}
            {chunkless !== null &&
              (chunkless.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">该源当前没有 chunkless 页。</p>
              ) : (
                <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {chunkless.map(row => {
                    const checked = selected.has(row.slug);
                    const atCap = !checked && selected.size >= EMBED_MAX;
                    return (
                      <li key={`${row.source_id}:${row.slug}`}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-left hover-row ${
                            atCap ? 'cursor-not-allowed opacity-40' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={atCap}
                            onChange={() => toggleSlug(row.slug)}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="mono truncate text-xs text-muted-foreground">{row.slug}</span>
                            <span className="truncate text-sm">{row.title || '（无标题）'}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Live job view + recent history */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="gap-3 py-4">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">任务日志</span>
              {detail && (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {detail.job.status === 'running' && <Loader2Icon className="size-3 animate-spin" />}
                  {detail.job.action} · {statusLabel(detail.job)}
                </span>
              )}
            </div>
            {detail ? (
              <pre className="mono max-h-96 overflow-auto rounded-md border border-border bg-input/30 p-3 text-xs whitespace-pre-wrap break-all">
                {detail.log || '（暂无输出）'}
              </pre>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                选择一个动作运行，或从右侧历史里查看日志。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-3 py-4">
          <CardContent className="flex flex-col gap-2">
            <span className="text-sm font-medium">最近任务</span>
            {jobs.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无历史。</p>
            ) : (
              <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
                {jobs.map(job => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      aria-current={selectedJobId === job.id}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left hover-row ${
                        selectedJobId === job.id ? 'bg-muted' : ''
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{job.action}</span>
                        <span
                          className={`text-xs ${
                            job.status === 'error'
                              ? 'text-destructive'
                              : job.status === 'running'
                                ? 'text-warning'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {statusLabel(job)}
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatTimestampPT(job.started_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirm dialog for a parameterless write/spend action */}
      <AlertDialog open={confirming !== null} onOpenChange={o => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-4 text-warning" />
              确认运行「{confirming?.label}」？
            </AlertDialogTitle>
            <AlertDialogDescription>{confirming?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const a = confirming;
                setConfirming(null);
                if (a) void run(a);
              }}
            >
              确认运行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm dialog for embed-selected (spends money) */}
      <AlertDialog open={embedConfirm} onOpenChange={o => !o && setEmbedConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-4 text-warning" />
              对 {selected.size} 页做 embed？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将对 source「{embedSource}」下选中的 {selected.size} 个 chunkless 页调用
              OpenAI embedding（真实花费，服务端会再次校验它们确为当前 chunkless）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setEmbedConfirm(false);
                if (embedAction) void run(embedAction, { source: embedSource, slugs: [...selected] });
              }}
            >
              确认 embed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
