"use client";

/**
 * Revenue Cockpit（Mengxin FDE V1）— 首页指标 + Today's Revenue Actions
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Flame, MessageSquareReply, FileText, Package, Clock, AlertTriangle, Repeat, ShieldCheck, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { getOpportunityStageLabel } from "@/lib/revenue-spine/opportunity-stage";

interface QueueItem {
  id: string;
  title: string;
  stage: string;
  customerName: string;
  customerEmail: string | null;
  score: number | null;
  scoreGrade: string | null;
  estimatedValue: number | null;
  market: string | null;
  nextActionType: string | null;
  nextFollowupAt: string | null;
  nextActionReason: string | null;
  lastCustomerReplyAt: string | null;
  fdeInfluenced: boolean;
}

interface Cockpit {
  generatedAt: string;
  currency: string;
  metrics: {
    qualifiedPipeline: { count: number; value: number };
    quotesOutstanding: { count: number; value: number };
    hotLeads: number;
    followUpsDue: number;
    samplesInProgress: number;
    expectedRevenue: number;
    wonRevenue: { count: number; value: number; thisMonthCount: number; thisMonthValue: number };
    fdeSourcedPipeline: number;
    fdeInfluencedPipeline: number;
    fdeInfluencedRevenue: number;
    grossProfit: { status: "unavailable"; reason: string } | { status: "available"; value: number };
    openOpportunities: number;
  };
  attribution: { fdeSourcedCount: number; fdeInfluencedCount: number; fdeInfluencedWonCount: number };
  stageCounts: Array<{ stage: string; count: number; value: number }>;
  todayActions: Record<string, number>;
  queue: {
    hotLeads: QueueItem[];
    needReply: QueueItem[];
    quoteFollowUp: QueueItem[];
    sampleFollowUp: QueueItem[];
    stale: QueueItem[];
    reorder: Array<{ customerId: string; customerName: string; lastWonAt: string; lastWonValue: number | null }>;
    approvalsRequired: number;
  };
}

function money(v: number, currency: string): string {
  return `${currency} ${Math.round(v).toLocaleString()}`;
}

function gradeTone(grade: string | null): string {
  switch (grade) {
    case "HOT":
      return "bg-red-500/15 text-red-400";
    case "HIGH":
      return "bg-orange-500/15 text-orange-400";
    case "MEDIUM":
      return "bg-amber-500/15 text-amber-400";
    case "LOW":
      return "bg-zinc-500/15 text-zinc-400";
    default:
      return "bg-zinc-500/10 text-zinc-500";
  }
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

function QueueSection({ icon, title, items, empty }: { icon: React.ReactNode; title: string; items: QueueItem[]; empty: string }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-xs tabular-nums">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted">{empty}</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={`/revenue/${o.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20">
                <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${gradeTone(o.scoreGrade)}`}>
                  {o.scoreGrade ?? "—"}{o.score !== null ? ` ${o.score}` : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.customerName}</div>
                  <div className="truncate text-xs text-muted">{o.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    <span>{getOpportunityStageLabel(o.stage)}</span>
                    {o.market ? <span>{o.market}</span> : null}
                    {o.nextFollowupAt ? <span>下一步 {new Date(o.nextFollowupAt).toLocaleString()}</span> : null}
                    {o.fdeInfluenced ? <span className="text-emerald-400">FDE</span> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RevenueCockpitPage() {
  const [data, setData] = useState<Cockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/revenue/cockpit");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "加载失败");
      setData(body as Cockpit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const m = data?.metrics;
  const cur = data?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <PageHeader
        title="收入驾驶舱"
        description="询盘 → RFQ → 报价 → 样品 → 谈判 → 成交；数字销售员工只做草稿，发送必须人工批准。"
        actions={
          <div className="flex gap-2">
            <Link href="/revenue?new=1" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/30">
              <Plus className="h-4 w-4" /> 录入询盘
            </Link>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/30">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
            </button>
          </div>
        }
        meta={data ? <span>更新于 {new Date(data.generatedAt).toLocaleString()}</span> : null}
      />

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> 加载中…</div>
      ) : null}

      {m ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Metric label="Qualified Pipeline" value={money(m.qualifiedPipeline.value, cur)} sub={`${m.qualifiedPipeline.count} 个商机`} />
            <Metric label="Quotes Outstanding" value={String(m.quotesOutstanding.count)} sub={money(m.quotesOutstanding.value, cur)} />
            <Metric label="Hot Leads" value={String(m.hotLeads)} sub="HOT / HIGH 且未回复" />
            <Metric label="Follow-ups Due" value={String(m.followUpsDue)} sub="下一步已到期" />
            <Metric label="Samples in Progress" value={String(m.samplesInProgress)} />
            <Metric label="Expected Revenue" value={money(m.expectedRevenue, cur)} sub="按阶段成交概率加权" />
            <Metric label="Won Revenue" value={money(m.wonRevenue.value, cur)} sub={`本月 ${money(m.wonRevenue.thisMonthValue, cur)} · ${m.wonRevenue.count} 单`} />
            <Metric label="FDE Sourced Pipeline" value={money(m.fdeSourcedPipeline, cur)} sub={`${data?.attribution.fdeSourcedCount ?? 0} 个 AI 发现`} />
            <Metric label="FDE Influenced Pipeline" value={money(m.fdeInfluencedPipeline, cur)} sub={`${data?.attribution.fdeInfluencedCount ?? 0} 个 AI 参与`} />
            <Metric label="FDE Influenced Revenue" value={money(m.fdeInfluencedRevenue, cur)} sub={m.grossProfit.status === "unavailable" ? "毛利：待成本数据（V2）" : money(m.grossProfit.value, cur)} />
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 text-sm font-medium">Today&apos;s Actions</div>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-red-500/10 px-3 py-1 text-red-400">{data?.todayActions.hotLeads ?? 0} Hot Leads</span>
              <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-cyan-400">{data?.todayActions.needReply ?? 0} Need Reply</span>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-400">{data?.todayActions.quoteFollowUp ?? 0} Quotes Need Follow-up</span>
              <span className="rounded-full bg-violet-500/10 px-3 py-1 text-violet-400">{data?.todayActions.sampleFollowUp ?? 0} Samples</span>
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-400"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />{data?.queue.approvalsRequired ?? 0} Approval Required</span>
              <span className="rounded-full bg-zinc-500/10 px-3 py-1 text-zinc-400">{data?.todayActions.stale ?? 0} Stale</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
              {data?.stageCounts.map((s) => (
                <span key={s.stage} className="rounded border border-border px-2 py-0.5">{getOpportunityStageLabel(s.stage)} {s.count}</span>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <QueueSection icon={<Flame className="h-4 w-4 text-red-400" />} title="Hot Leads" items={data!.queue.hotLeads} empty="暂无高优先新询盘" />
            <QueueSection icon={<MessageSquareReply className="h-4 w-4 text-cyan-400" />} title="Need Reply" items={data!.queue.needReply} empty="没有等待回复的客户" />
            <QueueSection icon={<FileText className="h-4 w-4 text-amber-400" />} title="Quote Follow-up" items={data!.queue.quoteFollowUp} empty="没有到期的报价跟进" />
            <QueueSection icon={<Package className="h-4 w-4 text-violet-400" />} title="Sample Follow-up" items={data!.queue.sampleFollowUp} empty="没有到期的样品跟进" />
            <QueueSection icon={<AlertTriangle className="h-4 w-4 text-zinc-400" />} title="Stale Opportunity" items={data!.queue.stale} empty="没有长期无动作的商机" />
            <section className="rounded-xl border border-border bg-card">
              <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
                <Repeat className="h-4 w-4 text-emerald-400" /> Reorder Opportunity
                <span className="ml-auto text-xs text-muted"><Clock className="mr-1 inline h-3 w-3" />V1 数据接口</span>
              </header>
              {data!.queue.reorder.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted">暂无进入复购窗口的历史客户</div>
              ) : (
                <ul className="divide-y divide-border">
                  {data!.queue.reorder.map((r) => (
                    <li key={r.customerId} className="px-4 py-3 text-sm">
                      <div className="font-medium">{r.customerName}</div>
                      <div className="text-xs text-muted">上次成交 {new Date(r.lastWonAt).toLocaleDateString()}{r.lastWonValue ? ` · ${money(r.lastWonValue, cur)}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
