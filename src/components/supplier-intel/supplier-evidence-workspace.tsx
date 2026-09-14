"use client";

/**
 * S3-B Slice 2：供应商证据工作台（唯一 canonical 供应商产品/资质页）。
 *
 * 回答的是六个问题：这家具体能供什么？哪个型号可能用于当前项目？厂家声称有哪些认证？
 * 哪些已经独立核验？每条依据在哪？现在还缺什么资料？
 *
 * 它**不**回答「这家合不合格」——那是 S4 的强制项判定与 supplier-score-v1 的事。
 * 这里没有分数、没有红黄绿、没有推荐。
 *
 * 四种状态严格分开：身份（已人工关联）/ 能力（有出处的声明）/ 认证（声称 vs 核验）/
 * 本标合规（本页不做）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import {
  completenessStatusDisplay,
  computeInformationCompleteness,
  originSourceLabel,
} from "@/lib/supplier-intel/evidence-display";
import { EvaluationPanel } from "./evaluation-panel";
import { CapabilitiesSection, CertificationsSection, OfferingsSection, TONE_CLASS } from "./evidence-sections";
import { ScopeGuard } from "./scope-guard";
import { WorkspaceApiError, workspaceFetch, type SupplierCapabilityPayload } from "./types";

type TabKey = "offerings" | "certifications" | "capabilities" | "gaps" | "evaluation";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "offerings", label: "可供产品" },
  { key: "certifications", label: "认证与资质" },
  { key: "capabilities", label: "能力证据" },
  { key: "gaps", label: "资料缺口" },
  // S4-A：只在有项目上下文时出现（下面按 projectContext 过滤）
  { key: "evaluation", label: "项目匹配" },
];

export function SupplierEvidenceWorkspace({
  supplierId,
  projectId,
  signalId,
  searchRunId,
  evaluationRunId = null,
}: {
  supplierId: string | null;
  projectId: string | null;
  signalId: string | null;
  searchRunId: string | null;
  /** S4-A：从搜索记录里的评估运行进入时直接打开「项目匹配」 */
  evaluationRunId?: string | null;
}) {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [tab, setTab] = useState<TabKey>(evaluationRunId ? "evaluation" : "offerings");
  const [view, setView] = useState<SupplierCapabilityPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<{ kind: "notEnabled" | "forbidden" | "notFound" | "error"; text: string } | null>(null);
  // 已经加载出页面之后再刷新失败（网络抖动 / 服务端瞬时错误）：保留页面，只在顶上提示并给重试。
  // 一次写入成功后紧接着的读回失败，不应该把用户刚填好的整页清空。
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  // 作用域 = org + supplier；切换的瞬间旧响应即失去归属（FR2 同一套纪律）
  const scopeKey = orgId && supplierId ? `${orgId}::${supplierId}` : null;
  const viewRef = useRef<SupplierCapabilityPayload | null>(null);
  viewRef.current = view;
  const guardRef = useRef<ScopeGuard | null>(null);
  if (guardRef.current === null) guardRef.current = new ScopeGuard();
  const guard = guardRef.current;
  guard.setScope(scopeKey);

  const load = useCallback(async () => {
    if (!orgId || !supplierId) return;
    const ticket = guard.begin("view");
    setLoading(true);
    try {
      const qs = new URLSearchParams({ orgId });
      if (projectId) qs.set("projectId", projectId);
      if (signalId) qs.set("signalId", signalId);
      if (searchRunId) qs.set("searchRunId", searchRunId);
      const r = await workspaceFetch<{ view: SupplierCapabilityPayload }>(
        `/api/supplier-intel/suppliers/${supplierId}/capability?${qs.toString()}`,
        { signal: ticket.signal },
      );
      if (!ticket.isCurrent()) return;
      setView(r.view);
      setFatal(null);
      setRefreshErr(null);
    } catch (e) {
      if (!ticket.isCurrent()) return;
      const terminal =
        e instanceof WorkspaceApiError && (e.notEnabled || e.forbidden || e.status === 404);
      // 权限 / 不存在 / 未启用是确定性结论，无论之前有没有页面都按 fatal 处理；
      // 其它错误在已有页面时只提示，不清空。
      if (!terminal && viewRef.current) {
        setRefreshErr(e instanceof Error ? e.message : "刷新失败");
        return;
      }
      if (e instanceof WorkspaceApiError) {
        if (e.notEnabled) setFatal({ kind: "notEnabled", text: "供应商情报功能未对本组织开启" });
        else if (e.forbidden) setFatal({ kind: "forbidden", text: "你没有查看这家供应商的权限" });
        else if (e.status === 404) setFatal({ kind: "notFound", text: "供应商不存在" });
        else setFatal({ kind: "error", text: e.message });
      } else {
        setFatal({ kind: "error", text: e instanceof Error ? e.message : "加载失败" });
      }
    } finally {
      if (ticket.shouldSettle()) setLoading(false);
      ticket.done();
    }
  }, [guard, orgId, projectId, searchRunId, signalId, supplierId]);

  useEffect(() => {
    if (!orgLoading && orgId && supplierId) void load();
  }, [orgLoading, orgId, supplierId, load]);

  const gaps = useMemo(() => (view ? computeInformationCompleteness(view) : []), [view]);

  if (orgLoading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /> 加载中</div>;
  }
  if (ambiguous || !orgId) {
    return <div className="rounded-xl border border-[var(--border)] p-6 text-sm">当前账号属于多个组织，请先在左上角选择组织。</div>;
  }
  if (!supplierId) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm space-y-2">
        <p className="font-medium">请从线索或搜索记录进入</p>
        <p className="text-[var(--muted)]">本页需要指定一家供应商。请在采购工作台里，从已关联的线索或内部候选点「查看产品与资质」进入。</p>
        <Link href="/projects" className="inline-block text-[var(--accent)] underline">去项目列表</Link>
      </div>
    );
  }
  if (fatal) {
    return (
      <div className={`rounded-xl border p-6 text-sm ${fatal.kind === "error" ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]" : "border-[var(--border)] bg-[var(--card-bg)]"}`} data-testid="workspace-fatal" data-kind={fatal.kind}>
        <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {fatal.text}</p>
        {fatal.kind === "notEnabled" ? <p className="mt-1 text-xs text-[var(--muted)]">该功能按组织灰度开启。需要试用请联系管理员。</p> : null}
      </div>
    );
  }
  if (loading && !view) {
    return <div className="flex items-center gap-2 py-10 text-sm text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /> 加载中</div>;
  }
  if (!view) return null;

  const backHref = view.projectContext
    ? `/projects/intelligence/supply-chain?projectId=${encodeURIComponent(view.projectContext.id)}`
    : "/suppliers";
  const entry = view.entryContext;

  return (
    <div className="space-y-4" data-testid="supplier-evidence-workspace" data-supplier-id={view.supplier.id}>
      {/* 顶部：供应商 / 项目上下文 / 身份状态 / 返回 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium" title={view.supplier.name} data-testid="supplier-name">{view.supplier.name}</p>
            {view.projectContext ? (
              <p className="mt-0.5 text-xs text-[var(--muted)]" data-testid="project-context">
                当前用于：<span className="text-[var(--foreground)]">{view.projectContext.name}</span>
                <span className="ml-1">（供应商资料是组织级的，不只属于这个项目）</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[var(--muted)]" data-testid="project-context-none">未指定当前项目</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--background)] disabled:opacity-50" data-testid="workspace-refresh">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> 刷新
            </button>
            <Link href={backHref} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--background)]" data-testid="back-to-workspace">
              <ArrowLeft size={12} /> {view.projectContext ? "返回采购工作台" : "返回供应商列表"}
            </Link>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded border px-1.5 py-0.5 ${TONE_CLASS.info}`} data-testid="identity-status">
            身份：已人工关联的供应商记录
          </span>
          <span className="text-[var(--muted)]">身份关联 ≠ 已认证 ≠ 本标合规。认证看「认证与资质」；本标合规本页不判定。</span>
        </div>

        {entry.linkedSignal ? (
          <p className="mt-2 rounded-lg bg-[var(--background)] px-2 py-1.5 text-xs" data-testid="entry-linked-signal">
            该线索已人工关联到此供应商：<span className="font-medium">{entry.linkedSignal.title ?? entry.linkedSignal.id}</span>
            <span className="ml-1 text-[var(--muted)]">（这是身份归属，不代表供应商已认证）</span>
          </p>
        ) : null}
        {entry.internalCandidate ? (
          <p className="mt-2 rounded-lg bg-[var(--background)] px-2 py-1.5 text-xs" data-testid="entry-internal-candidate">
            内部候选来源：<span className="font-medium">{originSourceLabel(entry.internalCandidate.originSource)}</span>
            <span className="ml-1 text-[var(--muted)]">（历史 / 已存 / 企业记忆——是「值得看看」，不是系统推荐）</span>
          </p>
        ) : null}
      </div>

      {refreshErr ? (
        <p
          role="status"
          data-testid="workspace-refresh-error"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]"
        >
          <AlertTriangle size={12} />
          <span>刷新失败，页面显示的可能不是最新内容：{refreshErr}</span>
          <button type="button" onClick={() => void load()} className="underline" data-testid="workspace-refresh-retry">重试</button>
        </p>
      ) : null}

      {/* 页签 */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="供应商产品与资质">
        {TABS.filter((t) => t.key !== "evaluation" || Boolean(view.projectContext)).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === t.key ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]" : "border-[var(--border)] hover:bg-[var(--background)]"}`}
          >
            {t.label}
            {t.key === "offerings" ? ` (${view.counts.offerings})` : t.key === "certifications" ? ` (${view.counts.certifications})` : t.key === "capabilities" ? ` (${view.counts.capabilities})` : ""}
          </button>
        ))}
      </div>

      {tab === "offerings" ? <OfferingsSection orgId={orgId} supplierId={view.supplier.id} view={view} onChanged={load} /> : null}
      {tab === "certifications" ? <CertificationsSection orgId={orgId} supplierId={view.supplier.id} projectId={view.projectContext?.id ?? null} view={view} onChanged={load} /> : null}
      {tab === "capabilities" ? <CapabilitiesSection orgId={orgId} supplierId={view.supplier.id} view={view} onChanged={load} /> : null}
      {tab === "evaluation" && view.projectContext ? (
        <EvaluationPanel
          orgId={orgId}
          supplierId={view.supplier.id}
          projectId={view.projectContext.id}
          offerings={view.offerings}
          canWriteSupplier={view.canWrite}
          initialRunId={evaluationRunId}
        />
      ) : null}
      {tab === "gaps" ? (
        <div className="space-y-2" data-testid="gaps-section">
          <p className="text-xs text-[var(--muted)]">
            这是<span className="font-medium">资料状态</span>——记了什么、还缺什么。不是评分，不是合规判定，不是排名；
            与招标要求的逐条匹配在后续阶段做。
          </p>
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
            {gaps.map((g) => {
              const d = completenessStatusDisplay(g.status);
              return (
                <li key={g.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="gap-row" data-gap-key={g.key} data-gap-status={g.status}>
                  <span className="min-w-[10rem] flex-1">{g.label}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${TONE_CLASS[d.tone]}`}>{d.label}</span>
                  {g.detail ? <span className="w-full text-[11px] text-[var(--muted)] sm:w-auto sm:flex-1">{g.detail}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
