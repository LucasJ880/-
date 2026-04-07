"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  FileText,
  Shield,
  DollarSign,
  Mail,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCcw,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

// ── Types ────────────────────────────────────────────────────────

interface StepStatus {
  id: string;
  stepIndex: number;
  skillId: string;
  title: string;
  action?: string;
  status: string;
  success: boolean;
  summary: string;
  data: Record<string, unknown>;
  error?: string | null;
  durationMs?: number | null;
}

interface TaskStatus {
  taskId: string;
  status: string;
  totalSteps: number;
  completedSteps: number;
  success: boolean;
  steps: StepStatus[];
}

// ── Constants ────────────────────────────────────────────────────

const STEP_META: Record<string, { icon: typeof FileText; color: string; bgRunning: string }> = {
  document_summary: { icon: FileText, color: "text-blue-500", bgRunning: "bg-blue-500" },
  intelligence_report: { icon: Shield, color: "text-amber-500", bgRunning: "bg-amber-500" },
  quote: { icon: DollarSign, color: "text-green-500", bgRunning: "bg-green-500" },
  email_draft: { icon: Mail, color: "text-purple-500", bgRunning: "bg-purple-500" },
};

// ── StepCard ─────────────────────────────────────────────────────

function StepCard({ step, isRunning }: { step: StepStatus; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STEP_META[step.skillId] ?? { icon: FileText, color: "text-muted", bgRunning: "bg-muted" };
  const Icon = meta.icon;

  const isPending = step.status === "pending";
  const isFailed = step.status === "failed";

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all",
        isFailed
          ? "border-[rgba(166,61,61,0.3)] bg-[rgba(166,61,61,0.04)]"
          : isRunning
            ? "border-accent/40 bg-accent/[0.03] shadow-sm"
            : isPending
              ? "border-border/50 bg-card-bg/50 opacity-60"
              : "border-border bg-card-bg"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={cn("mt-0.5 shrink-0", isRunning ? "animate-pulse" : "", meta.color)}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">{step.title}</h4>
              {isRunning && (
                <Loader2 size={13} className="animate-spin text-accent shrink-0" />
              )}
              {step.success && (
                <CheckCircle2 size={14} className="text-green-500 shrink-0" />
              )}
              {isFailed && (
                <XCircle size={14} className="text-red-500 shrink-0" />
              )}
              {isPending && !isRunning && (
                <Circle size={14} className="text-muted/40 shrink-0" />
              )}
              {step.durationMs != null && (
                <span className="ml-auto flex items-center gap-1 text-xs text-muted shrink-0">
                  <Clock size={10} />
                  {(step.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {step.summary && (
              <p className="mt-1 text-xs text-muted leading-relaxed">{step.summary}</p>
            )}
            {isRunning && !step.summary && (
              <p className="mt-1 text-xs text-muted">执行中…</p>
            )}
            {step.error && (
              <p className="mt-1 text-xs text-red-500">{step.error}</p>
            )}
          </div>
        </div>
        {step.success && step.data && Object.keys(step.data).length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded p-1 hover:bg-background/80 text-muted"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && step.data && Object.keys(step.data).length > 0 && (
        <div className="mt-3 rounded-md bg-background p-3 text-xs">
          <pre className="whitespace-pre-wrap break-words text-foreground/80 max-h-80 overflow-y-auto">
            {formatData(step.skillId, step.data)}
          </pre>
        </div>
      )}
    </div>
  );
}

function formatData(skillId: string, data: Record<string, unknown>): string {
  if (skillId === "email_draft") {
    const drafts = data.drafts as Array<{ supplierName?: string; subject?: string; body?: string }> | undefined;
    if (drafts && drafts.length > 0) {
      return drafts
        .map((d, i) => {
          const parts: string[] = [];
          if (d.supplierName) parts.push(`收件人: ${d.supplierName}`);
          if (d.subject) parts.push(`主题: ${d.subject}`);
          if (d.body) parts.push(`\n${d.body}`);
          return `--- 邮件 ${i + 1} ---\n${parts.join("\n")}`;
        })
        .join("\n\n");
    }
  }
  if (skillId === "intelligence_report") {
    const { recommendation, riskLevel, fitScore, reportStatus } = data;
    const lines: string[] = [];
    if (recommendation) lines.push(`建议: ${recommendation}`);
    if (riskLevel) lines.push(`风险等级: ${riskLevel}`);
    if (fitScore != null) lines.push(`匹配度: ${fitScore}/100`);
    if (reportStatus) lines.push(`报告状态: ${reportStatus}`);
    if (lines.length > 0) return lines.join("\n");
  }
  if (skillId === "quote") {
    const { draftId, totalAmount, currency, lineItemCount } = data;
    const lines: string[] = [];
    if (draftId) lines.push(`草稿 ID: ${draftId}`);
    if (totalAmount != null) lines.push(`总金额: ${currency ?? ""} ${totalAmount}`);
    if (lineItemCount != null) lines.push(`行项目数: ${lineItemCount}`);
    if (lines.length > 0) return lines.join("\n");
  }
  return JSON.stringify(data, null, 2);
}

// ── Main Component ───────────────────────────────────────────────

export function AiBidPackageSection({ projectId }: { projectId: string }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepStatus[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>("idle");
  const [creating, setCreating] = useState(false);
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef(false);

  // 页面加载时查找是否有最近的未完成任务
  useEffect(() => {
    loadLatestTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadLatestTask = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/ai-bid-package`
      );
      if (!res.ok) return;
      const json = (await res.json()) as TaskStatus & { taskId: string | null };
      if (!json.taskId) return;
      setTaskId(json.taskId);
      setSteps(json.steps ?? []);
      setTaskStatus(json.status ?? "idle");
    } catch {
      // no existing task
    }
  }, [projectId]);

  const handleGenerate = async () => {
    abortRef.current = false;
    setCreating(true);
    setError("");
    setSteps([]);
    setTaskStatus("creating");

    try {
      // 1) 创建任务
      const createRes = await apiFetch(`/api/projects/${projectId}/ai-bid-package`, {
        method: "POST",
      });
      const createJson = await createRes.json();
      if (!createRes.ok) {
        setError(createJson.error ?? "创建任务失败");
        setTaskStatus("idle");
        return;
      }

      const tid = createJson.taskId as string;
      setTaskId(tid);
      setCreating(false);

      // 初始化步骤 UI
      const initialSteps: StepStatus[] = (
        createJson.steps as Array<{ skillId: string; title: string }>
      ).map((s, i) => ({
        id: `pending-${i}`,
        stepIndex: i,
        skillId: s.skillId,
        title: s.title,
        status: "pending",
        success: false,
        summary: "",
        data: {},
      }));
      setSteps(initialSteps);
      setTaskStatus("running");

      // 2) 逐步执行
      for (let i = 0; i < initialSteps.length; i++) {
        if (abortRef.current) break;

        setRunningStep(i);

        const stepRes = await apiFetch(
          `/api/projects/${projectId}/ai-bid-package/run-step`,
          { method: "POST", body: JSON.stringify({ taskId: tid }) }
        );
        const stepJson = await stepRes.json();

        setSteps((prev) =>
          prev.map((s) =>
            s.stepIndex === i
              ? {
                  ...s,
                  status: stepJson.success ? "completed" : "failed",
                  success: !!stepJson.success,
                  summary: stepJson.summary ?? "",
                  data: stepJson.data ?? {},
                  error: stepJson.error,
                  durationMs: stepJson.durationMs,
                }
              : s
          )
        );

        if (!stepJson.success) {
          setTaskStatus("failed");
          setRunningStep(null);
          return;
        }

        if (stepJson.done) break;
      }

      setRunningStep(null);
      setTaskStatus("completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
      setTaskStatus("failed");
    } finally {
      setCreating(false);
      setRunningStep(null);
    }
  };

  const totalSteps = steps.length || 4;
  const completedSteps = steps.filter((s) => s.success).length;
  const isRunning = taskStatus === "running" || creating;
  const isDone = taskStatus === "completed";
  const isFailed = taskStatus === "failed";

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <h3 className="text-sm font-semibold">AI 一键投标方案</h3>
          <span className="text-xs text-muted">
            文档摘要 → 情报分析 → 报价草稿 → 邮件草稿
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(isDone || isFailed) && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isRunning}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/80 transition-colors"
            >
              <RotateCcw size={12} />
              重新生成
            </button>
          )}
          {!isDone && !isFailed && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isRunning}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                isRunning
                  ? "bg-accent/50 text-white cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent-hover"
              )}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  创建中…
                </>
              ) : isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  执行中…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  一键生成
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg border border-[rgba(166,61,61,0.3)] bg-[rgba(166,61,61,0.04)] px-4 py-3">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div className="mt-4 space-y-3">
          {/* Progress bar */}
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>
              {isRunning ? "执行中" : isDone ? "已完成" : isFailed ? "部分完成" : ""}{" "}
              {completedSteps}/{totalSteps} 步
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-background overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  isDone ? "bg-green-500" : isFailed ? "bg-red-400" : "bg-accent"
                )}
                style={{
                  width: `${(completedSteps / totalSteps) * 100}%`,
                }}
              />
            </div>
            {isDone && <span className="text-green-600 font-medium">全部完成</span>}
            {isFailed && <span className="text-red-500 font-medium">执行中断</span>}
          </div>

          {/* Step cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {steps.map((step) => (
              <StepCard
                key={step.stepIndex}
                step={step}
                isRunning={runningStep === step.stepIndex}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
