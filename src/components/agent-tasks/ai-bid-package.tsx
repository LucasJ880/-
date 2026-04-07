"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  ExternalLink,
  Copy,
  Check,
  Save,
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

interface StepCardProps {
  step: StepStatus;
  isRunning: boolean;
  projectId: string;
  onTabSwitch?: (tab: string) => void;
}

function StepCard({ step, isRunning, projectId, onTabSwitch }: StepCardProps) {
  const router = useRouter();
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

      {/* Actions: contextual buttons per skill type */}
      {step.success && (
        <StepActions step={step} projectId={projectId} onTabSwitch={onTabSwitch} router={router} />
      )}

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

// ── StepActions ──────────────────────────────────────────────────

function StepActions({
  step,
  projectId,
  onTabSwitch,
  router,
}: {
  step: StepStatus;
  projectId: string;
  onTabSwitch?: (tab: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [saving, setSaving] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (step.skillId === "intelligence_report") {
    const recommendation = step.data.recommendation as string | undefined;
    const riskLevel = step.data.riskLevel as string | undefined;
    const fitScore = step.data.fitScore as number | undefined;
    const recLabel: Record<string, string> = { pursue: "建议跟进", review_carefully: "需仔细评估", low_probability: "低概率", skip: "建议跳过" };
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {recommendation && (
            <span className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              recommendation === "pursue" ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]" :
              recommendation === "skip" ? "bg-[rgba(166,61,61,0.1)] text-[#a63d3d]" :
              "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]"
            )}>
              {recLabel[recommendation] ?? recommendation}
            </span>
          )}
          {riskLevel && <span className="text-muted">风险: {riskLevel}</span>}
          {fitScore != null && <span className="font-medium">匹配度 {fitScore}%</span>}
        </div>
        <button
          type="button"
          onClick={() => onTabSwitch?.("overview")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/80 transition-colors"
        >
          <ExternalLink size={12} />
          查看完整情报报告
        </button>
      </div>
    );
  }

  if (step.skillId === "quote") {
    const draft = step.data.draft as Record<string, unknown> | undefined;
    const templateType = step.data.templateType as string | undefined;
    const lines = draft && Array.isArray((draft as Record<string, unknown>).lines) ? (draft as Record<string, unknown>).lines as unknown[] : [];

    return (
      <div className="mt-3 space-y-2">
        {lines.length > 0 && (
          <p className="text-xs text-muted">{lines.length} 个行项目</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {savedQuoteId ? (
            <button
              type="button"
              onClick={() => router.push(`/projects/${projectId}/quotes/${savedQuoteId}`)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <ExternalLink size={12} />
              打开报价编辑器
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || !draft}
              onClick={async () => {
                if (!draft) return;
                setSaving(true);
                try {
                  const res = await apiFetch(`/api/projects/${projectId}/quotes/save-ai-draft`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ draft, templateType }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setSavedQuoteId(data.quoteId);
                  }
                } finally {
                  setSaving(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              保存为报价单
            </button>
          )}
          <button
            type="button"
            onClick={() => onTabSwitch?.("quotes")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/80 transition-colors"
          >
            <DollarSign size={12} />
            查看所有报价
          </button>
        </div>
      </div>
    );
  }

  if (step.skillId === "email_draft") {
    const drafts = step.data.drafts as Array<{ supplierName?: string; subject?: string; body?: string }> | undefined;
    if (!drafts || drafts.length === 0) return null;

    const handleCopy = async (idx: number) => {
      const d = drafts[idx];
      const text = [d.subject ? `主题: ${d.subject}` : "", d.body ?? ""].filter(Boolean).join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    };

    return (
      <div className="mt-3 space-y-2">
        {drafts.map((d, i) => (
          <div key={i} className="rounded-md border border-border/60 bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {d.supplierName && (
                  <p className="text-xs font-medium text-foreground">{d.supplierName}</p>
                )}
                {d.subject && (
                  <p className="text-xs text-muted mt-0.5">主题: {d.subject}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(i)}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-card-bg transition-colors"
              >
                {copiedIdx === i ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                {copiedIdx === i ? "已复制" : "复制"}
              </button>
            </div>
            {d.body && (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground/80 leading-relaxed max-h-40 overflow-y-auto">{d.body}</pre>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (step.skillId === "document_summary") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => onTabSwitch?.("files")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/80 transition-colors"
        >
          <FileText size={12} />
          查看文件列表
        </button>
      </div>
    );
  }

  return null;
}

// ── formatData (for raw expand) ─────────────────────────────────

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
    const draft = data.draft as Record<string, unknown> | undefined;
    const lines: string[] = [];
    if (draft) {
      const header = (draft.header ?? draft) as Record<string, unknown>;
      if (header.title) lines.push(`标题: ${header.title}`);
      if (header.currency) lines.push(`币种: ${header.currency}`);
      const lineItems = Array.isArray(draft.lines) ? draft.lines : [];
      lines.push(`行项目数: ${lineItems.length}`);
    }
    if (lines.length > 0) return lines.join("\n");
  }
  return JSON.stringify(data, null, 2);
}

// ── Main Component ───────────────────────────────────────────────

export function AiBidPackageSection({ projectId, onTabSwitch }: { projectId: string; onTabSwitch?: (tab: string) => void }) {
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
                projectId={projectId}
                onTabSwitch={onTabSwitch}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
