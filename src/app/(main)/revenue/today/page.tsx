"use client";

/**
 * 今日询盘（老板手机视图，PRD F5）
 *
 * 四栏：今日新询盘 / 回复超时 / 待审批 / 样品与报价到期。单列、手机优先，点卡片进商机详情。
 * 审批：必须先展开看完草稿预览（含风险提醒与中文对照），「批准发送 / 拒绝」才可点；
 * 与商机详情页同一个接口（POST /api/ai/pending-actions/{id}），每次决定后都重新拉取。
 * 顶部「首响 SLA」卡片（近 30 天）单独请求 /api/revenue/sla-metrics，失败不影响四栏。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Inbox,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Timer,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import { getOpportunityStageLabel } from "@/lib/revenue-spine/opportunity-stage";

interface Card {
  opportunityId: string;
  customerName: string;
  title: string;
  stage: string;
  score: number | null;
  scoreGrade: string | null;
  market: string | null;
  sourceLabel: string;
  createdAt: string;
  ageMinutes: number;
}

interface OverdueCard extends Card {
  overdueMinutes: number;
  slaHours: number;
}

interface Approval {
  pendingActionId: string;
  title: string;
  preview: string;
  createdAt: string;
  expiresAt: string;
  waitingMinutes: number;
  opportunity: Card | null;
}

interface DueItem {
  key: string;
  opportunityId: string | null;
  kinds: Array<"quote" | "sample">;
  dueAt: string;
  overdue: boolean;
  reasons: Array<{ kind: "quote" | "sample"; label: string; dueAt: string }>;
  opportunity: Card | null;
  companyName: string | null;
  country: string | null;
  href: string;
}

interface OwnerToday {
  generatedAt: string;
  day: string;
  timeZone: string;
  newToday: Card[];
  overdue: OverdueCard[];
  approvals: Approval[];
  samplesQuotesDue: DueItem[];
  counts: { newToday: number; overdue: number; approvals: number; samplesQuotesDue: number };
}

type Notice = { tone: "error" | "ok"; text: string } | null;

interface SlaBucket {
  received: number;
  answered: number;
  unanswered: number;
  closedWithoutReply: number;
  medianFirstResponseMinutes: number | null;
  p90FirstResponseMinutes: number | null;
  within24hEligible: number;
  answeredWithin24h: number;
  answeredWithin24hRate: number | null;
}

interface SlaMetrics {
  windowDays: number;
  basis: "business" | "wall_clock";
  businessHours: { timezone: string; start: string; end: string; workdays: number[] } | null;
  inquiries: SlaBucket;
  tradeShow: SlaBucket;
  excludedTests: number;
  guardrail: { total: number; firstReply: number; followUp: number };
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

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}

/** 按组织时区显示时刻（「今天」是按组织时区切的，不能用手机本地时区）；时区串无效时退回手机本地 */
function orgTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  } catch {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

function ago(minutes: number): string {
  return minutes < 1 ? "刚刚" : `${duration(minutes)}前`;
}

function GradeBadge({ grade, score }: { grade: string | null; score: number | null }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${gradeTone(grade)}`}>
      {grade ?? "未评分"}
      {score !== null ? ` ${score}` : ""}
    </span>
  );
}

function MetaLine({ parts }: { parts: Array<React.ReactNode | null | false | undefined> }) {
  const shown = parts.filter(Boolean);
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-muted">
      {shown.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </div>
  );
}

function Section({
  id,
  icon,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-border bg-card">
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-4 py-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-xs tabular-nums">{count}</span>
      </header>
      {count === 0 ? <div className="px-4 py-5 text-sm text-muted">{empty}</div> : <ul className="divide-y divide-border">{children}</ul>}
    </section>
  );
}

function OpportunityRow({ card, trailing }: { card: Card; trailing: React.ReactNode }) {
  return (
    <li>
      <Link href={`/revenue/${card.opportunityId}`} className="flex min-h-11 items-start gap-3 px-4 py-3 active:bg-muted/30">
        <GradeBadge grade={card.scoreGrade} score={card.score} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{card.customerName}</div>
          <div className="truncate text-xs text-muted">{card.title}</div>
          <MetaLine parts={[card.market ?? "国家未知", card.sourceLabel, getOpportunityStageLabel(card.stage), trailing]} />
        </div>
      </Link>
    </li>
  );
}

function ApprovalRow({
  item,
  busy,
  onDecide,
}: {
  item: Approval;
  busy: string | null;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const [open, setOpen] = useState(false);
  const o = item.opportunity;
  const locked = !open || busy !== null;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <GradeBadge grade={o?.scoreGrade ?? null} score={o?.score ?? null} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{o?.customerName ?? item.title}</div>
          <MetaLine parts={[o ? (o.market ?? "国家未知") : null, o?.sourceLabel, `已等 ${duration(item.waitingMinutes)}`]} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-border px-3 text-sm active:bg-muted/30"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? "收起草稿" : "查看草稿（批准前必看）"}
      </button>
      {open ? (
        <div className="mt-2">
          <div className="mb-1 text-xs text-muted">{item.title}</div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/20 p-3 font-sans text-[13px] leading-relaxed">
            {item.preview}
          </pre>
          {o ? (
            <Link href={`/revenue/${o.opportunityId}`} className="mt-1 inline-flex min-h-11 items-center text-xs text-muted underline">
              打开商机详情（RFQ、评分、来信原文）
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => onDecide(item.pendingActionId, "approve")}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-40"
        >
          {busy === `approve:${item.pendingActionId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          批准发送
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => onDecide(item.pendingActionId, "reject")}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
        >
          {busy === `reject:${item.pendingActionId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          拒绝
        </button>
      </div>
      {!open ? <div className="mt-1 text-[11px] text-muted">展开看完草稿后才能批准或拒绝</div> : null}
    </li>
  );
}

function slaDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} 小时`;
  return `${(minutes / 1440).toFixed(1)} 天`;
}

const WEEKDAY_ZH = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function workdaysLabel(days: number[]): string {
  if (days.join(",") === "1,2,3,4,5") return "周一至周五";
  if (days.join(",") === "1,2,3,4,5,6") return "周一至周六";
  return days.map((d) => WEEKDAY_ZH[d] ?? "").filter(Boolean).join("、");
}

function SlaStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/20 px-2 py-1.5">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`truncate text-base font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

/** 首响 SLA（近 30 天）：口径见 src/lib/revenue-spine/sla-metrics.ts */
function SlaMetricsCard({ metrics }: { metrics: SlaMetrics }) {
  const q = metrics.inquiries;
  const booth = metrics.tradeShow;
  const rate = q.answeredWithin24hRate === null ? "—" : `${Math.round(q.answeredWithin24hRate * 100)}%`;
  const bh = metrics.businessHours;
  const basis = bh ? `首响按工作时间计（${bh.timezone} ${workdaysLabel(bh.workdays)} ${bh.start}–${bh.end}）` : "首响按自然时间计";
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <header className="flex items-center gap-2 text-sm font-medium">
        <Timer className="h-4 w-4 text-sky-400" />
        <span>首响 SLA · 近 {metrics.windowDays} 天</span>
      </header>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <SlaStat label="询盘" value={String(q.received)} />
        <SlaStat label="首响中位" value={slaDuration(q.medianFirstResponseMinutes)} />
        <SlaStat label="首响 P90" value={slaDuration(q.p90FirstResponseMinutes)} />
        <SlaStat label="24 小时内回复" value={rate} tone={q.answeredWithin24hRate !== null && q.answeredWithin24hRate < 0.95 ? "text-amber-400" : undefined} />
        <SlaStat label="未回复" value={String(q.unanswered)} tone={q.unanswered ? "text-red-400" : undefined} />
        <SlaStat label="护栏拦截" value={String(metrics.guardrail.total)} />
      </div>
      {booth.received ? (
        <div className="mt-2 text-xs text-muted">
          展会速记卡 {booth.received} 张 · 首响中位 {slaDuration(booth.medianFirstResponseMinutes)} · 未回复 {booth.unanswered}
        </div>
      ) : null}
      <div className="mt-1 text-[11px] leading-relaxed text-muted">
        {basis}；24 小时回复率按自然时间、只算已满 24 小时的询盘
        {q.closedWithoutReply ? `；${q.closedWithoutReply} 条已关闭未回复（不合格 / 人工关闭）不计入` : ""}
        {metrics.excludedTests ? `；已排除 ${metrics.excludedTests} 条入驻测试询盘` : ""}。
      </div>
    </section>
  );
}

function DueRow({ item, generatedAt, timeZone }: { item: DueItem; generatedAt: string; timeZone: string }) {
  const name = item.opportunity?.customerName ?? item.companyName ?? "未关联客户";
  const kinds = item.kinds.map((k) => (k === "quote" ? "报价" : "样品")).join(" · ");
  const due = new Date(item.dueAt);
  const overdueMinutes = Math.max(0, Math.floor((new Date(generatedAt).getTime() - due.getTime()) / 60_000));
  return (
    <li>
      <Link href={item.href} className="flex min-h-11 items-start gap-3 px-4 py-3 active:bg-muted/30">
        <span className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-400">{kinds}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-xs text-muted">{item.reasons.map((r) => r.label).join("；")}</div>
          <MetaLine
            parts={[
              item.opportunity?.market ?? item.country,
              item.opportunity?.sourceLabel,
              item.overdue ? (
                <span className="text-red-400">已过期 {duration(overdueMinutes)}</span>
              ) : (
                `今天 ${orgTime(item.dueAt, timeZone)} 到期`
              ),
            ]}
          />
        </div>
      </Link>
    </li>
  );
}

export default function OwnerTodayPage() {
  const [data, setData] = useState<OwnerToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sla, setSla] = useState<SlaMetrics | null>(null);

  const loadSla = useCallback(async () => {
    try {
      const res = await apiFetch("/api/revenue/sla-metrics");
      if (!res.ok) return;
      setSla((await res.json()) as SlaMetrics);
    } catch {
      // 指标卡片失败不影响今日四栏
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    void loadSla();
    try {
      const res = await apiFetch("/api/revenue/owner-today");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string })?.error ?? "加载失败");
      setData(body as OwnerToday);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadSla]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: "approve" | "reject") => {
      setBusy(`${decision}:${id}`);
      setNotice(null);
      try {
        const res = await apiFetch(`/api/ai/pending-actions/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision === "approve" ? { decision } : { decision, reason: "人工拒绝" }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errorCode?: string; message?: string };
        if (!res.ok || body.ok === false) {
          // 例如 STALE_DRAFT（买家又来信、草稿已过时）：提示原因，刷新后会看到新草稿或已移除
          setNotice({ tone: "error", text: `${body.error ?? "操作失败"}${body.errorCode ? `（${body.errorCode}）` : ""}` });
        } else {
          setNotice({ tone: "ok", text: decision === "approve" ? (body.message ?? "已批准并发送") : "已拒绝，不会发送" });
        }
      } catch (e) {
        setNotice({ tone: "error", text: e instanceof Error ? e.message : "网络错误" });
      } finally {
        setBusy(null);
        notifyPendingActionsChanged();
        await load();
      }
    },
    [load],
  );

  const c = data?.counts;
  const chips: Array<{ id: string; label: string; value: number | undefined; tone: string }> = [
    { id: "new-today", label: "今日新询盘", value: c?.newToday, tone: "text-cyan-400" },
    { id: "overdue", label: "回复超时", value: c?.overdue, tone: "text-red-400" },
    { id: "approvals", label: "待审批", value: c?.approvals, tone: "text-emerald-400" },
    { id: "samples-quotes", label: "样品/报价到期", value: c?.samplesQuotesDue, tone: "text-violet-400" },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <PageHeader
        breadcrumbs={<Link href="/revenue" className="hover:text-foreground">收入驾驶舱</Link>}
        title="今日询盘"
        description="今天新进的询盘、该回没回的、等你批的回复草稿、今天到期的样品和报价。"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm active:bg-muted/30"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        }
        meta={data ? <span>按组织当地时间（{data.timeZone}）· 更新于 {orgTime(data.generatedAt, data.timeZone)}</span> : null}
      />

      {notice ? (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${notice.tone === "error" ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"}`}
        >
          {notice.text}
        </div>
      ) : null}
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : null}

      {sla ? <SlaMetricsCard metrics={sla} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {chips.map((chip) => (
              <a key={chip.id} href={`#${chip.id}`} className="flex min-h-11 flex-col justify-center rounded-xl border border-border bg-card px-3 py-2 active:bg-muted/30">
                <span className="text-xs text-muted">{chip.label}</span>
                <span className={`text-2xl font-semibold tabular-nums ${chip.tone}`}>{chip.value ?? 0}</span>
              </a>
            ))}
          </div>

          <Section id="new-today" icon={<Inbox className="h-4 w-4 text-cyan-400" />} title="今日新询盘" count={data.counts.newToday} empty="今天还没有新询盘">
            {data.newToday.map((o) => (
              <OpportunityRow key={o.opportunityId} card={o} trailing={ago(o.ageMinutes)} />
            ))}
          </Section>

          <Section id="overdue" icon={<AlertTriangle className="h-4 w-4 text-red-400" />} title="回复超时" count={data.counts.overdue} empty="没有超时未回复的买家">
            {data.overdue.map((o) => (
              <OpportunityRow key={o.opportunityId} card={o} trailing={<span className="text-red-400">超时 {duration(o.overdueMinutes)}</span>} />
            ))}
          </Section>

          <Section id="approvals" icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="待审批回复" count={data.counts.approvals} empty="没有等你审批的回复草稿">
            {data.approvals.map((a) => (
              <ApprovalRow key={a.pendingActionId} item={a} busy={busy} onDecide={(id, d) => void decide(id, d)} />
            ))}
          </Section>

          <Section id="samples-quotes" icon={<Package className="h-4 w-4 text-violet-400" />} title="样品与报价到期" count={data.counts.samplesQuotesDue} empty="今天没有到期的样品或报价跟进">
            {data.samplesQuotesDue.map((d) => (
              <DueRow key={d.key} item={d} generatedAt={data.generatedAt} timeZone={data.timeZone} />
            ))}
          </Section>

          {data.counts.newToday > data.newToday.length ||
          data.counts.overdue > data.overdue.length ||
          data.counts.approvals > data.approvals.length ||
          data.counts.samplesQuotesDue > data.samplesQuotesDue.length ? (
            <div className="flex items-center gap-1 text-xs text-muted">
              <Clock className="h-3.5 w-3.5" /> 每栏最多显示 50 条，完整列表见收入驾驶舱。
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
