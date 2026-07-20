"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  Wrench,
  GitBranch,
  MessageSquareText,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentStep, AgentStepKind } from "./agent-run-types";

function kindIcon(kind: AgentStepKind, status: AgentStep["status"]) {
  if (status === "running") {
    return <Loader2 size={12} className="animate-spin" />;
  }
  if (status === "error") {
    return <X size={12} strokeWidth={2.5} />;
  }
  if (status === "done") {
    return <Check size={12} strokeWidth={2.5} />;
  }
  switch (kind) {
    case "think":
      return <Sparkles size={12} />;
    case "dispatch":
      return <GitBranch size={12} />;
    case "tool":
      return <Wrench size={12} />;
    case "approve":
      return <ShieldCheck size={12} />;
    case "reply":
      return <MessageSquareText size={12} />;
    default:
      return <Sparkles size={12} />;
  }
}

function statusTone(status: AgentStep["status"]) {
  if (status === "running") {
    return "border-[#2b6055]/25 bg-[#2b6055] text-white shadow-[0_0_0_3px_rgba(43,96,85,0.14)]";
  }
  if (status === "error") {
    return "border-[rgba(166,61,61,0.35)] bg-[#fff7f7] text-[#a63d3d]";
  }
  if (status === "done") {
    return "border-[#2b6055]/20 bg-[#edf3f1] text-[#2b6055]";
  }
  return "border-black/10 bg-white text-[#7c8480]";
}

export function AgentRunPanel({
  steps,
  isStreaming,
  className,
}: {
  steps: AgentStep[];
  isStreaming?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const running = steps.find((s) => s.status === "running");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const errorCount = steps.filter((s) => s.status === "error").length;

  useEffect(() => {
    if (isStreaming) setExpanded(true);
    else if (steps.length > 0) {
      const t = window.setTimeout(() => setExpanded(false), 800);
      return () => window.clearTimeout(t);
    }
  }, [isStreaming, steps.length]);

  if (!steps.length) return null;

  const summary = isStreaming
    ? running
      ? `进行中 · ${running.label}`
      : `青砚处理中 · ${steps.length} 步`
    : errorCount > 0
      ? `已完成 ${doneCount} 步 · ${errorCount} 步异常`
      : `已完成 ${doneCount} 步`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[#2b6055]/12 bg-gradient-to-b from-[#f4f8f6] to-white shadow-[0_8px_24px_rgba(23,40,36,0.06)]",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors active:bg-black/[0.03]"
      >
        <span
          className={cn(
            "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            isStreaming
              ? "bg-[#2b6055] text-white"
              : "bg-[#edf3f1] text-[#2b6055]"
          )}
        >
          {isStreaming ? (
            <>
              <Sparkles size={13} className="relative z-10" />
              <span className="absolute inset-0 animate-ping rounded-lg bg-[#2b6055]/30" />
            </>
          ) : (
            <Check size={14} strokeWidth={2.5} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[#1d2a27]">
            {isStreaming ? "青砚主助手" : "本轮执行"}
          </p>
          <p className="truncate text-[11px] text-[#68706c]">{summary}</p>
        </div>
        <div className="flex items-center gap-1">
          {steps.slice(0, 6).map((s) => (
            <span
              key={s.id}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-all",
                s.status === "running" && "scale-125 animate-pulse bg-[#2b6055]",
                s.status === "done" && "bg-[#2b6055]/55",
                s.status === "error" && "bg-[#a63d3d]",
                s.status === "pending" && "bg-black/15"
              )}
            />
          ))}
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-[#7c8480] transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <ol className="space-y-0 border-t border-[#2b6055]/08 px-2.5 py-2">
            {steps.map((step, index) => {
              const isLast = index === steps.length - 1;
              return (
                <li
                  key={step.id}
                  className="relative flex gap-2.5 px-1 py-1.5 opacity-0 [animation:agentStepIn_0.3s_ease-out_forwards]"
                  style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                >
                  {!isLast && (
                    <span
                      className={cn(
                        "absolute left-[15px] top-7 h-[calc(100%-8px)] w-px",
                        step.status === "done"
                          ? "bg-[#2b6055]/25"
                          : "bg-black/[0.06]"
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-[1] mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-all duration-300",
                      statusTone(step.status)
                    )}
                  >
                    {kindIcon(step.kind, step.status)}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p
                      className={cn(
                        "text-[12px] font-medium leading-snug",
                        step.status === "running" && "text-[#2b6055]",
                        step.status === "error" && "text-[#a63d3d]",
                        (step.status === "done" || step.status === "pending") &&
                          "text-[#252927]"
                      )}
                    >
                      {step.label}
                      {step.status === "running" && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
                        </span>
                      )}
                    </p>
                    {step.detail && (
                      <p className="mt-0.5 text-[11px] text-[#7c8480]">
                        {step.detail}
                      </p>
                    )}
                    {step.kind === "dispatch" && step.status === "done" && (
                      <p className="mt-0.5 text-[10px] text-[#68706c]/90">
                        已把任务分给对应能力处理
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <style>{`
        @keyframes agentStepIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
