"use client";

import {
  Clock,
  Cpu,
  FileJson,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Brain,
  Zap,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-fetch";
import { SupplyChainCard, type SupplyChainData } from "./supply-chain-card";

interface StepDetail {
  id: string;
  stepIndex: number;
  skillId: string;
  agentName: string;
  title: string;
  status: string;
  riskLevel: string;
  inputJson: string | null;
  outputJson: string | null;
  outputSummary: string | null;
  checkReportJson: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  confidence: number | null;
}

interface Props {
  taskId: string;
  stepId: string;
  skillId: string;
}

export function StepDetailPanel({ taskId, stepId, skillId }: Props) {
  const [detail, setDetail] = useState<StepDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [showCheck, setShowCheck] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiJson<{ task: { steps: StepDetail[] } }>(`/api/agent/tasks/${taskId}`)
      .then((data) => {
        const step = data.task.steps.find((s: StepDetail) => s.id === stepId);
        if (step) setDetail(step);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId, stepId]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground py-2">加载执行详情...</div>
    );
  }

  if (!detail) return null;

  const duration = detail.startedAt && detail.completedAt
    ? Math.round((new Date(detail.completedAt).getTime() - new Date(detail.startedAt).getTime()) / 1000)
    : null;

  const parsedInput = safeJsonParse(detail.inputJson);
  const parsedOutput = safeJsonParse(detail.outputJson);
  const parsedCheck = safeJsonParse(detail.checkReportJson);

  const isSupplyChain = skillId === "supply_chain_analysis" && parsedOutput;

  return (
    <div className="space-y-2">
      {/* Execution Metrics */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {duration !== null && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>耗时 {formatDuration(duration)}</span>
          </div>
        )}
        {detail.confidence !== null && detail.confidence > 0 && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Brain className="h-3 w-3" />
            <span>置信度 {Math.round(detail.confidence * 100)}%</span>
          </div>
        )}
        <div className="flex items-center gap-1 text-muted-foreground">
          <Zap className="h-3 w-3" />
          <span>{detail.skillId}</span>
        </div>
      </div>

      {/* Supply Chain special card */}
      {isSupplyChain && (
        <SupplyChainCard data={parsedOutput as SupplyChainData} stepTitle={detail.title} />
      )}

      {/* Input JSON */}
      {parsedInput && (
        <JsonSection
          icon={ArrowRight}
          title="输入参数"
          data={parsedInput}
          expanded={showInput}
          onToggle={() => setShowInput(!showInput)}
        />
      )}

      {/* Output JSON (skip if supply chain, already displayed as card) */}
      {parsedOutput && !isSupplyChain && (
        <JsonSection
          icon={FileJson}
          title="输出结果"
          data={parsedOutput}
          expanded={showOutput}
          onToggle={() => setShowOutput(!showOutput)}
        />
      )}

      {/* Check Report */}
      {parsedCheck && (
        <JsonSection
          icon={Cpu}
          title="检查报告"
          data={parsedCheck}
          expanded={showCheck}
          onToggle={() => setShowCheck(!showCheck)}
        />
      )}

      {/* Output Summary (if not supply chain) */}
      {detail.outputSummary && !isSupplyChain && (
        <div className="rounded-lg border border-border/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {detail.outputSummary}
        </div>
      )}

      {/* Error */}
      {detail.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
          {detail.error}
        </div>
      )}
    </div>
  );
}

function JsonSection({
  icon: Icon,
  title,
  data,
  expanded,
  onToggle,
}: {
  icon: React.ElementType;
  title: string;
  data: unknown;
  expanded: boolean;
  onToggle: () => void;
}) {
  const preview = typeof data === "object" && data !== null
    ? Object.keys(data).slice(0, 4).join(", ")
    : String(data).slice(0, 50);

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors"
      >
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground flex-1 text-left truncate ml-1">
          {!expanded && `{ ${preview} }`}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/20 bg-slate-50/50 dark:bg-slate-900/30 px-3 py-2">
          <pre className="text-[10px] text-muted-foreground overflow-x-auto leading-relaxed whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function safeJsonParse(str: string | null): Record<string, unknown> | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}
