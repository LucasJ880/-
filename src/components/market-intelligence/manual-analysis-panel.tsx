"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Clipboard,
  Clock3,
  Database,
  FileSearch,
  FlaskConical,
  Globe2,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";

type OutputType =
  | "comprehensive"
  | "competitor-profile"
  | "market-brief"
  | "channel-plan"
  | "workspace-spec"
  | "experiment-backlog";

interface AnalysisForm {
  objective: string;
  targetGeography: string;
  primaryProduct: string;
  salesModel: string;
  competitors: string;
  marketEvidence: string;
  firstPartyData: string;
  unitEconomics: string;
  outputType: OutputType;
}

interface ExecutionItem {
  id: string;
  input: Partial<AnalysisForm>;
  output: string | null;
  durationMs: number | null;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  errorCode: string | null;
  error: string | null;
  modelUsed: string | null;
  fallbackUsed: boolean;
  attempts: number;
}

const EMPTY_FORM: AnalysisForm = {
  objective: "",
  targetGeography: "",
  primaryProduct: "",
  salesModel: "询价报价 + 预约量房",
  competitors: "",
  marketEvidence: "",
  firstPartyData: "",
  unitEconomics: "",
  outputType: "comprehensive",
};

const OUTPUT_LABELS: Record<OutputType, string> = {
  comprehensive: "完整分析",
  "competitor-profile": "竞品画像",
  "market-brief": "市场简报",
  "channel-plan": "渠道策略",
  "workspace-spec": "工作区方案",
  "experiment-backlog": "实验清单",
};

type ResultTab = "analysis" | "evidence" | "experiment";

function markdownSection(content: string, start: string, end?: string) {
  const startIndex = content.indexOf(`## ${start}`);
  if (startIndex < 0) return content;
  const endIndex = end ? content.indexOf(`## ${end}`, startIndex + 3) : -1;
  return content.slice(startIndex, endIndex > startIndex ? endIndex : undefined).trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MarketIntelligencePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [form, setForm] = useState<AnalysisForm>(EMPTY_FORM);
  const [result, setResult] = useState("");
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [recent, setRecent] = useState<ExecutionItem[]>([]);
  const [tab, setTab] = useState<ResultTab>("analysis");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/operations/market-intelligence?orgId=${encodeURIComponent(orgId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载市场情报工作区失败");
      const items = (data.executions ?? []) as ExecutionItem[];
      setRecent(items);
      const pending = items.find((item) => item.status === "queued" || item.status === "running");
      if (pending) {
        setActiveRunId((current) => current || pending.id);
        setExecutionId((current) => current || pending.id);
        setRunning(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgLoading || ambiguous || !orgId) {
      setLoading(false);
      return;
    }
    loadWorkspace();
  }, [ambiguous, loadWorkspace, orgId, orgLoading]);

  useEffect(() => {
    if (!activeRunId || !orgId) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await apiFetch(
          `/api/operations/market-intelligence?orgId=${encodeURIComponent(orgId)}`,
        );
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const items = (data.executions ?? []) as ExecutionItem[];
        setRecent(items);
        const active = items.find((item) => item.id === activeRunId);
        if (!active) return;
        if (active.status === "completed" && active.output) {
          setResult(active.output);
          setExecutionId(active.id);
          setActiveRunId(null);
          setRunning(false);
          setError(null);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (active.status === "failed") {
          setActiveRunId(null);
          setRunning(false);
          setError(active.error || "市场研究任务失败");
        }
      } catch {
        // 短暂断网不终止后台任务，下一轮继续轮询。
      }
    };
    void check();
    const timer = window.setInterval(check, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, orgId]);

  const evidenceCoverage = useMemo(
    () => [
      { label: "竞品样本", ready: Boolean(form.competitors.trim()), icon: Globe2 },
      { label: "渠道信号", ready: Boolean(form.marketEvidence.trim()), icon: Radar },
      { label: "一方数据", ready: Boolean(form.firstPartyData.trim()), icon: Database },
      { label: "单位经济", ready: Boolean(form.unitEconomics.trim()), icon: BarChart3 },
    ],
    [form],
  );

  const visibleResult = useMemo(() => {
    if (!result) return "";
    if (tab === "evidence") {
      return markdownSection(result, "证据与判断", "竞品与渠道拆解");
    }
    if (tab === "experiment") {
      return markdownSection(result, "第一个增长实验", "下一步资料清单");
    }
    return result;
  }, [result, tab]);

  function updateField<K extends keyof AnalysisForm>(key: K, value: AnalysisForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function runAnalysis() {
    if (!orgId || !form.objective.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult("");
    setTab("analysis");
    try {
      const res = await apiFetch("/api/operations/market-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      setExecutionId(data.run.id);
      setActiveRunId(data.run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
      setRunning(false);
    }
  }

  async function copyResult() {
    if (!visibleResult) return;
    await navigator.clipboard.writeText(visibleResult);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function openExecution(item: ExecutionItem) {
    if (item.status !== "completed" || !item.output) return;
    setForm((current) => ({ ...current, ...item.input }));
    setResult(item.output);
    setExecutionId(item.id);
    setTab("analysis");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const formPanel = (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileSearch size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">研究任务</h2>
        </div>
        <p className="mt-1 text-xs text-muted">定义一个决策、一个市场和一个优先产品。</p>
      </div>
      <div className="space-y-4 p-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">需要做出的决策 *</span>
          <textarea
            value={form.objective}
            onChange={(e) => updateField("objective", e.target.value)}
            rows={3}
            placeholder="例如：是否应先在 North York 用智能斑马帘验证线上获客？"
            className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-2.5 text-base text-foreground outline-none placeholder:text-text-quaternary focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">目标市场</span>
            <input
              value={form.targetGeography}
              onChange={(e) => updateField("targetGeography", e.target.value)}
              placeholder="Canada · North York"
              className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white/80 px-3 text-base outline-none placeholder:text-text-quaternary focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">优先产品</span>
            <input
              value={form.primaryProduct}
              onChange={(e) => updateField("primaryProduct", e.target.value)}
              placeholder="Motorized Zebra Shades"
              className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white/80 px-3 text-base outline-none placeholder:text-text-quaternary focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">转化链路</span>
          <select
            value={form.salesModel}
            onChange={(e) => updateField("salesModel", e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white/80 px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
          >
            <option>询价报价 + 预约量房</option>
            <option>线上直接下单</option>
            <option>内容获客 + 私域咨询</option>
            <option>线上线下混合模式</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">对标竞品</span>
          <textarea
            value={form.competitors}
            onChange={(e) => updateField("competitors", e.target.value)}
            rows={3}
            placeholder="每行一个：品牌、网址、对标原因"
            className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-2.5 text-base outline-none placeholder:text-text-quaternary focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">已观察渠道信号</span>
          <textarea
            value={form.marketEvidence}
            onChange={(e) => updateField("marketEvidence", e.target.value)}
            rows={3}
            placeholder="Google Ads、Instagram、Facebook、落地页或内容样本"
            className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-2.5 text-base outline-none placeholder:text-text-quaternary focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
          />
        </label>

        <details className="group rounded-[var(--radius-md)] border border-border bg-background/50">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-foreground">
            一方数据与单位经济
            <span className="ml-2 text-muted group-open:hidden">展开</span>
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            <textarea
              value={form.firstPartyData}
              onChange={(e) => updateField("firstPartyData", e.target.value)}
              rows={3}
              placeholder="询盘、报价、成交、客单价、安装能力"
              aria-label="一方数据"
              className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-2.5 text-base outline-none sm:text-sm"
            />
            <textarea
              value={form.unitEconomics}
              onChange={(e) => updateField("unitEconomics", e.target.value)}
              rows={3}
              placeholder="预算、毛利、目标 CPL/CPA、可承受获客成本"
              aria-label="单位经济"
              className="w-full resize-y rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-2.5 text-base outline-none sm:text-sm"
            />
          </div>
        </details>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">交付格式</span>
          <select
            value={form.outputType}
            onChange={(e) => updateField("outputType", e.target.value as OutputType)}
            className="min-h-11 w-full rounded-[var(--radius-md)] border border-border bg-white/80 px-3 text-base outline-none sm:text-sm"
          >
            {Object.entries(OUTPUT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={runAnalysis}
          disabled={!orgId || !form.objective.trim() || running}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {running ? "深度研究运行中" : "运行市场分析"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-muted">BRAND GROWTH · MARKET INTELLIGENCE</p>
          <h1 className="mt-1 text-2xl font-semibold">市场情报</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            用可追溯证据拆解竞品与渠道，把判断收敛成一个可验证的增长实验。
          </p>
        </div>
        <button
          type="button"
          onClick={loadWorkspace}
          disabled={loading || !orgId}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-3 text-sm font-medium text-foreground hover:bg-white disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          同步记录
        </button>
      </header>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-[var(--radius-md)] border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={cn(result ? "order-2" : "order-1", "xl:order-1")}>
          {formPanel}

          <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-accent" />
                <h2 className="text-sm font-semibold">证据覆盖</h2>
              </div>
            </div>
            <div className="divide-y divide-border">
              {evidenceCoverage.map((item) => (
                <div key={item.label} className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                  <item.icon size={14} className={item.ready ? "text-success" : "text-text-quaternary"} />
                  <span className="flex-1 text-xs text-foreground">{item.label}</span>
                  <span className={cn("text-[11px]", item.ready ? "text-success" : "text-muted")}>
                    {item.ready ? "已提供" : "待补充"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className={cn(result ? "order-1" : "order-2", "min-w-0 xl:order-2")}>
          <div className="min-h-[360px] overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg sm:min-h-[520px]">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Radar size={15} className="shrink-0 text-accent" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">分析工作区</h2>
                  <p className="text-[11px] text-muted">
                    {executionId ? `记录 ${executionId.slice(-8)}` : "尚未运行分析"}
                  </p>
                </div>
              </div>
              {result && (
                <button
                  type="button"
                  onClick={copyResult}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium text-foreground hover:bg-background"
                >
                  {copied ? <CheckCircle2 size={14} className="text-success" /> : <Clipboard size={14} />}
                  {copied ? "已复制" : "复制结果"}
                </button>
              )}
            </div>

            {result && (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
                {[
                  { id: "analysis" as const, label: "决策分析", icon: FileSearch },
                  { id: "evidence" as const, label: "证据台账", icon: Archive },
                  { id: "experiment" as const, label: "实验合同", icon: FlaskConical },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-medium",
                      tab === item.id
                        ? "bg-accent-soft text-accent"
                        : "text-muted hover:bg-background hover:text-foreground",
                    )}
                  >
                    <item.icon size={13} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {running ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center sm:min-h-[420px] sm:px-6">
                <Loader2 className="h-7 w-7 animate-spin text-accent" />
                <p className="mt-4 text-sm font-medium">后台正在整理证据与决策链路</p>
                <p className="mt-1 max-w-md text-xs leading-5 text-muted">
                  深度研究允许使用更长推理时间和最高 16K token。可以离开此页，返回后任务会继续。
                </p>
              </div>
            ) : result ? (
              <div className="prose-ai max-w-none px-4 py-5 sm:px-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleResult}</ReactMarkdown>
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center sm:min-h-[420px] sm:px-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
                  <Radar size={21} />
                </div>
                <p className="mt-4 text-sm font-medium">定义本次需要做出的决策</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                  市场范围和竞品样本越具体，输出的渠道分工与实验边界越清晰。
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock3 size={15} className="text-accent" />
            <h2 className="text-sm font-semibold">历史分析</h2>
          </div>
          <span className="text-[11px] text-muted">组织共享 · 最近 {recent.length} 条</span>
        </div>
        {recent.length > 0 ? (
          <div className="divide-y divide-border">
            {recent.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openExecution(item)}
                disabled={item.status !== "completed" || !item.output}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-background/70 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
                  <FileSearch size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.input.objective || "未命名市场分析"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span className="truncate">
                      {[item.input.targetGeography, item.input.primaryProduct]
                        .filter(Boolean)
                        .join(" · ") || "未设置市场与产品"}
                    </span>
                    {item.status !== "completed" && (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5",
                        item.status === "failed" ? "bg-danger-bg text-danger" : "bg-accent-soft text-accent",
                      )}>
                        {item.status === "queued" ? "排队中" : item.status === "running" ? "研究中" : "失败"}
                      </span>
                    )}
                    {item.fallbackUsed && <span className="text-warning-text">已使用备用模型</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-muted">
                  <span className="block">{formatDate(item.createdAt)}</span>
                  <span className="mt-0.5 block text-text-quaternary">
                    {item.durationMs ? `${Math.max(1, Math.round(item.durationMs / 1000))}s` : `尝试 ${item.attempts} 次`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted">暂无历史分析</div>
        )}
      </section>
    </div>
  );
}
