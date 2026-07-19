"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, BrainCircuit, CheckCircle2, ClipboardList, FlaskConical, Megaphone, RefreshCw, Target, Users, Workflow } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { DIMENSION_LABELS } from "@/lib/marketing/constants";

interface DashboardData {
  profile: { validationStatus: string; validationScore: number; brandName: string } | null;
  summary: { marketPresence: number | null; growthExecution: number; effectiveLeads: number; revenue: number; currency: string; runningExperiments: number; pendingContent: number; pendingIntelTopics?: number; pendingTeamApprovals: number; highPriorityIssues: number; spend: number };
  latestAudit: { confidence: number; completedAt: string; dimensions: Array<{ dimension: string; score: number; grade: string }> } | null;
  highPriorityFindings: Array<{ id: string; dimension: string; severity: string; title: string; description: string | null; status: string; taskId: string | null }>;
  campaigns: Array<{ id: string; name: string; status: string; objective: string }>;
  pendingTeamApprovals: Array<{ id: string; title: string; preview: string; createdAt: string; expiresAt: string; requester: { id: string; name: string }; approver: { id: string; name: string } | null; canApprove: boolean }>;
  plan: { id: string; name: string; status: string; items: Array<{ id: string; title: string; dueDate: string; priority: string; status: string; taskId?: string | null }> } | null;
}

function Stat({ label, value, icon: Icon, suffix = "" }: { label: string; value: string | number; icon: typeof Activity; suffix?: string }) {
  return <div className="rounded-xl border border-border bg-card-bg p-4"><div className="flex items-center justify-between text-xs text-muted"><span>{label}</span><Icon size={16} /></div><div className="mt-2 text-2xl font-bold">{value}{suffix}</div></div>;
}

export default function GrowthCenterPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiFetch("/api/marketing/dashboard");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "增长中心加载失败");
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "增长中心加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!orgLoading && !ambiguous) load(); }, [orgId, orgLoading, ambiguous, load]);

  async function convertFinding(id: string) {
    const response = await apiFetch(`/api/marketing/findings/${id}/task`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "任务创建失败");
    await load();
  }

  async function generatePlan() {
    const response = await apiFetch("/api/marketing/plans", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "计划生成失败");
    await load();
  }

  async function previewBrief() {
    const response = await apiFetch("/api/marketing/daily-brief");
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">增长中心 Growth Center</h1><p className="mt-1 text-sm text-muted">从企业事实、营销体检到任务、内容、实验和成交反馈的执行闭环。</p></div>
      <button type="button" onClick={load} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />刷新</button>
    </div>
    <OrgSelectBanner />
    {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {data && !data.profile && <Link href="/operations/growth/brand" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><AlertTriangle size={20} /><span><strong>先建立企业事实中心</strong><br/><span className="text-sm">确认地域、行业、产品和竞争对手后，系统才允许营销检测。</span></span></Link>}
    {data?.profile && data.profile.validationStatus !== "valid" && <Link href="/operations/growth/brand" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><AlertTriangle size={20} /><span>企业事实校验得分 {data.profile.validationScore}/100，仍需补充后才能运行体检。</span></Link>}
    {data && <>
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
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/brand"><ClipboardList size={16}/>企业事实中心</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/metrics"><Activity size={16}/>录入渠道数据</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/campaigns"><Megaphone size={16}/>活动与赛马实验</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/automations"><Workflow size={16}/>智能自动流</Link>
          <Link className="flex items-center gap-2 rounded-lg bg-background p-3" href="/operations/growth/mmm"><BrainCircuit size={16}/>Meridian MMM</Link>
          <button type="button" onClick={previewBrief} className="flex w-full items-center gap-2 rounded-lg bg-background p-3 text-left"><Users size={16}/>预览微信推广日报</button>
        </div></section>
      </div>
      {brief && <pre className="whitespace-pre-wrap rounded-xl border border-border bg-card-bg p-4 text-sm">{brief}</pre>}
      {data.pendingTeamApprovals.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-amber-950">Leader 待审批计划</h2><span className="text-xs text-amber-800">{data.pendingTeamApprovals.length} 项</span></div>
        <div className="mt-3 space-y-3">{data.pendingTeamApprovals.map((approval) => <div key={approval.id} className="rounded-lg border border-amber-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-medium">{approval.title}</div><div className="mt-1 text-xs text-muted">提交人：{approval.requester.name} · 审批人：{approval.approver?.name || "组织管理员"}</div></div>{approval.canApprove ? <div className="flex gap-2"><button type="button" onClick={() => decideApproval(approval.id, "reject")} className="rounded-lg border border-border px-3 py-1.5 text-xs">退回</button><button type="button" onClick={() => decideApproval(approval.id, "approve")} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">批准并创建任务</button></div> : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">等待 Leader</span>}</div>
          <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted">{approval.preview}</pre>
        </div>)}</div>
      </section>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card-bg p-4"><h2 className="font-semibold">高优先级问题</h2><div className="mt-3 space-y-2">{data.highPriorityFindings.length === 0 ? <p className="text-sm text-muted">暂无高优先级问题。</p> : data.highPriorityFindings.map((finding) => <div key={finding.id} className="flex items-start justify-between gap-3 rounded-lg bg-background p-3"><div><div className="text-xs text-red-600">{finding.severity.toUpperCase()} · {finding.dimension}</div><div className="mt-1 text-sm font-medium">{finding.title}</div></div>{finding.taskId ? <Link href={`/tasks/${finding.taskId}`} className="shrink-0 text-xs text-accent">查看任务</Link> : <button type="button" onClick={() => convertFinding(finding.id)} className="shrink-0 rounded border border-border px-2 py-1 text-xs">转为任务</button>}</div>)}</div></section>
        <section className="rounded-xl border border-border bg-card-bg p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">30 天推广计划</h2><button type="button" onClick={generatePlan} className="text-sm text-accent">生成新计划</button></div>{data.plan ? <div className="mt-3"><div className="flex items-center gap-2"><div className="text-sm font-medium">{data.plan.name}</div><span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{data.plan.status === "awaiting_approval" ? "待审批" : data.plan.status === "active" ? "执行中" : data.plan.status}</span></div><div className="mt-2 space-y-2">{data.plan.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm"><span>{item.title}</span><span className="shrink-0 text-xs text-muted">{item.dueDate.slice(0,10)}</span></div>)}</div></div> : <p className="mt-3 text-sm text-muted">体检或市场研究完成后会生成 30 天计划。</p>}</section>
      </div>
    </>}
  </div>;
}
