"use client";

import {
  Upload,
  Brain,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Circle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TenderWorkbenchState,
  WbStepState,
  WbTarget,
} from "@/lib/tender/workbench-state";

interface Props {
  /** canonical 工作台状态投影（单一事实源） */
  state: TenderWorkbenchState;
  onNavigate: (target: WbTarget) => void;
}

const STEP_ICONS = [Upload, Brain, Sparkles] as const;

function StatusMark({ state }: { state: WbStepState }) {
  if (state === "done")
    return (
      <div className="mt-3 flex items-center gap-1 text-xs font-medium text-accent">
        <CheckCircle2 size={12} />
        已完成
      </div>
    );
  if (state === "processing")
    return (
      <div className="mt-3 flex items-center gap-1 text-xs text-sky-700">
        <Loader2 size={12} className="animate-spin" />
        进行中
      </div>
    );
  if (state === "active") return null; // CTA 会渲染
  return (
    <div className="mt-3 flex items-center gap-1 text-xs text-muted">
      <Circle size={12} />
      待完成
    </div>
  );
}

/**
 * 快速开始 —— 纯状态投影，不做第二套上传/分析系统，也不伪造状态。
 * 详细实时进度由顶部 AnalysisProgressBanner 展示；这里只做工作流状态 + 单步导航。
 */
export function ProjectOnboardingGuide({ state, onNavigate }: Props) {
  const { steps, completedSteps } = state;

  return (
    <div className="rounded-xl border border-accent/20 bg-gradient-to-br from-accent/[0.03] to-transparent p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">快速开始</h3>
          <p className="mt-0.5 text-xs text-muted">
            完成以下步骤，让 AI 帮你准备投标方案
          </p>
        </div>
        <span className="text-xs text-muted" data-testid="quickstart-progress">
          {completedSteps}/3
        </span>
      </div>

      <div className="mb-5 h-1 overflow-hidden rounded-full bg-border/50">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${(completedSteps / 3) * 100}%` }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => {
          const Icon = STEP_ICONS[i] ?? Upload;
          const done = step.state === "done";
          const active = step.state === "active" || step.state === "processing";
          return (
            <div
              key={step.key}
              data-testid={`quickstart-step-${i + 1}`}
              data-step-state={step.state}
              className={cn(
                "relative rounded-lg border p-4 transition-all",
                done
                  ? "border-accent/20 bg-accent/[0.03]"
                  : active
                    ? "border-accent/40 bg-card-bg shadow-sm"
                    : "border-border/40 bg-card-bg/50 opacity-60",
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    done
                      ? "bg-accent text-[color:var(--on-accent)]"
                      : active
                        ? "bg-accent/10 text-accent"
                        : "bg-border/30 text-muted",
                  )}
                >
                  {done ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <Icon
                  size={14}
                  className={cn(done || active ? "text-accent" : "text-muted")}
                />
              </div>

              <h4 className={cn("text-sm font-medium", done && "text-accent")}>
                {step.title}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {step.caption}
              </p>

              {step.cta ? (
                <button
                  type="button"
                  onClick={() => onNavigate(step.cta!.target)}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover"
                >
                  {step.cta.label}
                  <ArrowRight size={11} />
                </button>
              ) : (
                <StatusMark state={step.state} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
