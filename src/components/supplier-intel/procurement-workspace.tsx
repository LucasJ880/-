"use client";

/**
 * S3-A 国内采购工作台（单一入口：/projects/intelligence/supply-chain?projectId=…）。
 *
 * 可靠性纪律（任务书 §6 / FR1 / FR2）：
 *   - 页面加载、刷新、轮询、切换筛选**永不**创建 Run；只有点击「开始找供应商」才写；
 *   - GET 不触发搜索、解析写入或供应商建档；
 *   - 重复点击由服务端执行声明拦截（409），前端 disabled 只是体验；
 *   - 请求结果未知时先重新读取服务器状态，不自动重发有副作用的 POST；
 *   - 轮询只读状态，Run 进终态即停；浏览器断开不代表服务器已取消；
 *   - 一次执行没有正常收尾时，界面明说「结果未知」，只给「取消后新建」这一条出路
 *     （FR1-C：自动接管无法证明旧执行已经停手）；
 *   - 所有在途响应都按作用域（org+project）校验，切走后回来的旧响应一律丢弃（FR2）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2, Search } from "lucide-react";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { classifyRunExecutionState } from "@/lib/supplier-intel/run-execution-state";
import { runStatusDisplay } from "@/lib/supplier-intel/workspace-labels";
import { RequirementsPanel } from "./requirements-panel";
import { RunsPanel } from "./runs-panel";
import { ScopeGuard } from "./scope-guard";
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [startMsg, setStartMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [runFilterId, setRunFilterId] = useState<string | null>(null);

  // FR2-A：作用域 = org + project。值比较而非计数器，StrictMode 下不会错位。
  const scopeKey = orgId && projectId ? `${orgId}::${projectId}` : null;
  const guardRef = useRef<ScopeGuard | null>(null);
  if (guardRef.current === null) guardRef.current = new ScopeGuard();
  const guard = guardRef.current;
  guard.setScope(scopeKey); // 渲染期同步生效：切走的瞬间旧请求即失去归属

  // 服务端裁决的有效写权限；前端隐藏按钮只是体验，每个写操作仍在服务端独立鉴权
  const canWrite = view?.canWrite === true;
  const activeRun = useMemo(
    () => runs?.find((r) => r.status === "PLANNED" || r.status === "RUNNING") ?? null,
    [runs],
  );
  // FR1-F：执行态由声明决定，不是由 Run.status 决定。RUNNING 且声明已过期
  // = 上一次执行没有收尾，结果未知——这时给的出路是「取消后新建」，不是「再点一次」。
  const execState = useMemo(
    () => (activeRun ? classifyRunExecutionState(activeRun, new Date()) : null),
    [activeRun],
  );

  /** 只读加载：采购视图 + 搜索记录。绝不产生任何写副作用。 */
  const loadAll = useCallback(async () => {
    if (!orgId || !projectId) return;
    const ticket = guard.begin("loadAll");
    setLoading(true);
    setFatal(null);
    try {
      const [v, r] = await Promise.all([
        workspaceFetch<{ view: ProcurementViewPayload }>(
          `/api/supplier-intel/projects/${projectId}/procurement-view?orgId=${encodeURIComponent(orgId)}`,
          { signal: ticket.signal },
        ),
        workspaceFetch<{ runs: SearchRunRow[] }>(
          `/api/supplier-intel/runs?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`,
          { signal: ticket.signal },
        ),
      ]);
      if (!ticket.isCurrent()) return; // 切项目/切组织后回来的旧响应：丢弃
      setView(v.view);
      setRuns(r.runs);
    } catch (e) {
      if (!ticket.isCurrent()) return;
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
      if (ticket.shouldSettle()) setLoading(false);
      ticket.done();
    }
  }, [orgId, projectId, guard]);

  // 组织/项目变化：先清空再加载。旧作用域的在途请求已被 setScope 放弃。
  useEffect(() => {
    setView(null);
    setRuns(null);
    setRunFilterId(null);
    setStartMsg(null);
    setBusyAction(null);
    if (!orgLoading && orgId && projectId) void loadAll();
  }, [orgLoading, orgId, projectId, loadAll]);

  // 组件卸载时放弃全部在途请求
  useEffect(() => () => guard.abortAll(), [guard]);

  /** 轮询：只读；只在有未终态 Run 时开启，终态即停。FR2-B：带作用域校验 + 可中止。 */
  useEffect(() => {
    if (!activeRun || !orgId || !projectId) return;
    const timer = setInterval(() => {
      void (async () => {
        const ticket = guard.begin("poll");
        try {
          const r = await workspaceFetch<{ runs: SearchRunRow[] }>(
            `/api/supplier-intel/runs?orgId=${encodeURIComponent(orgId)}&projectId=${encodeURIComponent(projectId)}`,
            { signal: ticket.signal },
          );
          if (!ticket.isCurrent()) return; // 切到别的项目后到达的轮询响应：不得写回
          setRuns(r.runs);
        } catch {
          /* 轮询失败静默重试；不改变业务状态 */
        } finally {
          ticket.done();
        }
      })();
    }, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [activeRun, orgId, projectId, guard]);

  // FR3-F：去「招标要求」复核后回到本页，必须重新读 canonical 视图
  // （分析可能已被重跑/复核过；bfcache 或路由缓存会让页面停在旧数据上）
  useEffect(() => {
    if (!orgId || !projectId) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, [orgId, projectId, loadAll]);

  /** 把一次执行请求的失败翻译成采购人员能据以行动的话 */
  const explainStartError = useCallback((e: unknown, createdRunId: string | null) => {
    if (e instanceof WorkspaceApiError && e.code === "RUN_EXECUTION_IN_PROGRESS") {
      return { tone: "warn" as const, text: "该搜索正在执行中，请等待本轮结束后再试。" };
    }
    if (e instanceof WorkspaceApiError && e.code === "RUN_EXECUTION_RECOVERY_REQUIRED") {
      return {
        tone: "err" as const,
        text: "上一次执行没有正常结束，这次搜索的结果无法确认。请在「搜索记录」里取消它，再重新发起一次搜索。",
      };
    }
    if (e instanceof WorkspaceApiError && e.code === "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE") {
      return {
        tone: "err" as const,
        text: "招标要求来源无法证明完整，已阻止开搜。请先到该项目的「招标要求」页复核需求。",
      };
    }
    if (e instanceof WorkspaceApiError && e.code === "CANONICAL_REQUIREMENTS_UNAVAILABLE") {
      return { tone: "err" as const, text: "该项目还没有可用的招标分析，无法按需求搜索。" };
    }
    // 结果未知时不自动重发有副作用的 POST：只重新读取服务器状态
    return {
      tone: "err" as const,
      text: `${e instanceof Error ? e.message : "启动失败"}${
        createdRunId ? "（已创建搜索记录，请在「搜索记录」中查看实际状态）" : ""
      }`,
    };
  }, []);

  /** 「开始找供应商」：唯一的写入口。创建 Run（服务端读 canonical 需求）→ 执行发现。 */
  const startSearch = useCallback(async () => {
    if (!orgId || !projectId || busyAction) return;
    const ticket = guard.begin("write");
    setBusyAction("start");
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
      // 执行策略由服务端固定（FR1-E）：这里只表达「执行这个 Run」
      await workspaceFetch(
        `/api/supplier-intel/runs/${runId}/discover?orgId=${encodeURIComponent(orgId)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      if (!ticket.isSameScope()) return;
      setStartMsg({ tone: "ok", text: "搜索已结束，结果见下方「供应商线索」与「搜索记录」。" });
      setTab("signals");
    } catch (e) {
      if (!ticket.isSameScope()) return;
      setStartMsg(explainStartError(e, runId));
    } finally {
      // FR2-E：只有仍是最新一轮写操作时才清忙碌态，不能把后来者的忙碌态清掉
      if (ticket.shouldSettle()) setBusyAction(null);
      ticket.done();
      if (ticket.isSameScope()) await loadAll();
    }
  }, [orgId, projectId, busyAction, loadAll, guard, explainStartError]);

  /** FR1-F：继续执行一个还没跑过的 Run（浏览器断开/请求失败留下的 PLANNED） */
  const resumeRun = useCallback(
    async (id: string) => {
      if (!orgId || busyAction) return;
      const ticket = guard.begin("write");
      setBusyAction(`resume:${id}`);
      setStartMsg(null);
      try {
        await workspaceFetch(
          `/api/supplier-intel/runs/${id}/discover?orgId=${encodeURIComponent(orgId)}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        );
        if (!ticket.isSameScope()) return;
        setStartMsg({ tone: "ok", text: "搜索已结束，结果见「供应商线索」与「搜索记录」。" });
      } catch (e) {
        if (!ticket.isSameScope()) return;
        setStartMsg(explainStartError(e, id));
      } finally {
        if (ticket.shouldSettle()) setBusyAction(null);
        ticket.done();
        if (ticket.isSameScope()) await loadAll();
      }
    },
    [orgId, busyAction, loadAll, guard, explainStartError],
  );

  /** FR1-F：取消一次卡住/结果未知的搜索。终态不重入——之后只能新建。 */
  const cancelRun = useCallback(
    async (id: string) => {
      if (!orgId || busyAction) return;
      const ticket = guard.begin("write");
      setBusyAction(`cancel:${id}`);
      setStartMsg(null);
      try {
        await workspaceFetch(`/api/supplier-intel/runs/${id}?orgId=${encodeURIComponent(orgId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        if (!ticket.isSameScope()) return;
        setStartMsg({
          tone: "warn",
          text: "已取消这次搜索。它的结果不再更新；需要重搜请点「开始找供应商」新建一次。",
        });
      } catch (e) {
        if (!ticket.isSameScope()) return;
        setStartMsg({ tone: "err", text: e instanceof Error ? e.message : "取消失败" });
      } finally {
        if (ticket.shouldSettle()) setBusyAction(null);
        ticket.done();
        if (ticket.isSameScope()) await loadAll();
      }
    },
    [orgId, busyAction, loadAll, guard],
  );

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

  const starting = busyAction === "start";
  const blockedByActive = Boolean(activeRun);
  const canStart = view.canonical.state === "OK" && view.canWrite && !blockedByActive;
  const requirementsHref = `/projects/${encodeURIComponent(projectId)}?tab=requirements&from=supply-chain`;

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
            disabled={!canStart || busyAction !== null}
            onClick={() => void startSearch()}
            data-testid="start-search"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm text-[color:var(--on-accent)] disabled:opacity-50"
            title={
              blockedByActive
                ? "已有一次搜索没有收尾，请先处理它"
                : view.canonical.state !== "OK"
                  ? "招标要求来源不完整，无法开始搜索"
                  : undefined
            }
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {starting ? "正在搜索…" : blockedByActive ? "搜索未收尾" : "开始找供应商"}
          </button>
        </div>

        {/* FR3-F：真实可点的复核入口（不是一句「请到某某页」） */}
        <p className="mt-2 text-xs text-[var(--muted)]">
          要求看不懂或译文有疑问？
          <Link
            href={requirementsHref}
            data-testid="goto-requirements"
            className="ml-1 inline-flex items-center gap-1 text-[var(--accent)] underline"
          >
            去「招标要求」页复核原文与译文
            <ExternalLink size={11} />
          </Link>
          <span className="ml-1">复核后回到本页会自动重新读取。</span>
        </p>

        {activeRun ? (
          <RunRecoveryBanner
            run={activeRun}
            state={execState}
            canWrite={canWrite}
            busyAction={busyAction}
            onResume={() => void resumeRun(activeRun.id)}
            onCancel={() => void cancelRun(activeRun.id)}
            onRefresh={() => void loadAll()}
          />
        ) : null}

        {startMsg ? (
          <p
            data-testid="start-message"
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
          orgId={orgId}
          runs={runs ?? []}
          currentAnalysisRunId={view.analysis?.runId ?? null}
          selectedRunId={runFilterId}
          canWrite={canWrite}
          busyAction={busyAction}
          onSelectRun={(id) => {
            setRunFilterId(id);
            setTab("signals");
          }}
          onResumeRun={(id) => void resumeRun(id)}
          onCancelRun={(id) => void cancelRun(id)}
        />
      ) : null}
    </div>
  );
}

/**
 * FR1-F：未收尾的搜索给采购人员一个明确出路。
 * 三态分开说，不糊成一句「搜索进行中」——「正在跑」和「结果未知」对人的下一步动作完全不同。
 */
function RunRecoveryBanner({
  run,
  state,
  canWrite,
  busyAction,
  onResume,
  onCancel,
  onRefresh,
}: {
  run: SearchRunRow;
  state: string | null;
  canWrite: boolean;
  busyAction: string | null;
  onResume: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const label = runStatusDisplay(run.status).label;
  const recovery = state === "RECOVERY_REQUIRED";
  const idlePlanned = state === "IDLE" && run.status === "PLANNED";

  return (
    <div
      data-testid="run-recovery"
      data-exec-state={state ?? ""}
      className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${
        recovery
          ? "bg-[var(--warning-bg)] text-[var(--warning)]"
          : "bg-[var(--info-bg)] text-[var(--info)]"
      }`}
    >
      {recovery ? (
        <p>
          上一次执行没有正常结束，这次搜索（{label}）的结果无法确认。
          请取消它再重新发起一次搜索；系统不会自动重跑，以免同一次搜索被执行两遍。
        </p>
      ) : idlePlanned ? (
        <p>这次搜索已创建但还没有执行（可能是网络中断或页面被关闭）。可以继续执行，也可以取消。</p>
      ) : (
        <p>
          当前有一次搜索处于「{label}」。页面会自动刷新状态；关闭页面不会取消服务器上的搜索。
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRefresh}
          data-testid="run-refresh"
          className="rounded-full border border-current px-2 py-0.5"
        >
          查看最新状态
        </button>
        {canWrite && idlePlanned ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={onResume}
            data-testid="run-resume"
            className="rounded-full border border-current px-2 py-0.5 disabled:opacity-50"
          >
            {busyAction === `resume:${run.id}` ? "执行中…" : "继续执行"}
          </button>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={onCancel}
            data-testid="run-cancel"
            className="rounded-full border border-current px-2 py-0.5 disabled:opacity-50"
          >
            {busyAction === `cancel:${run.id}` ? "取消中…" : "取消这次搜索"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
