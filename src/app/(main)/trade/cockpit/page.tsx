"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  FileText,
  BarChart3,
  Target,
  DollarSign,
  Users,
  Mail,
  MessageCircle,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface MetricCard {
  label: string;
  value: number;
  unit?: string;
  trend: number;
  trendLabel: string;
  status: "up" | "down" | "flat";
}

interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  conversionRate: number | null;
}

interface TrendPoint {
  date: string;
  value: number;
}

interface CockpitData {
  metrics: {
    activeProspects: MetricCard;
    replyRate: MetricCard;
    quoteValue: MetricCard;
    wonDeals: MetricCard;
  };
  funnel: {
    stages: FunnelStage[];
    totalProspects: number;
    wonCount: number;
    overallConversion: number;
  };
  roi: {
    totalQuoteValue: number;
    wonQuoteValue: number;
    outreachCount: number;
    replyCount: number;
    replyRate: number;
    estimatedROI: number | null;
    currency: string;
  };
  trends: {
    newProspects: { label: string; data: TrendPoint[] };
    replies: { label: string; data: TrendPoint[] };
    quotesSent: { label: string; data: TrendPoint[] };
  };
  topCampaigns: {
    id: string;
    name: string;
    prospects: number;
    qualified: number;
    contacted: number;
    replyRate: number;
  }[];
  periodLabel: string;
}

interface WeeklyReport {
  weekLabel: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
  generatedAt: string;
}

const METRIC_ICONS: Record<string, typeof TrendingUp> = {
  "活跃线索": Users,
  "回复率": MessageCircle,
  "报价总额": DollarSign,
  "成交客户": Target,
};

function TrendBadge({ card }: { card: MetricCard }) {
  const Icon = card.status === "up" ? TrendingUp : card.status === "down" ? TrendingDown : Minus;
  const color =
    card.status === "up"
      ? "text-emerald-400 bg-emerald-500/10"
      : card.status === "down"
        ? "text-red-400 bg-red-500/10"
        : "text-zinc-400 bg-zinc-500/10";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      <Icon size={12} />
      {card.trendLabel}
    </span>
  );
}

function MetricCardUI({ card }: { card: MetricCard }) {
  const Icon = METRIC_ICONS[card.label] ?? BarChart3;
  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-muted text-sm">
          <Icon size={16} />
          {card.label}
        </div>
        <TrendBadge card={card} />
      </div>
      <div className="text-2xl font-bold text-foreground">
        {card.unit === "USD" ? "$" : ""}
        {card.value.toLocaleString()}
        {card.unit === "%" ? "%" : ""}
      </div>
    </div>
  );
}

function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const widthPct = Math.max((stage.count / maxCount) * 100, 8);
        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <span className="w-24 text-xs text-muted text-right shrink-0">
              {stage.label}
            </span>
            <div className="flex-1 h-7 bg-zinc-800/50 rounded-md overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-blue-600/80 to-blue-500/60 rounded-md transition-all duration-500"
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-foreground">
                {stage.count}
              </span>
            </div>
            {stage.conversionRate !== null && (
              <span className="w-12 text-xs text-muted text-right shrink-0">
                {(stage.conversionRate * 100).toFixed(0)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniSparkline({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const points = data
    .map((d, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - (d.value / max) * 80;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" className="w-full h-12" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-blue-400"
        points={points}
      />
    </svg>
  );
}

function ReportCard({ report }: { report: WeeklyReport }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText size={16} className="text-blue-400" />
          AI 周报 · {report.weekLabel}
        </h3>
        <span className="text-xs text-muted">
          {new Date(report.generatedAt).toLocaleString("zh-CN")}
        </span>
      </div>

      <p className="text-sm text-foreground/90 leading-relaxed">{report.summary}</p>

      {report.highlights.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-emerald-400 mb-1.5 flex items-center gap-1">
            <CheckCircle2 size={12} /> 本周亮点
          </h4>
          <ul className="space-y-1">
            {report.highlights.map((h, i) => (
              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                <ChevronRight size={12} className="mt-0.5 text-emerald-400 shrink-0" />
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.concerns.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-amber-400 mb-1.5 flex items-center gap-1">
            <AlertTriangle size={12} /> 需关注
          </h4>
          <ul className="space-y-1">
            {report.concerns.map((c, i) => (
              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                <ChevronRight size={12} className="mt-0.5 text-amber-400 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.recommendations.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-blue-400 mb-1.5 flex items-center gap-1">
            <Lightbulb size={12} /> AI 建议
          </h4>
          <ul className="space-y-1">
            {report.recommendations.map((r, i) => (
              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                <ChevronRight size={12} className="mt-0.5 text-blue-400 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CockpitPage() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch("/api/cockpit");
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadReport = useCallback(async () => {
    try {
      const res = await apiFetch("/api/cockpit/report");
      if (res.ok) {
        const json = await res.json();
        setReport(json.report);
      }
    } catch { /* ignore */ }
  }, []);

  const generateReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await apiFetch("/api/cockpit/report", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setReport(json.report);
      }
    } catch { /* ignore */ }
    setReportLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    loadReport();
  }, [loadData, loadReport]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        暂无数据
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-0 pb-10">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">老板驾驶舱</h1>
          <p className="text-sm text-muted mt-0.5">{data.periodLabel}</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card-bg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {/* 核心指标卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCardUI card={data.metrics.activeProspects} />
        <MetricCardUI card={data.metrics.replyRate} />
        <MetricCardUI card={data.metrics.quoteValue} />
        <MetricCardUI card={data.metrics.wonDeals} />
      </div>

      {/* 漏斗 + ROI 双栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 漏斗 */}
        <div className="rounded-xl border border-border/60 bg-card-bg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-400" />
            客户漏斗
          </h3>
          <FunnelChart stages={data.funnel.stages.filter((s) => s.count > 0)} />
          <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted">
            <span>总线索: {data.funnel.totalProspects}</span>
            <span>
              总转化率:{" "}
              <strong className="text-foreground">
                {(data.funnel.overallConversion * 100).toFixed(1)}%
              </strong>
            </span>
          </div>
        </div>

        {/* ROI */}
        <div className="rounded-xl border border-border/60 bg-card-bg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-400" />
            ROI 追踪
          </h3>
          <div className="space-y-3">
            <ROIRow icon={Mail} label="发出开发信" value={data.roi.outreachCount} />
            <ROIRow icon={MessageCircle} label="客户回复" value={data.roi.replyCount} />
            <ROIRow
              icon={Mail}
              label="回复率"
              value={`${(data.roi.replyRate * 100).toFixed(1)}%`}
            />
            <div className="border-t border-border/40 pt-2" />
            <ROIRow
              icon={DollarSign}
              label="报价总额"
              value={`$${data.roi.totalQuoteValue.toLocaleString()}`}
            />
            <ROIRow
              icon={CheckCircle2}
              label="成交金额"
              value={`$${data.roi.wonQuoteValue.toLocaleString()}`}
              highlight
            />
            {data.roi.estimatedROI !== null && (
              <ROIRow
                icon={Target}
                label="成交/报价比"
                value={`${(data.roi.estimatedROI * 100).toFixed(0)}%`}
              />
            )}
          </div>
        </div>
      </div>

      {/* 趋势 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["newProspects", "replies", "quotesSent"] as const).map((key) => {
          const series = data.trends[key];
          const last = series.data[series.data.length - 1]?.value ?? 0;
          return (
            <div key={key} className="rounded-xl border border-border/60 bg-card-bg p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">{series.label}</span>
                <span className="text-sm font-semibold text-foreground">{last}</span>
              </div>
              <MiniSparkline data={series.data} />
              <div className="flex justify-between text-[10px] text-muted mt-1">
                {series.data.map((p) => (
                  <span key={p.date}>{p.date.slice(5)}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 热门活动 */}
      {data.topCampaigns.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Target size={16} className="text-purple-400" />
            活动排行
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-border/40">
                  <th className="text-left py-2 font-medium">活动名称</th>
                  <th className="text-right py-2 font-medium">线索</th>
                  <th className="text-right py-2 font-medium">合格</th>
                  <th className="text-right py-2 font-medium">已联系</th>
                  <th className="text-right py-2 font-medium">回复率</th>
                </tr>
              </thead>
              <tbody>
                {data.topCampaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border/20 last:border-0">
                    <td className="py-2 text-foreground">{c.name}</td>
                    <td className="py-2 text-right text-muted">{c.prospects}</td>
                    <td className="py-2 text-right text-muted">{c.qualified}</td>
                    <td className="py-2 text-right text-muted">{c.contacted}</td>
                    <td className="py-2 text-right">
                      <span className={c.replyRate > 0.1 ? "text-emerald-400" : "text-muted"}>
                        {(c.replyRate * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 周报 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">AI 周报</h2>
          <button
            onClick={generateReport}
            disabled={reportLoading}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {reportLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <FileText size={12} />
            )}
            {report ? "重新生成" : "生成周报"}
          </button>
        </div>
        {report ? (
          <ReportCard report={report} />
        ) : (
          <div className="rounded-xl border border-border/60 bg-card-bg p-8 text-center text-sm text-muted">
            {reportLoading ? "正在生成周报..." : "点击「生成周报」获取 AI 分析"}
          </div>
        )}
      </div>
    </div>
  );
}

function ROIRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Mail;
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} /> {label}
      </span>
      <span className={`text-sm font-medium ${highlight ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
