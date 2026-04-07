"use client";

import {
  Upload,
  Brain,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  hasDocuments: boolean;
  hasIntelligence: boolean;
  onGoToFiles: () => void;
  onGoToAi: () => void;
}

interface Step {
  key: string;
  icon: typeof Upload;
  title: string;
  description: string;
  done: boolean;
  active: boolean;
  action?: { label: string; onClick: () => void };
}

export function ProjectOnboardingGuide({
  hasDocuments,
  hasIntelligence,
  onGoToFiles,
  onGoToAi,
}: Props) {
  const allDone = hasDocuments && hasIntelligence;
  if (allDone) return null;

  const steps: Step[] = [
    {
      key: "upload",
      icon: Upload,
      title: "上传项目文件",
      description: "上传招标文件、需求文档等，青砚将自动解析内容。",
      done: hasDocuments,
      active: !hasDocuments,
      action: !hasDocuments ? { label: "去上传", onClick: onGoToFiles } : undefined,
    },
    {
      key: "analyze",
      icon: Brain,
      title: "AI 情报分析",
      description: "基于文件内容，AI 自动生成投标深度情报报告。",
      done: hasIntelligence,
      active: hasDocuments && !hasIntelligence,
      action: hasDocuments && !hasIntelligence
        ? { label: "查看分析", onClick: onGoToFiles }
        : undefined,
    },
    {
      key: "bid",
      icon: Sparkles,
      title: "一键生成投标方案",
      description: "AI 自动生成报价草稿、邮件草稿，一步到位。",
      done: false,
      active: hasDocuments && hasIntelligence,
      action: hasDocuments && hasIntelligence
        ? { label: "开始生成", onClick: onGoToAi }
        : undefined,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="rounded-xl border border-accent/20 bg-gradient-to-br from-accent/[0.03] to-transparent p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">快速开始</h3>
          <p className="text-xs text-muted mt-0.5">
            完成以下步骤，让 AI 帮你准备投标方案
          </p>
        </div>
        <span className="text-xs text-muted">{completedCount}/3</span>
      </div>

      {/* Progress line */}
      <div className="mb-5 h-1 rounded-full bg-border/50 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${(completedCount / 3) * 100}%` }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={cn(
                "relative rounded-lg border p-4 transition-all",
                step.done
                  ? "border-accent/20 bg-accent/[0.03]"
                  : step.active
                    ? "border-accent/40 bg-card-bg shadow-sm"
                    : "border-border/40 bg-card-bg/50 opacity-60"
              )}
            >
              {/* Step number */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    step.done
                      ? "bg-accent text-white"
                      : step.active
                        ? "bg-accent/10 text-accent"
                        : "bg-border/30 text-muted"
                  )}
                >
                  {step.done ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    i + 1
                  )}
                </div>
                <Icon
                  size={14}
                  className={cn(
                    step.done ? "text-accent" : step.active ? "text-accent" : "text-muted"
                  )}
                />
              </div>

              <h4
                className={cn(
                  "text-sm font-medium",
                  step.done && "text-accent"
                )}
              >
                {step.title}
              </h4>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                {step.description}
              </p>

              {step.action && (
                <button
                  type="button"
                  onClick={step.action.onClick}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {step.action.label}
                  <ArrowRight size={11} />
                </button>
              )}

              {step.done && !step.action && (
                <div className="mt-3 flex items-center gap-1 text-xs text-accent font-medium">
                  <CheckCircle2 size={12} />
                  已完成
                </div>
              )}

              {!step.done && !step.active && (
                <div className="mt-3 flex items-center gap-1 text-xs text-muted">
                  <Circle size={12} />
                  待完成
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
