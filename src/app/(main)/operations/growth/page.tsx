"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, CircleDollarSign, ClipboardList, Database, FlaskConical, Megaphone, RefreshCw, Target, Users, Workflow } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { PageHeader } from "@/components/page-header";
import { DIMENSION_LABELS } from "@/lib/marketing/constants";

interface DashboardData {
  profile: { validationStatus: string; validationScore: number; brandName: string } | null;
  summary: { marketPresence: number | null; growthExecution: number; effectiveLeads: number; revenue: number; currency: string; runningExperiments: number; pendingContent: number; pendingIntelTopics?: number; pendingTeamApprovals: number; highPriorityIssues: number; spend: number };
  latestAudit: { confidence: number; completedAt: string; dimensions: Array<{ dimension: string; score: number; grade: string }> } | null;
  highPriorityFindings: Array<{ id: string; dimension: string; severity: string; title: string; description: string | null; status: string; taskId: string | null }>;
  campaigns: Array<{ id: string; name: string; status: string; objective: string }>;
  pendingTeamApprovals: Array<{ id: string; title: string; preview: string; createdAt: string; expiresAt: string; requester: { id: string; name: string }; approver: { id: string; name: string } | null; canApprove: boolean }>;
  plan: { id: string; name: string; status: string; items: Array<{ id: string; title: string; dueDate: string; priority: string; status: string; taskId?: string | null }> } | null;
  funnel: {
    stages: Array<{ key: string; label: string; value: number; conversionRate: number | null }>;
    bottleneck: { from: string; to: string; rate: number } | null;
    inconsistent: boolean;
    economics: { spend: number; revenue: number; costPerLead: number | null; costPerQualifiedLead: number | null; costPerWin: number | null; roas: number | null };
  };
  measurement: { snapshotCount: number; unverifiedSnapshotCount: number; channelAccountCount: number; connectedChannelAccountCount: number; latestDataAt: string | null; latestSyncAt: string | null };
  recommendations: Array<{ id: string; priority: "urgent" | "high" | "medium"; title: string; reason: string; href: string; action: string }>;
}

function Stat({ label, value, icon: Icon, suffix = "" }: { label: string; value: string | number; icon: typeof Activity; suffix?: string }) {
  return <div className="rounded-xl border border-border bg-card-bg p-4"><div className="flex items-center justify-between text-xs text-muted"><span>{label}</span><Icon size={16} /></div><div className="mt-2 text-2xl font-bold">{value}{suffix}</div></div>;
}

function formatCad(value: number | null) {
  if (value == null) return "待数据";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

const PRIORITY_STYLE = {
  urgent: "border-red-300 bg-red-50 text-red-950",
  high: "border-amber-300 bg-amber-50 text-amber-950",
  medium: "border-blue-200 bg-blue-50 text-blue-950",
} as const;

export default function GrowthCenterPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      setData(null);
      setError("缺少当前组织：请先在上方选择工作组织后再试。");
      return;
    }
    setLoading(true); setError(null);
    try {
      const response = await apiFetch(
        `/api/marketing/dashboard?orgId=${encodeURIComponent(orgId)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "增长中心加载失败");
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "增长中心加载失败"); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => {
    if (orgLoading) return;
    if (ambiguous || !orgId) {
      setLoading(false);
      setData(null);
      if (ambiguous) {
        setError("您属于多个组织，请先在上方选择当前工作组织后再使用增长中心。");
      }
      return;
    }
    void load();
  }, [orgId, orgLoading, ambiguous, load]);

  async function convertFinding(id: string, title: string) {
    if (!orgId) return setError("请先选择当前工作组织");
    if (!window.confirm(`确认将问题「${title}」转为增长任务？\n将指派给你，并回填相关计划项。`)) return;
    setError(null);
    const response = await apiFetch(`/api/marketing/findings/${id}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "任务创建失败");
    if (body.reused && body.task?.id) {
      setBrief(`该问题已关联任务，可直接打开：/tasks/${body.task.id}`);
    } else if (body.task?.id) {
      setBrief(`已创建任务：${body.task.title || body.task.id}`);
    }
    await load();
  }

  async function convertPlanItem(id: string, title: string) {
    if (!orgId) return setError("请先选择当前工作组织");
    if (!window.confirm(`确认将计划项「${title}」转为任务？`)) return;
    setError(null);
    const response = await apiFetch(`/api/marketing/plan-items/${id}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "计划项转任务失败");
    setBrief(body.reused ? "该计划项已关联任务" : "计划项已转为任务");
    await load();
  }

  async function generatePlan() {
    if (!orgId) {
      return setError("缺少当前组织：请先在上方选择工作组织后再生成 30 天推广计划。");
    }
    setError(null);
    const response = await apiFetch("/api/marketing/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "计划生成失败");
    await load();
  }

  async function previewBrief() {
    if (!orgId) return setError("请先选择当前工作组织");
    const response = await apiFetch(
      `/api/marketing/daily-brief?orgId=${encodeURIComponent(orgId)}`,
    );
    const body = await response.json();
    if (!response.ok) return setError(body.error || "日报生成失败");
    setBrief(body.text);
  }

  async function decideApproval(id: string, decision: "approve" | "reject") {
    setError(null);
    const response = await apiFetch(`/api/ai/pending-actions/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "审批处理失败");
    await load();
  }

  return <div className="mx-auto max-w-6xl space-y-5">
    <PageHeader
      title="增长中心 Growth Center"
      description="从企业事实、营销体检到任务、内容、实验和成交反馈的执行闭环。"
      actions={
        <button type="button" onClick={load} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新
        </button>
      }
    />
    <OrgSelectBanner />
    {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {data && !data.profile && <Link href="/operations/growth/brand" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><AlertTriangle size={20} /><span><strong>先建立企业事实中心</strong><br/><span className="text-sm">确认地域、行业、产品和竞争对手后，系统才允许营销检测。</span></span></Link>}
    {data?.profile && data.profile.validationStatus !== "valid" && <Link href="/operations/growth/brand" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><AlertTriangle size={20} /><span>企业事实校验得分 {data.profile.validationScore}/100，仍需补充后才能运行体检。</span></Link>}
    {data && <>
      <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Decision first</p>
            <h2 className="mt-1 text-lg font-semibold">本周营销决策</h2>
            <p className="mt-1 text-sm text-muted">系统只保留最需要处理的三件事，不会自动发布或调整预算。</p>
          </div>
          <Link href="/marketing/employee" className="text-sm font-medium text-accent">交给营销数字员工分析 →</Link>
        </div>
        {data.recommendations.length === 0 ? (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 size={18} /> 当前没有关键阻塞，继续观察实验和成交质量。
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {data.recommendations.map((item, index) => (
              <Link key={item.id} href={item.href} className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${PRIORITY_STYLE[item.priority]}`}>
                <div className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span>优先级 {index + 1}</span>
                  <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                </div>
                <h3 className="mt-3 font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 opacity-80">{item.reason}</p>
                <p className="mt-3 text-xs font-semibold">{item.action} →</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">从曝光到成交</h2>
            <p className="mt-1 text-xs text-muted">本月渠道数据与已归因 CRM 商机合并视图</p>
          </div>
          <Link href="/operations/growth/metrics" className="inline-flex items-center gap-1 text-sm text-accent"><Database size={14}/>管理数据口径</Link>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {data.funnel.stages.map((stage, index) => (
            <div key={stage.key} className="relative rounded-lg bg-background p-3">
              <div className="text-xs text-muted">{stage.label}</div>
              <div className="mt-1 text-xl font-bold">{stage.value.toLocaleString()}</div>
              <div className="mt-1 min-h-4 text-[11px] text-muted">
                {index === 0 ? "漏斗起点" : stage.conversionRate == null ? "待上游数据" : `上一步转化 ${stage.conversionRate}%`}
              </div>
            </div>
          ))}
        </div>
        {data.funnel.inconsistent && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">部分下游数量高于上游，说明渠道与 CRM 口径尚未完全对齐；在扩大预算前请先核对数据。</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="单条线索成本" value={formatCad(data.funnel.economics.costPerLead)} icon={CircleDollarSign} />
          <Stat label="有效线索成本" value={formatCad(data.funnel.economics.costPerQualifiedLead)} icon={CircleDollarSign} />
          <Stat label="单次成交成本" value={formatCad(data.funnel.economics.costPerWin)} icon={CircleDollarSign} />
          <Stat label="ROAS" value={data.funnel.economics.roas == null ? "待数据" : `${data.funnel.economics.roas.toFixed(2)}×`} icon={BarChart3} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span>本月数据 {data.measurement.snapshotCount} 条</span>
          <span>未验证 {data.measurement.unverifiedSnapshotCount} 条</span>
          <span>渠道账号 {data.measurement.connectedChannelAccountCount}/{data.measurement.channelAccountCount} 已连接</span>
          <span>最近数据：{data.measurement.latestDataAt ? new Date(data.measurement.latestDataAt).toLocaleDateString("zh-CN") : "暂无"}</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Stat label="市场存在度" value={data.summary.marketPresence ?? "待体检"} icon={BarChart3} suffix={data.summary.marketPresence == null ? "" : "/100"} />
        <Stat label="增长执行力" value={data.summary.growthExecution} icon={Activity} suffix="/100" />
        <Stat label="有效线索" value={data.summary.effectiveLeads} icon={Users} />
        <Stat label="成交贡献" value={new Intl.NumberFormat("en-CA", { style: "currency", currency: data.summary.currency, maximumFractionDigits: 0 }).format(data.summary.revenue)} icon={Target} />
        <Stat label="运行实验" value={data.summary.runningExperiments} icon={FlaskConical} />
        <Stat label="待审批内容" value={data.summary.pendingContent} icon={CheckCircle2} />
        <Stat label="高优问题" value={data.summary.highPriorityIssues} icon={AlertTriangle} />
      </div>
      {(data.summary.pendingIntelTopics ?? 0) > 0 && (
        <Link
          href="/operations/calendar"
          className="flex items-center justify-between gap-3 rounded-xl border border-violet-300 bg-violet-50 p-4 text-violet-950"
        >
          <span>
            <strong>待审情报选题 {data.summary.pendingIntelTopics} 条</strong>
            <br />
            <span className="text-sm">市场情报确认后进入内容日历，请运营审核后再配视频扇出。</span>
          </span>
          <span className="shrink-0 text-sm font-medium">打开内容日历 →</span>
        </Link>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card-bg p-4 lg:col-span-2">
          <div className="flex items-center justify-between"><h2 className="font-semibold">七维营销体检</h2><Link href="/operations/growth/audit" className="text-sm text-accent">手动录入体检 →</Link></div>
          {data.latestAudit ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{data.latestAudit.dimensions.map((row) => <div key={row.dimension} className="rounded-lg bg-background p-3 text-center"><div className="text-xs text-muted">{DIMENSION_LABELS[row.dimension as keyof typeof DIMENSION_LABELS] ?? row.dimension}</div><div className="mt-1 text-xl font-bold">{row.score}</div><div className="text-xs text-muted">{row.grade}</div></div>)}</div> : <p className="mt-4 text-sm text-muted">还没有有效体检。错误地域、行业或未确认竞争对手会被拒绝且不计分。</p>}
        </section>
        <section className="rounded-xl border border-border bg-card-bg p-4"><h2 className="font-semibold">快捷入口</h2><div className="mt-3 space-y-2 text-sm">
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/marketing/employee"><Megaphone size={16}/>营销数字员工</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/brand"><ClipboardList size={16}/>企业事实中心</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/metrics"><Activity size={16}/>渠道数据接入</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/campaigns"><Megaphone size={16}/>营销活动</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/experiments"><FlaskConical size={16}/>赛马实验</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/automations"><Workflow size={16}/>智能自动流</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/mmm"><BrainCircuit size={16}/>Meridian MMM</Link>
          <button type="button" onClick={previewBrief} className="flex w-full items-center gap-2 rounded-lg bg-background p-3 text-left"><Users size={16}/>预览微信推广日报</button>
        </div></section>
      </div>
      {brief && <pre className="whitespace-pre-wrap rounded-xl border border-border bg-card-bg p-4 text-sm">{brief}</pre>}
      {data.pendingTeamApprovals.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-amber-950">Leader 待审批计划</h2><span className="text-xs text-amber-800">{data.pendingTeamApprovals.length} 项</span></div>
        <div className="mt-3 space-y-3">{data.pendingTeamApprovals.map((approval) => <div key={approval.id} className="rounded-lg border border-amber-200 bg-card-bg p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-medium">{approval.title}</div><div className="mt-1 text-xs text-muted">提交人：{approval.requester.name} · 审批人：{approval.approver?.name || "组织管理员"}</div></div>{approval.canApprove ? <div className="flex gap-2"><button type="button" onClick={() => decideApproval(approval.id, "reject")} className="rounded-lg border border-border px-3 py-1.5 text-xs">退回</button><button type="button" onClick={() => decideApproval(approval.id, "approve")} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)]">批准并创建任务</button></div> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">等待 Leader</span>}</div>
          <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted">{approval.preview}</pre>
        </div>)}</div>
      </section>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card-bg p-4"><h2 className="font-semibold">高优先级问题</h2><p className="mt-1 text-xs text-muted">确认后一键建任务（不会自动发布或改预算）。</p><div className="mt-3 space-y-2">{data.highPriorityFindings.length === 0 ? <p className="text-sm text-muted">暂无高优先级问题。</p> : data.highPriorityFindings.map((finding) => <div key={finding.id} className="flex items-start justify-between gap-3 rounded-lg bg-background p-3"><div><div className="text-xs text-red-600">{finding.severity.toUpperCase()} · {finding.dimension}</div><div className="mt-1 text-sm font-medium">{finding.title}</div></div>{finding.taskId ? <Link href={`/tasks/${finding.taskId}`} className="shrink-0 text-xs text-accent">查看任务</Link> : <button type="button" onClick={() => convertFinding(finding.id, finding.title)} className="shrink-0 rounded border border-border px-2 py-1 text-xs">确认并建任务</button>}</div>)}</div></section>
        <section className="rounded-xl border border-border bg-card-bg p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">30 天推广计划</h2><button type="button" onClick={generatePlan} className="text-sm text-accent">生成新计划</button></div>{data.plan ? <div className="mt-3"><div className="flex items-center gap-2"><div className="text-sm font-medium">{data.plan.name}</div><span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{data.plan.status === "awaiting_approval" ? "待审批" : data.plan.status === "active" ? "执行中" : data.plan.status}</span></div><div className="mt-2 space-y-2">{data.plan.items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 text-sm"><span>{item.title}</span><span className="flex shrink-0 items-center gap-2 text-xs text-muted">{item.dueDate.slice(0,10)}{item.taskId ? <Link href={`/tasks/${item.taskId}`} className="text-accent">任务</Link> : <button type="button" onClick={() => convertPlanItem(item.id, item.title)} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground">建任务</button>}</span></div>)}</div></div> : <p className="mt-3 text-sm text-muted">体检或市场研究完成后会生成 30 天计划。</p>}</section>
      </div>
    </>}
  </div>;
}
