"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  Loader2,
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Lightbulb,
  Clock,
  ExternalLink,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface ProjectSummary {
  overallStatus: "green" | "yellow" | "red";
  statusLabel: string;
  summary: string;
  keyProgress: string[];
  risks: string[];
  nextSteps: string[];
  weekHighlight: string;
}

interface ProjectReport {
  projectId: string;
  projectName: string;
  summary: ProjectSummary | null;
  error?: string;
}

interface WeeklyReport {
  generatedAt: string;
  totalProjects: number;
  successCount: number;
  failCount: number;
  projects: ProjectReport[];
}

const STATUS_STYLES = {
  green: {
    bg: "bg-[rgba(46,122,86,0.06)]",
    border: "border-[rgba(46,122,86,0.2)]",
    text: "text-[#2e7a56]",
    dot: "bg-[#2e7a56]",
    label: "正常",
  },
  yellow: {
    bg: "bg-[rgba(154,106,47,0.06)]",
    border: "border-[rgba(154,106,47,0.2)]",
    text: "text-[#9a6a2f]",
    dot: "bg-[#9a6a2f]",
    label: "需关注",
  },
  red: {
    bg: "bg-[rgba(166,61,61,0.06)]",
    border: "border-[rgba(166,61,61,0.2)]",
    text: "text-[#a63d3d]",
    dot: "bg-[#a63d3d]",
    label: "风险",
  },
} as const;

function OverviewBar({ report }: { report: WeeklyReport }) {
  const projects = report.projects.filter((p) => p.summary);
  const green = projects.filter((p) => p.summary!.overallStatus === "green").length;
  const yellow = projects.filter((p) => p.summary!.overallStatus === "yellow").length;
  const red = projects.filter((p) => p.summary!.overallStatus === "red").length;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card-bg px-5 py-4">
      <div className="flex-1">
        <p className="text-sm font-semibold">本期总览</p>
        <p className="mt-0.5 text-xs text-muted">
          共 {report.totalProjects} 个项目，{report.successCount} 个已分析
        </p>
      </div>
      <div className="flex items-center gap-3">
        {green > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(46,122,86,0.15)] bg-[rgba(46,122,86,0.06)] px-2.5 py-1 text-xs font-medium text-[#2e7a56]">
            <CheckCircle2 size={12} />
            {green} 正常
          </span>
        )}
        {yellow > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.06)] px-2.5 py-1 text-xs font-medium text-[#9a6a2f]">
            <AlertTriangle size={12} />
            {yellow} 需关注
          </span>
        )}
        {red > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.06)] px-2.5 py-1 text-xs font-medium text-[#a63d3d]">
            <AlertTriangle size={12} />
            {red} 风险
          </span>
        )}
      </div>
    </div>
  );
}

function ProjectReportCard({ report }: { report: ProjectReport }) {
  const [expanded, setExpanded] = useState(true);

  if (!report.summary) {
    return (
      <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-5 py-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-[#a63d3d]" />
          <span className="text-sm font-medium">{report.projectName}</span>
          <span className="text-xs text-[#a63d3d]">{report.error || "生成失败"}</span>
        </div>
      </div>
    );
  }

  const s = report.summary;
  const style = STATUS_STYLES[s.overallStatus] || STATUS_STYLES.yellow;

  return (
    <div className="rounded-xl border border-border bg-card-bg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/5"
      >
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
        <span className="flex-1 text-sm font-semibold">{report.projectName}</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", style.bg, style.border, style.text)}>
          {s.statusLabel}
        </span>
        <Link
          href={`/projects/${report.projectId}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          详情 <ExternalLink size={10} />
        </Link>
      </button>

      {expanded && (
        <div className="space-y-0 divide-y divide-border border-t border-border">
          <div className="px-5 py-3.5">
            <p className="text-xs leading-relaxed text-foreground">{s.summary}</p>
          </div>

          {s.weekHighlight && (
            <div className="flex items-start gap-2.5 px-5 py-3 bg-[rgba(43,96,85,0.02)]">
              <Lightbulb size={13} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <span className="text-[10px] font-semibold text-accent">本周聚焦</span>
                <p className="text-xs leading-relaxed text-foreground">{s.weekHighlight}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-0 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            {s.keyProgress.length > 0 && (
              <div className="px-5 py-3">
                <h5 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-[#2e7a56]">
                  <CheckCircle2 size={10} /> 关键进展
                </h5>
                <ul className="space-y-1">
                  {s.keyProgress.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#2e7a56]/40" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.risks.length > 0 && (
              <div className="px-5 py-3">
                <h5 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-[#9a6a2f]">
                  <AlertTriangle size={10} /> 风险
                </h5>
                <ul className="space-y-1">
                  {s.risks.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#9a6a2f]/40" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.nextSteps.length > 0 && (
              <div className="px-5 py-3">
                <h5 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-accent">
                  <ArrowRight size={10} /> 下一步
                </h5>
                <ul className="space-y-1">
                  {s.nextSteps.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                      <span className="mt-0.5 shrink-0 text-accent/50">{i + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/reports/weekly", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "生成失败");
      }
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">项目周报</h1>
          <p className="text-sm text-muted">AI 自动分析所有活跃项目，生成结构化进展报告</p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : report ? (
            <RefreshCw size={15} />
          ) : (
            <FileText size={15} />
          )}
          {loading ? "生成中..." : report ? "重新生成" : "生成周报"}
        </button>
      </div>

      {/* Loading */}
      {loading && !report && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card-bg py-16">
          <Loader2 size={24} className="animate-spin text-accent" />
          <p className="text-sm text-muted">正在分析所有项目数据，逐个生成进展摘要...</p>
          <p className="text-xs text-muted/60">可能需要 30 秒至 1 分钟</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-5 py-4 text-sm text-[#a63d3d]">
          {error}
        </div>
      )}

      {/* Empty */}
      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card-bg py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
            <Activity size={24} className="text-accent" />
          </div>
          <p className="text-sm font-medium">一键生成全项目进展周报</p>
          <p className="max-w-md text-center text-xs text-muted">
            AI 将分析每个活跃项目的任务完成、讨论记录、询价进展等数据，输出总体状态评估、关键进展、风险项和建议下一步行动。
          </p>
          <button
            onClick={generate}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <TrendingUp size={15} />
            立即生成
          </button>
        </div>
      )}

      {/* Report Content */}
      {report && (
        <div className="space-y-4">
          <OverviewBar report={report} />

          {/* Sort: red first, then yellow, then green */}
          {report.projects
            .sort((a, b) => {
              const order = { red: 0, yellow: 1, green: 2 };
              const sa = a.summary?.overallStatus ?? "green";
              const sb = b.summary?.overallStatus ?? "green";
              return (order[sa] ?? 3) - (order[sb] ?? 3);
            })
            .map((p) => (
              <ProjectReportCard key={p.projectId} report={p} />
            ))}

          {/* Footer */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-5 py-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Clock size={11} />
              生成于 {new Date(report.generatedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
            </div>
            {loading && (
              <div className="flex items-center gap-1.5 text-xs text-accent">
                <Loader2 size={11} className="animate-spin" />
                正在重新生成...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
