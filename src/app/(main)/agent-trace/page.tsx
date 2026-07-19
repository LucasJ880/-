"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiJson } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

type SessionRow = {
  id: string;
  channel: string;
  channelUserId: string | null;
  summaryPreview: string | null;
  lastActiveAt: string;
  latestRun: {
    id: string;
    status: string;
    intent: string | null;
    runType: string;
    latencyMs: number | null;
    createdAt: string;
    errorCode: string | null;
  } | null;
};

type RunRow = {
  id: string;
  status: string;
  intent: string | null;
  runType: string;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
};

type RunDetail = {
  run: RunRow & {
    model: string | null;
    errorMessage: string | null;
    attempts: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  session: {
    id: string;
    channel: string;
    channelUserId: string | null;
    summaryPreview: string | null;
  };
  events: Array<{
    id: string;
    sequence: number;
    eventType: string;
    title: string | null;
    visibleToUser: boolean;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }>;
  pendingActions: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    createdAt: string;
  }>;
};

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-zinc-500/15 text-zinc-400",
  acknowledged: "bg-sky-500/15 text-sky-400",
  planning: "bg-indigo-500/15 text-indigo-400",
  running: "bg-amber-500/15 text-amber-400",
  awaiting_approval: "bg-orange-500/15 text-orange-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-muted/40 text-muted",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgentTracePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [scope, setScope] = useState<string>("self");
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!orgId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiJson<{
        sessions?: SessionRow[];
        scope?: string;
      }>(`/api/agent/trace?limit=30`);
      setSessions(data.sessions ?? []);
      setScope(data.scope ?? "self");
    } catch {
      setSessions([]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (!orgLoading) void loadSessions();
  }, [orgLoading, loadSessions]);

  const openSession = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedRunId(null);
    setDetail(null);
    setRunsLoading(true);
    try {
      const data = await apiJson<{ runs?: RunRow[] }>(
        `/api/agent/trace/sessions/${sessionId}/runs`,
      );
      setRuns(data.runs ?? []);
    } catch {
      setRuns([]);
    }
    setRunsLoading(false);
  };

  const openRun = async (runId: string) => {
    setSelectedRunId(runId);
    setDetailLoading(true);
    try {
      const data = await apiJson<RunDetail>(`/api/agent/trace/runs/${runId}`);
      setDetail(data);
    } catch {
      setDetail(null);
    }
    setDetailLoading(false);
  };

  if (ambiguous) {
    return (
      <div className="p-6">
        <PageHeader
          title="Agent Trace"
          description="请先在左上角选择组织，再查看 AI 任务轨迹。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <PageHeader
        title="Agent Trace"
        description="只读查看微信/企微 Agent 会话、任务状态与真实执行事件。不展示密钥与完整敏感正文。"
        actions={
          <button
            type="button"
            onClick={() => void loadSessions()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/30"
          >
            <RefreshCw size={13} />
            刷新
          </button>
        }
      />

      <p className="text-[12px] text-muted">
        范围：{scope === "org" ? "本组织全部会话" : "仅我的会话"}
      </p>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
        {/* Sessions */}
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
            会话 Session
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading || orgLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> 加载中
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-6 text-sm text-muted">暂无会话记录</div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void openSession(s.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/20",
                    selectedSessionId === s.id && "bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {s.channel} · {s.channelUserId || "—"}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {fmtTime(s.lastActiveAt)}
                    </span>
                  </div>
                  {s.latestRun ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          STATUS_COLOR[s.latestRun.status] || STATUS_COLOR.queued,
                        )}
                      >
                        {s.latestRun.status}
                      </span>
                      <span className="truncate text-[11px] text-muted">
                        {s.latestRun.intent || s.latestRun.runType}
                      </span>
                    </div>
                  ) : null}
                  {s.summaryPreview ? (
                    <p className="line-clamp-2 text-[11px] text-muted/80">
                      {s.summaryPreview}
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </section>

        {/* Runs */}
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
            任务 Run
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!selectedSessionId ? (
              <div className="p-6 text-sm text-muted">选择左侧会话</div>
            ) : runsLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> 加载中
              </div>
            ) : runs.length === 0 ? (
              <div className="p-6 text-sm text-muted">该会话暂无任务</div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void openRun(r.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/20",
                    selectedRunId === r.id && "bg-muted/30",
                  )}
                >
                  <CircleDot size={12} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          STATUS_COLOR[r.status] || STATUS_COLOR.queued,
                        )}
                      >
                        {r.status}
                      </span>
                      <span className="truncate text-[11px]">
                        {r.intent || r.runType}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted">
                      {fmtTime(r.createdAt)}
                      {r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}
                      {r.errorCode ? ` · ${r.errorCode}` : ""}
                    </div>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-muted" />
                </button>
              ))
            )}
          </div>
        </section>

        {/* Detail */}
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted">
            <Activity size={13} />
            事件时间线
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!selectedRunId ? (
              <div className="text-sm text-muted">选择中间任务查看事件</div>
            ) : detailLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> 加载中
              </div>
            ) : !detail ? (
              <div className="text-sm text-muted">加载失败</div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1 text-[12px]">
                  <div>
                    <span className="text-muted">Run </span>
                    <code className="text-[11px]">{detail.run.id.slice(0, 12)}…</code>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        STATUS_COLOR[detail.run.status],
                      )}
                    >
                      {detail.run.status}
                    </span>
                    {detail.run.model ? (
                      <span className="text-muted">model: {detail.run.model}</span>
                    ) : null}
                    {detail.run.attempts > 0 ? (
                      <span className="text-muted">
                        attempts: {detail.run.attempts}
                      </span>
                    ) : null}
                  </div>
                  {detail.run.errorMessage ? (
                    <p className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
                      {detail.run.errorMessage}
                    </p>
                  ) : null}
                  {detail.session.summaryPreview ? (
                    <p className="rounded bg-muted/20 px-2 py-1 text-[11px] text-muted">
                      摘要：{detail.session.summaryPreview}
                    </p>
                  ) : null}
                </div>

                {detail.pendingActions.length > 0 ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-muted">
                      关联待确认
                    </div>
                    <ul className="space-y-1">
                      {detail.pendingActions.map((p) => (
                        <li
                          key={p.id}
                          className="rounded border border-border/60 px-2 py-1 text-[11px]"
                        >
                          <span className="text-muted">{p.status}</span> · {p.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <div className="mb-2 text-[11px] font-medium text-muted">
                    Events（{detail.events.length}）
                  </div>
                  <ol className="space-y-2 border-l border-border pl-3">
                    {detail.events.map((e) => (
                      <li key={e.id} className="relative text-[12px]">
                        <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-primary/60" />
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {e.title || e.eventType}
                          </span>
                          <span className="text-[10px] text-muted">
                            #{e.sequence}
                          </span>
                          {!e.visibleToUser ? (
                            <span className="text-[10px] text-muted">内部</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-muted">
                          {e.eventType} · {fmtTime(e.createdAt)}
                        </div>
                        {e.payload ? (
                          <pre className="mt-1 overflow-x-auto rounded bg-muted/20 p-1.5 text-[10px] text-muted">
                            {JSON.stringify(e.payload)}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
