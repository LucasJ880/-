"use client";

import { useState } from "react";
import {
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface ChecklistItem {
  title: string;
  status: "done" | "in_progress" | "todo" | "at_risk";
  note: string;
}

interface ChecklistCategory {
  name: string;
  items: ChecklistItem[];
}

interface ChecklistData {
  categories: ChecklistCategory[];
  overallReadiness: number;
  criticalBlockers: string[];
  recommendation: string;
  generatedAt: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string; bg: string }> = {
  done: {
    icon: CheckCircle2,
    color: "text-[#2e7a56]",
    label: "已完成",
    bg: "bg-[rgba(46,122,86,0.08)]",
  },
  in_progress: {
    icon: Clock,
    color: "text-accent",
    label: "进行中",
    bg: "bg-[rgba(43,96,85,0.08)]",
  },
  todo: {
    icon: Circle,
    color: "text-muted",
    label: "待开始",
    bg: "bg-[rgba(110,125,118,0.06)]",
  },
  at_risk: {
    icon: AlertTriangle,
    color: "text-[#a63d3d]",
    label: "有风险",
    bg: "bg-[rgba(166,61,61,0.08)]",
  },
};

function ReadinessBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-[#2e7a56]"
      : value >= 40
        ? "bg-[#9a6a2f]"
        : "bg-[#a63d3d]";

  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[rgba(110,125,118,0.1)]">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className={cn(
        "text-sm font-bold tabular-nums",
        value >= 70 ? "text-[#2e7a56]" : value >= 40 ? "text-[#9a6a2f]" : "text-[#a63d3d]"
      )}>
        {value}%
      </span>
    </div>
  );
}

function CategorySection({ category }: { category: ChecklistCategory }) {
  const [open, setOpen] = useState(true);
  const doneCount = category.items.filter((i) => i.status === "done").length;
  const riskCount = category.items.filter((i) => i.status === "at_risk").length;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-background/50"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
          <span className="text-sm font-semibold">{category.name}</span>
          <span className="text-xs text-muted">
            {doneCount}/{category.items.length}
          </span>
          {riskCount > 0 && (
            <span className="rounded-full bg-[rgba(166,61,61,0.1)] px-1.5 py-0.5 text-[10px] font-medium text-[#a63d3d]">
              {riskCount} 项风险
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60">
          {category.items.map((item, i) => {
            const config = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.todo;
            const Icon = config.icon;

            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-3 px-4 py-2.5",
                  i < category.items.length - 1 && "border-b border-border/40"
                )}
              >
                <div className={cn("mt-0.5 shrink-0", config.color)}>
                  <Icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-sm",
                    item.status === "done" && "text-muted line-through"
                  )}>
                    {item.title}
                  </p>
                  {item.note && (
                    <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
                      {item.note}
                    </p>
                  )}
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  config.bg, config.color
                )}>
                  {config.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  projectId: string;
}

export function BidChecklist({ projectId }: Props) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function generate() {
    setLoading(true);
    setError("");
    apiFetch(`/api/projects/${projectId}/checklist`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) {
          setError(res.error);
        } else {
          setData(res);
        }
      })
      .catch(() => setError("生成失败，请稍后重试"))
      .finally(() => setLoading(false));
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-accent" />
          <h3 className="text-sm font-semibold">投标准备清单</h3>
          {data && (
            <span className="text-xs text-muted">
              就绪度 {data.overallReadiness}%
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            data
              ? "border border-border bg-background text-foreground hover:bg-background/80"
              : "bg-accent text-white hover:bg-accent-hover",
            loading && "opacity-50"
          )}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : data ? (
            <RefreshCw size={12} />
          ) : (
            <Sparkles size={12} />
          )}
          {data ? "重新生成" : "AI 生成清单"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-3 py-2 text-xs text-[#a63d3d]">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-6 flex flex-col items-center gap-2 py-8">
          <Loader2 size={24} className="animate-spin text-accent/40" />
          <p className="text-sm text-muted">AI 正在分析项目数据...</p>
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <ReadinessBar value={data.overallReadiness} />

          {data.criticalBlockers.length > 0 && (
            <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] px-4 py-3">
              <p className="text-xs font-semibold text-[#a63d3d]">关键阻塞项</p>
              <ul className="mt-1.5 space-y-1">
                {data.criticalBlockers.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#a63d3d]">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {data.categories.map((cat, i) => (
              <CategorySection key={i} category={cat} />
            ))}
          </div>

          <div className="rounded-lg bg-accent/5 px-4 py-3">
            <p className="text-xs font-medium text-accent">AI 建议</p>
            <p className="mt-1 text-xs text-foreground leading-relaxed">
              {data.recommendation}
            </p>
          </div>

          <p className="text-right text-[10px] text-muted">
            生成于 {new Date(data.generatedAt).toLocaleString("zh-CN")}
          </p>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="mt-4 flex flex-col items-center gap-2 py-6 text-center">
          <ClipboardCheck size={24} className="text-accent/20" />
          <p className="text-xs text-muted">
            AI 将根据项目当前状态自动生成投标准备检查清单
          </p>
        </div>
      )}
    </div>
  );
}
