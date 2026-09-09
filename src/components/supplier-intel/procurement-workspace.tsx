"use client";

/**
 * S3-A 国内采购工作台（单一入口：/projects/intelligence/supply-chain?projectId=…）。
 *
 * 可靠性纪律（任务书 §6）：
 *   - 页面加载、刷新、轮询、切换筛选**永不**创建 Run；只有点击「开始找供应商」才写；
 *   - GET 不触发搜索、解析写入或供应商建档；
 *   - 重复点击由服务端执行声明拦截（409 RUN_EXECUTION_IN_PROGRESS），前端 disabled 只是体验；
 *   - 请求结果未知时先重新读取服务器状态，不自动重发有副作用的 POST；
 *   - 轮询只读状态，Run 进终态即停；浏览器断开不代表服务器已取消。
 *   - 组织/项目切换时放弃在途请求并清空数据，防止旧响应覆盖新页面。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { runStatusDisplay } from "@/lib/supplier-intel/workspace-labels";
import { RequirementsPanel } from "./requirements-panel";
import { RunsPanel } from "./runs-panel";
import { SignalsPanel } from "./signals-panel";
import {
  WorkspaceApiError,
  workspaceFetch,
  type ProcurementViewPayload,
  type SearchRunRow,
} from "./types";

type TabKey = "requirements" | "signals" | "runs";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "requirements", label: "采购要求" },
  { key: "signals", label: "供应商线索" },
  { key: "runs", label: "搜索记录" },
];

const ACTIVE_POLL_MS = 4000;

export function ProcurementWorkspace({ projectId }: { projectId: string | null }) {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [tab, setTab] = useState<TabKey>("requirements");

  const [view, setView] = useState<ProcurementViewPayload | null>(null);
  const [runs, setRuns] = useState<SearchRunRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<{ kind: "notEnabled" | "forbidden" | "error"; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [runFilterId, setRunFilterId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // 服务端裁决的有效写权限；前端隐藏按钮只是体验，每个写操作仍在服务端独立鉴权
  const canWrite = view?.canWrite === true;
  const activeRun = useMemo(
    () => runs?.find((r) => r.status === "PLANNED" || r.status === "RUNNING") ?? null,
    [runs],
  );

  /** 只读加载：采购视图 + 搜索记录。绝不产生任何写副作用。 */
  const loadAll = useCallback(async () => {
    if (!orgId || !projectId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setFatal(null);
    try {
      const [v, r] = await Promise.all([
        workspaceFetch<{ view: ProcurementViewPayload }>(
          `/api/supplier-intel/projects/${projectId}/procurement-view?orgId=${encodeURIComponent(orgId)}`,
          { signal: ctrl.signal },
        ),
        workspaceFetch<{ runs: SearchRunRow[] }>(
          `/api/supplier-intel/runs?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`,
          { signal: ctrl.signal },
        ),
      ]);
      if (ctrl.signal.aborted) return;
      setView(v.view);
      setRuns(r.runs);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setView(null);
      setRuns(null);
      if (e instanceof WorkspaceApiError && e.notEnabled) {
        setFatal({ kind: "notEnabled", text: "本组织尚未启用「供应商情报」功能。" });
      } else if (e instanceof WorkspaceApiError && e.forbidden) {
        setFatal({ kind: "forbidden", text: "你没有该项目的访问权限。" });
      } else {
        setFatal({ kind: "error", text: e instanceof Error ? e.message : "加载失败" });
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [orgId, projectId]);

  // 组织/项目变化：先清空再加载，旧响应会被 abort，不会串页
  useEffect(() => {
    setView(null);
    setRuns(null);
    setRunFilterId(null);
    setStartMsg(null);
    if (!orgLoading && orgId && projectId) void loadAll();
    return () => abortRef.current?.abort();
  }, [orgLoading, orgId, projectId, loadAll]);

  /** 轮询：只读；只在有未终态 Run 时开启，终态即停 */
  useEffect(() => {
    if (!activeRun || !orgId || !projectId) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const r = await workspaceFetch<{ runs: SearchRunRow[] }>(
            `/api/supplier-intel/runs?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`,
          );
          setRuns(r.runs);
        } catch {
          /* 轮询失败静默重试；不改变业务状态 */
        }
      })();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [activeRun, orgId, projectId]);

  /** 「开始找供应商」：唯一的写入口。创建 Run（服务端读 canonical 需求）→ 执行发现。 */
  const startSearch = useCallback(async () => {
    if (!orgId || !projectId || starting) return;
    setStarting(true);
    setStartMsg(null);
    let runId: string | null = null;
    try {
      const created = await workspaceFetch<{ run: SearchRunRow }>(
        `/api/supplier-intel/runs?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // 客户端只提交项目指针；requirements / 评分 / 完整性声明一律由服务端决定
          body: JSON.stringify({ projectId }),
        },
      );
      runId = created.run.id;
      await workspaceFetch(
        `/api/supplier-intel/runs/${runId}/discover?orgId=${encodeURIComponent(orgId)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      setStartMsg({ tone: "ok", text: "搜索已结束，结果见下方「供应商线索」与「搜索记录」。" });
      setTab("signals");
    } catch (e) {
      if (e instanceof WorkspaceApiError && e.code === "RUN_EXECUTION_IN_PROGRESS") {
        setStartMsg({ tone: "warn", text: "该搜索正在执行中，请等待本轮结束后再试。" });
      } else if (e instanceof WorkspaceApiError && e.code === "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE") {
        setStartMsg({
          tone: "err",
          text: "招标要求来源无法证明完整，已阻止开搜。请先到该项目的「招标要求」页复核需求。",
        });
      } else if (e instanceof WorkspaceApiError && e.code === "CANONICAL_REQUIREMENTS_UNAVAILABLE") {
        setStartMsg({ tone: "err", text: "该项目还没有可用的招标分析，无法按需求搜索。" });
      } else {
        // 结果未知时不自动重发有副作用的 POST：只重新读取服务器状态
        setStartMsg({
          tone: "err",
          text: `${e instanceof Error ? e.message : "启动失败"}${runId ? "（已创建搜索记录，请在「搜索记录」中查看实际状态）" : ""}`,
        });
      }
    } finally {
      setStarting(false);
      await loadAll();
    }
  }, [orgId, projectId, starting, loadAll]);

  /* ───────── 渲染 ───────── */

  if (orgLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> 加载中
      </div>
    );
  }
  if (ambiguous || !orgId) {
    return (
      <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--warning)]">
        当前账号属于多个组织，请先在左上角选择组织。
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm space-y-2">
        <p className="font-medium">请从具体的招标项目进入</p>
        <p className="text-[var(--muted)]">
          采购工作台需要项目上下文（要买什么、有哪些要求）。请打开对应的招标项目，
          在「标书与报价」里点击「国内采购 / 找供应商」。
        </p>
        <Link href="/projects" className="inline-block text-[var(--accent)] underline">
          去项目列表
        </Link>
      </div>
    );
  }
  if (fatal) {
    return (
      <div
        className={`rounded-xl border p-6 text-sm ${
          fatal.kind === "error"
            ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]"
            : "border-[var(--border)] bg-[var(--card-bg)]"
        }`}
      >
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle size={16} /> {fatal.text}
        </p>
        {fatal.kind === "notEnabled" ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            该功能按组织灰度开启。需要试用请联系管理员。
          </p>
        ) : null}
      </div>
    );
  }
  if (loading && !view) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> 加载中
      </div>
    );
  }
  if (!view) return null;

  const canStart = view.canonical.state === "OK" && view.canWrite;

  return (
    <div className="space-y-4">
      {/* 顶部：项目 / 分析版本 / 主动作 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={view.project.name}>
              {view.project.name}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {view.project.clientOrganization ?? "采购单位未提取"}
              {view.project.location ? ` · ${view.project.location}` : ""}
              {view.analysis
                ? ` · 分析版本 ${new Date(view.analysis.createdAt).toLocaleDateString("zh-CN")}（${view.analysis.status}）`
                : " · 暂无可用分析"}
            </p>
          </div>
          <button
            type="button"
            disabled={!canStart || starting || Boolean(activeRun)}
            onClick={() => void startSearch()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm text-[color:var(--on-accent)] disabled:opacity-50"
            title={
              !canStart
                ? "招标要求来源不完整，无法开始搜索"
                : activeRun
                  ? "已有一次搜索正在进行"
                  : undefined
            }
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {starting ? "正在搜索…" : activeRun ? "搜索进行中" : "开始找供应商"}
          </button>
        </div>

        {activeRun ? (
          <p className="mt-2 rounded-lg bg-[var(--info-bg)] px-2 py-1.5 text-xs text-[var(--info)]">
            当前有一次搜索处于「{runStatusDisplay(activeRun.status).label}」。页面会自动刷新状态；
            关闭页面不会取消服务器上的搜索。
          </p>
        ) : null}

        {startMsg ? (
          <p
            className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${
              startMsg.tone === "ok"
                ? "bg-[var(--success-bg)] text-[var(--success)]"
                : startMsg.tone === "warn"
                  ? "bg-[var(--warning-bg)] text-[var(--warning)]"
                  : "bg-[var(--danger-bg)] text-[var(--danger)]"
            }`}
            role="status"
          >
            {startMsg.text}
          </p>
        ) : null}
      </div>

      {/* 页签 */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="采购工作台">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              tab === t.key
                ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]"
                : "border-[var(--border)] hover:bg-[var(--background)]"
            }`}
          >
            {t.label}
            {t.key === "runs" && runs ? ` (${runs.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "requirements" ? <RequirementsPanel view={view} /> : null}
      {tab === "signals" ? (
        <SignalsPanel
          orgId={orgId}
          projectId={projectId}
          runFilterId={runFilterId}
          canWrite={canWrite}
          onClearRunFilter={() => setRunFilterId(null)}
        />
      ) : null}
      {tab === "runs" ? (
        <RunsPanel
          runs={runs ?? []}
          currentAnalysisRunId={view.analysis?.runId ?? null}
          selectedRunId={runFilterId}
          onSelectRun={(id) => {
            setRunFilterId(id);
            setTab("signals");
          }}
        />
      ) : null}
    </div>
  );
}
