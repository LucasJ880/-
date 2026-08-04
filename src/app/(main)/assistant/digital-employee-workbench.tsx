"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Megaphone,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface AlertItem {
  title: string;
  description: string;
  severity: string;
  category: string;
  action?: { payload?: { customerId?: string; opportunityId?: string } };
}

interface Briefing {
  stats: Record<string, number>;
  urgentItems: AlertItem[];
  generatedAt: string;
}

interface PendingAction {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  expiresAt: string;
}

interface DigitalEmployeeWorkbenchProps {
  orgReady: boolean;
  onPrompt: (prompt: string) => void;
}

const ROLE_ACTIONS = [
  {
    title: "销售数字员工",
    description: "整理客户跟进、商机风险与下一步动作",
    prompt: "请根据当前 CRM 数据，告诉我今天最需要跟进的客户和下一步动作",
    icon: Users,
  },
  {
    title: "报价数字员工",
    description: "检查报价风险、缺失信息与跟进节奏",
    prompt: "请检查当前销售 Pipeline 中的报价风险，并按优先级给出处理建议",
    icon: FileText,
  },
  {
    title: "营销增长数字员工",
    description: "把市场情报转成选题、实验和可审批草稿",
    prompt: "请生成本周营销简报，并给出一个最值得验证的增长实验",
    icon: Megaphone,
  },
] as const;

function alertHref(item: AlertItem): string {
  const customerId = item.action?.payload?.customerId;
  if (customerId) return `/sales/customers/${customerId}`;
  return "/sales";
}

export function DigitalEmployeeWorkbench({
  orgReady,
  onPrompt,
}: DigitalEmployeeWorkbenchProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgReady) return;
    setLoading(true);
    setError(null);
    try {
      const [briefingResponse, pendingResponse] = await Promise.all([
        apiFetch("/api/sales/daily-briefing"),
        apiFetch("/api/ai/pending-actions"),
      ]);
      if (!briefingResponse.ok) {
        throw new Error("今日业务简报暂时不可用");
      }
      const briefingBody = await briefingResponse.json();
      const pendingBody = pendingResponse.ok
        ? await pendingResponse.json()
        : { actions: [] };
      setBriefing(briefingBody.briefing ?? null);
      const actions = Array.isArray(pendingBody.actions)
        ? (pendingBody.actions as PendingAction[])
        : [];
      const now = Date.now();
      setPending(
        actions.filter((action) => new Date(action.expiresAt).getTime() > now),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作台加载失败");
    } finally {
      setLoading(false);
    }
  }, [orgReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const alerts = useMemo(
    () => (Array.isArray(briefing?.urgentItems) ? briefing.urgentItems : []),
    [briefing],
  );
  const highPriorityCount = alerts.filter(
    (item) => item.severity === "urgent",
  ).length;
  const metrics: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: "高优先事项", value: highPriorityCount, icon: AlertTriangle },
    { label: "待我确认", value: pending.length, icon: ClipboardCheck },
    {
      label: "活跃商机",
      value: briefing?.stats.activeOpportunities ?? 0,
      icon: Target,
    },
    {
      label: "本月签单",
      value: briefing?.stats.signedThisMonth ?? 0,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[980px] px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-accent">
            <Sparkles size={14} /> 青砚数字员工
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            今天需要推进什么？
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            数字员工已连接客户、商机、报价和审批工作流。它会准备下一步，但外发内容和关键业务变更仍由你确认。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!orgReady || loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-border bg-card-bg px-3 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          刷新工作台
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {error}。你仍可以在下方直接交代工作。
        </div>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card-bg p-3 shadow-xs sm:p-4">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted sm:text-xs">
              <span>{label}</span>
              <Icon size={15} />
            </div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
              {loading && !briefing ? "—" : value}
            </div>
          </div>
        ))}
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-border bg-card-bg p-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">今日行动队列</h3>
              <p className="mt-0.5 text-xs text-muted">来自 CRM、报价状态和跟进日期</p>
            </div>
            <Link href="/sales" className="text-xs font-medium text-accent hover:underline">
              打开销售工作区
            </Link>
          </div>

          <div className="mt-3 space-y-2">
            {alerts.slice(0, 5).map((item, index) => (
              <Link
                key={`${item.category}-${item.action?.payload?.customerId ?? index}`}
                href={alertHref(item)}
                className="group flex items-start gap-3 rounded-lg border border-border/70 bg-background/50 p-3 hover:border-accent/25 hover:bg-accent-soft/40"
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    item.severity === "urgent" ? "bg-red-500" : "bg-amber-500",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted">
                    {item.description}
                  </span>
                </span>
                <ArrowRight size={14} className="mt-1 shrink-0 text-muted group-hover:text-accent" />
              </Link>
            ))}
            {!loading && alerts.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                暂无高优先事项。数字员工会持续关注跟进日期、报价状态和客户互动。
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card-bg p-4 shadow-xs">
          <h3 className="text-sm font-semibold text-foreground">快捷工作流</h3>
          <p className="mt-0.5 text-xs text-muted">选择岗位目标，数字员工会带入当前组织上下文</p>
          <div className="mt-3 space-y-2">
            {ROLE_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.title}
                  type="button"
                  onClick={() => onPrompt(action.prompt)}
                  disabled={!orgReady}
                  className="group flex w-full items-start gap-3 rounded-lg border border-border/70 bg-background/50 p-3 text-left hover:border-accent/25 hover:bg-accent-soft/40 disabled:opacity-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{action.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{action.description}</span>
                  </span>
                  <ArrowRight size={14} className="mt-2 shrink-0 text-muted group-hover:text-accent" />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <section className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <BriefcaseBusiness size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold">关键动作保持人工确认</div>
            <div className="mt-0.5 text-xs leading-5 text-emerald-900/80">
              邮件、报价条件、客户状态和对外发布不会因为打开数字员工而自动执行。
            </div>
          </div>
        </div>
        <Link href="/sales/quote-sheet" className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800">
          创建报价 <ArrowRight size={13} />
        </Link>
      </section>
    </div>
  );
}
