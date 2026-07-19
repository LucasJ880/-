"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  Building2,
  Check,
  CirclePause,
  CirclePlay,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface MarketMonitor {
  id: string;
  providerMonitorId?: string | null;
  status: string;
  scheduleText: string;
  scheduleCron?: string | null;
  targetUrls: unknown;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastError?: string | null;
  _count?: { snapshots: number };
}

interface MarketCompetitor {
  id: string;
  name: string;
  websiteUrl: string;
  normalizedDomain: string;
  targetGeography?: string | null;
  primaryProduct?: string | null;
  status: string;
  updatedAt: string;
  monitors: MarketMonitor[];
}

interface MarketSignal {
  id: string;
  competitorId: string;
  competitorName: string;
  signalType: string;
  severity: "low" | "medium" | "high";
  status: "pending" | "reviewed" | "dismissed";
  title: string;
  summary: string;
  analysisStatus: string;
  reviewNote?: string | null;
  createdAt: string;
  snapshot: {
    url: string;
    pageStatus: string;
    capturedAt: string;
    diffJson?: unknown;
  };
  analysis?: {
    id: string;
    outputMarkdown?: string | null;
    completedAt?: string | null;
  } | null;
  contentPlan?: { id: string; status: string; topic: string } | null;
}

interface AutomationWorkspace {
  configured: boolean;
  webhookSecure: boolean;
  canManage: boolean;
  competitors: MarketCompetitor[];
  signals: MarketSignal[];
}

interface CompetitorForm {
  name: string;
  websiteUrl: string;
  targetGeography: string;
  primaryProduct: string;
  salesModel: string;
  watchFocus: string;
  scheduleText: string;
}

const EMPTY_FORM: CompetitorForm = {
  name: "",
  websiteUrl: "",
  targetGeography: "Greater Toronto Area",
  primaryProduct: "",
  salesModel: "询价报价 + 预约量房",
  watchFocus: "价格、优惠、产品组合、免费量房、安装、质保与主要转化动作",
  scheduleText: "weekly",
};

function formatTime(value?: string | null) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function targetCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

const SEVERITY_STYLE = {
  high: "border-danger/20 bg-danger-bg text-danger",
  medium: "border-warning/25 bg-warning-bg text-warning",
  low: "border-border bg-background text-muted",
} as const;

const SEVERITY_LABEL = { high: "关键", medium: "关注", low: "记录" } as const;

export function MonitoringWorkspace() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [workspace, setWorkspace] = useState<AutomationWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CompetitorForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<MarketSignal | null>(null);
  /** 确认已阅时默认送入内容日历 */
  const [sendToContent, setSendToContent] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/operations/market-intelligence?orgId=${encodeURIComponent(orgId)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "市场情报加载失败");
      setWorkspace(data.automation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "市场情报加载失败");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgLoading || ambiguous || !orgId) {
      setLoading(false);
      return;
    }
    load();
  }, [ambiguous, load, orgId, orgLoading]);

  const metrics = useMemo(() => {
    const competitors = workspace?.competitors ?? [];
    const signals = workspace?.signals ?? [];
    return {
      active: competitors.filter((item) => item.status === "active").length,
      pending: signals.filter((item) => item.status === "pending").length,
      high: signals.filter((item) => item.severity === "high" && item.status === "pending").length,
    };
  }, [workspace]);

  function updateForm<K extends keyof CompetitorForm>(key: K, value: CompetitorForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createCompetitor() {
    if (!orgId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch("/api/operations/market-intelligence/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...form }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "竞品监听创建失败");
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "竞品监听创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function runCompetitor(competitorId: string) {
    if (!orgId) return;
    setBusyAction(`run:${competitorId}`);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/operations/market-intelligence/competitors/${competitorId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "巡检启动失败");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "巡检启动失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleCompetitor(competitor: MarketCompetitor) {
    if (!orgId) return;
    const active = competitor.status !== "active";
    setBusyAction(`toggle:${competitor.id}`);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/operations/market-intelligence/competitors/${competitor.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, active }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "状态更新失败");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeCompetitor(competitor: MarketCompetitor) {
    if (!orgId || !window.confirm(`确认移除 ${competitor.name} 及其历史监听记录？`)) return;
    setBusyAction(`delete:${competitor.id}`);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/operations/market-intelligence/competitors/${competitor.id}?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "移除失败");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function reviewSignal(signal: MarketSignal, status: "reviewed" | "dismissed") {
    if (!orgId) return;
    setBusyAction(`review:${signal.id}`);
    setNotice(null);
    try {
      const response = await apiFetch(
        `/api/operations/market-intelligence/signals/${signal.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            status,
            sendToContent: status === "reviewed" ? sendToContent : false,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "审核失败");
      if (status === "reviewed" && sendToContent) {
        if (data.contentPlanItem) {
          setNotice(
            data.contentPlanCreated
              ? `已确认，并生成内容选题「${data.contentPlanItem.topic}」（待审）`
              : `已确认；选题已存在「${data.contentPlanItem.topic}」`,
          );
        } else if (data.contentPlanError) {
          setNotice(`已确认信号，但生成选题失败：${data.contentPlanError}`);
        }
      } else if (status === "reviewed") {
        setNotice("已确认信号（未送内容运营）");
      }
      setSelectedSignal(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      setBusyAction(null);
    }
  }

  const competitors = workspace?.competitors ?? [];
  const signals = workspace?.signals ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-muted">MARKET INTELLIGENCE · COMPETITOR WATCH</p>
          <h1 className="mt-1 text-2xl font-semibold">竞品监听</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", workspace?.configured ? "bg-success" : "bg-danger")} />
              Firecrawl {workspace?.configured ? "已连接" : "未连接"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", workspace?.webhookSecure ? "bg-success" : "bg-warning")} />
              回传校验 {workspace?.webhookSecure ? "正常" : "待配置"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading || !orgId}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-white/70 text-foreground hover:bg-white disabled:opacity-50"
            aria-label="刷新市场情报"
            title="刷新"
          >
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </button>
          {workspace?.canManage && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={!orgId || !workspace.configured || !workspace.webhookSecure}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus size={15} />
              新增竞品
            </button>
          )}
        </div>
      </header>

      <OrgSelectBanner />

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-[var(--radius-md)] border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}{" "}
          <a href="/operations/calendar" className="font-medium underline underline-offset-2">
            打开内容日历
          </a>
        </div>
      )}

      <section className="grid grid-cols-3 divide-x divide-border border-y border-border bg-card-bg" aria-label="监听概况">
        {[
          { label: "监听中", value: metrics.active, icon: Radar, color: "text-accent" },
          { label: "待审核", value: metrics.pending, icon: Clock3, color: "text-warning" },
          { label: "关键变化", value: metrics.high, icon: Activity, color: "text-danger" },
        ].map((item) => (
          <div key={item.label} className="min-w-0 px-3 py-4 sm:px-5">
            <div className="flex items-center gap-2 text-xs text-muted">
              <item.icon size={14} className={item.color} />
              <span className="truncate">{item.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{item.value}</p>
          </div>
        ))}
      </section>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center text-muted">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-accent" />
                <h2 className="text-sm font-semibold">竞品池</h2>
              </div>
              <span className="text-[11px] text-muted">{competitors.length} 个品牌</span>
            </div>
            {competitors.length > 0 ? (
              <div className="divide-y divide-border">
                {competitors.map((competitor) => {
                  const monitor = competitor.monitors[0];
                  const active = competitor.status === "active";
                  return (
                    <article key={competitor.id} className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-background text-sm font-semibold text-foreground">
                          {competitor.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-foreground">{competitor.name}</h3>
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-success" : competitor.status === "setup_error" ? "bg-danger" : "bg-text-quaternary")} />
                          </div>
                          <a
                            href={competitor.websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted hover:text-accent"
                          >
                            <span className="truncate">{competitor.normalizedDomain}</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        {workspace?.canManage && <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => runCompetitor(competitor.id)}
                            disabled={!active || busyAction === `run:${competitor.id}`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-background hover:text-foreground disabled:opacity-40 sm:h-8 sm:w-8"
                            aria-label={`立即巡检 ${competitor.name}`}
                            title="立即巡检"
                          >
                            {busyAction === `run:${competitor.id}` ? <Loader2 size={14} className="animate-spin" /> : <CirclePlay size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCompetitor(competitor)}
                            disabled={!monitor?.providerMonitorId || busyAction === `toggle:${competitor.id}`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-background hover:text-foreground disabled:opacity-40 sm:h-8 sm:w-8"
                            aria-label={active ? `暂停 ${competitor.name}` : `恢复 ${competitor.name}`}
                            title={active ? "暂停监听" : "恢复监听"}
                          >
                            {active ? <CirclePause size={15} /> : <CirclePlay size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCompetitor(competitor)}
                            disabled={busyAction === `delete:${competitor.id}`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-40 sm:h-8 sm:w-8"
                            aria-label={`移除 ${competitor.name}`}
                            title="移除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="text-text-quaternary">页面</p>
                          <p className="mt-0.5 font-medium text-foreground">{targetCount(monitor?.targetUrls)}</p>
                        </div>
                        <div>
                          <p className="text-text-quaternary">快照</p>
                          <p className="mt-0.5 font-medium text-foreground">{monitor?._count?.snapshots ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-text-quaternary">节奏</p>
                          <p className="mt-0.5 font-medium text-foreground">{monitor?.scheduleText === "daily" ? "每日" : "每周"}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted">
                        <span>上次 {formatTime(monitor?.lastRunAt)}</span>
                        <span>下次 {formatTime(monitor?.nextRunAt)}</span>
                      </div>
                      {monitor?.lastError && (
                        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-danger">{monitor.lastError}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <Building2 size={22} className="mx-auto text-text-quaternary" />
                <p className="mt-3 text-sm font-medium text-foreground">竞品池为空</p>
                {workspace?.canManage && (
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    disabled={!workspace.configured || !workspace.webhookSecure}
                    className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
                  >
                    <Plus size={14} />
                    新增竞品
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-accent" />
                <h2 className="text-sm font-semibold">信号流</h2>
              </div>
              <span className="text-[11px] text-muted">按时间倒序</span>
            </div>
            {signals.length > 0 ? (
              <div className="divide-y divide-border">
                {signals.map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => setSelectedSignal(signal)}
                    className="grid w-full gap-3 px-4 py-4 text-left hover:bg-background/60 sm:grid-cols-[88px_minmax(0,1fr)_112px] sm:items-center"
                  >
                    <div className="flex items-center gap-2 sm:block">
                      <span className={cn("inline-flex min-h-6 items-center rounded-[var(--radius-sm)] border px-2 text-[11px] font-medium", SEVERITY_STYLE[signal.severity])}>
                        {SEVERITY_LABEL[signal.severity]}
                      </span>
                      <span className="text-[11px] text-muted sm:mt-2 sm:block">{formatTime(signal.createdAt)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{signal.competitorName}</h3>
                        {signal.status !== "pending" && (
                          <Check size={13} className={signal.status === "reviewed" ? "text-success" : "text-text-quaternary"} />
                        )}
                        {signal.contentPlan && (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                            已进日历
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{signal.summary}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:block sm:text-right">
                      <span className="text-[11px] text-muted">
                        {signal.analysisStatus === "completed"
                          ? "分析已就绪"
                          : signal.analysisStatus === "running"
                            ? "分析中"
                            : signal.analysisStatus === "queued"
                              ? "等待分析"
                              : signal.analysisStatus === "failed"
                                ? "分析失败"
                                : "仅归档"}
                      </span>
                      <span className="text-xs font-medium text-accent sm:mt-1 sm:block">查看判断</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
                <Radar size={24} className="text-text-quaternary" />
                <p className="mt-3 text-sm font-medium text-foreground">暂无增量信号</p>
                <p className="mt-1 text-xs text-muted">基线建立后，实质变化会进入这里。</p>
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Dialog.Content className="fixed inset-x-3 top-[5vh] z-50 max-h-[90vh] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-xl sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">新增竞品监听</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-muted">竞品建档</Dialog.Description>
              </div>
              <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-background" aria-label="关闭">
                <X size={16} />
              </Dialog.Close>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">竞品名称 *</span>
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="例如：SelectBlinds Canada" className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">官网 *</span>
                <input value={form.websiteUrl} onChange={(event) => updateForm("websiteUrl", event.target.value)} placeholder="https://example.com" inputMode="url" className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">目标市场</span>
                <input value={form.targetGeography} onChange={(event) => updateForm("targetGeography", event.target.value)} className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">对标产品</span>
                <input value={form.primaryProduct} onChange={(event) => updateForm("primaryProduct", event.target.value)} placeholder="Motorized Zebra Shades" className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">转化链路</span>
                <select value={form.salesModel} onChange={(event) => updateForm("salesModel", event.target.value)} className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none sm:text-sm">
                  <option>询价报价 + 预约量房</option>
                  <option>线上直接下单</option>
                  <option>线上线下混合模式</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">巡检节奏</span>
                <select value={form.scheduleText} onChange={(event) => updateForm("scheduleText", event.target.value)} className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none sm:text-sm">
                  <option value="weekly">每周</option>
                  <option value="daily">每日</option>
                </select>
              </label>
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-xs font-medium text-foreground">关注重点</span>
                <textarea value={form.watchFocus} onChange={(event) => updateForm("watchFocus", event.target.value)} rows={3} className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white px-3 py-2.5 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              <Dialog.Close className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-border px-4 text-sm font-medium text-foreground hover:bg-background">取消</Dialog.Close>
              <button type="button" onClick={createCompetitor} disabled={!form.name.trim() || !form.websiteUrl.trim() || submitting} className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {submitting ? "建档中" : "建立监听"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(selectedSignal)} onOpenChange={(open) => !open && setSelectedSignal(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Dialog.Content className="fixed inset-x-3 top-[4vh] z-50 max-h-[92vh] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card-bg shadow-xl sm:left-1/2 sm:w-full sm:max-w-3xl sm:-translate-x-1/2">
            {selectedSignal && (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex min-h-6 items-center rounded-[var(--radius-sm)] border px-2 text-[11px] font-medium", SEVERITY_STYLE[selectedSignal.severity])}>{SEVERITY_LABEL[selectedSignal.severity]}</span>
                      <span className="text-xs text-muted">{selectedSignal.competitorName}</span>
                    </div>
                    <Dialog.Title className="mt-2 text-base font-semibold text-foreground">{selectedSignal.title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm leading-6 text-muted">{selectedSignal.summary}</Dialog.Description>
                  </div>
                  <Dialog.Close className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-background" aria-label="关闭"><X size={16} /></Dialog.Close>
                </div>
                <div className="space-y-5 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 text-xs text-muted">
                    <span>捕获时间 {formatTime(selectedSignal.snapshot.capturedAt)}</span>
                    <a href={selectedSignal.snapshot.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">查看证据页 <ExternalLink size={12} /></a>
                  </div>
                  {selectedSignal.analysis?.outputMarkdown ? (
                    <div className="prose-ai max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedSignal.analysis.outputMarkdown}</ReactMarkdown>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">字段差异</h3>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-border bg-background p-3 text-xs leading-5 text-muted">{JSON.stringify(selectedSignal.snapshot.diffJson ?? {}, null, 2)}</pre>
                    </div>
                  )}
                </div>
                {selectedSignal.status === "pending" && (
                  <div className="space-y-3 border-t border-border px-4 py-3 sm:px-5">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={sendToContent}
                        onChange={(e) => setSendToContent(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border"
                      />
                      <span>
                        送内容运营
                        <span className="mt-0.5 block text-xs text-muted">
                          默认开启：确认后生成内容日历选题（待审），不自动发帖
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button type="button" onClick={() => reviewSignal(selectedSignal, "dismissed")} disabled={busyAction === `review:${selectedSignal.id}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border px-4 text-sm font-medium text-muted hover:bg-background disabled:opacity-50"><X size={14} />忽略信号</button>
                      <button type="button" onClick={() => reviewSignal(selectedSignal, "reviewed")} disabled={busyAction === `review:${selectedSignal.id}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">{busyAction === `review:${selectedSignal.id}` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}确认已阅</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
