"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { StageAdvanceSuggestion } from "@/lib/ai/schemas";
import { ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

export function StageAdvanceCard({
  suggestion,
  onCreated,
}: {
  suggestion: StageAdvanceSuggestion;
  onCreated?: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [serverMessage, setServerMessage] = useState("");

  const targetLabel = STAGE_LABELS[suggestion.targetStage] || suggestion.targetStage;
  const projectName = suggestion.project || "当前项目";

  const handleAdvance = async () => {
    if (!suggestion.projectId) {
      setServerMessage("缺少项目 ID，无法推进");
      setState("error");
      return;
    }
    setState("loading");
    try {
      const res = await apiFetch(`/api/projects/${suggestion.projectId}/advance-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStage: suggestion.targetStage,
          reason: suggestion.reason,
          source: "ai_suggestion",
          humanConfirmed: true,
        }),
      });
      const data = await res.json();
      if (data.decision === "deny" || !res.ok) {
        setServerMessage(data.reason || data.error || "推进失败");
        setState("error");
        return;
      }
      setServerMessage(data.reason || (data.decision === "no_op" ? "已在该阶段" : "推进成功"));
      setState("done");
      onCreated?.();
    } catch (err) {
      setServerMessage(err instanceof Error ? err.message : "请求失败");
      setState("error");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 text-sm">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-accent" />
        <span className="font-semibold">阶段推进建议</span>
        {suggestion.confidence >= 0.9 && (
          <span className="rounded-full bg-[rgba(75,130,110,0.08)] px-2 py-0.5 text-[11px] text-[#4b826e]">
            高置信
          </span>
        )}
        {suggestion.confidence < 0.7 && (
          <span className="rounded-full bg-[rgba(154,106,47,0.08)] px-2 py-0.5 text-[11px] text-[#9a6a2f]">
            待确认
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg bg-background p-3">
        <span className="text-muted">{projectName}</span>
        <ArrowRight size={14} className="text-accent" />
        <span className="font-medium text-accent">{targetLabel}</span>
      </div>

      <div className="mb-2 text-xs text-muted">
        <span className="font-medium text-foreground">推进理由：</span>
        {suggestion.reason}
      </div>

      {suggestion.evidence.length > 0 && (
        <div className="mb-3 space-y-1">
          <span className="text-xs font-medium">依据：</span>
          {suggestion.evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted">
              <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent/50" />
              {e}
            </div>
          ))}
        </div>
      )}

      {suggestion.confidence < 0.7 && state === "idle" && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-[rgba(154,106,47,0.06)] px-3 py-2 text-xs text-[#9a6a2f]">
          <AlertTriangle size={12} />
          AI 置信度较低，请仔细确认后再推进
        </div>
      )}

      {serverMessage && state !== "idle" && (
        <div className={cn(
          "mb-3 rounded-lg px-3 py-2 text-xs",
          state === "error"
            ? "bg-[rgba(166,61,61,0.06)] text-[#a63d3d]"
            : "bg-[rgba(75,130,110,0.06)] text-[#4b826e]"
        )}>
          {serverMessage}
        </div>
      )}

      <div className="flex gap-2">
        {state === "idle" && (
          <>
            <button
              onClick={handleAdvance}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              确认推进到「{targetLabel}」
            </button>
            <button
              onClick={() => setState("done")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-background"
            >
              暂不推进
            </button>
          </>
        )}
        {state === "loading" && (
          <button disabled className="flex items-center gap-1.5 rounded-lg bg-accent/60 px-3 py-1.5 text-xs text-white">
            <Loader2 size={12} className="animate-spin" />
            推进中...
          </button>
        )}
        {state === "done" && (
          <div className="flex items-center gap-1.5 text-xs text-[#4b826e]">
            <CheckCircle2 size={14} />
            {serverMessage || "已处理"}
          </div>
        )}
        {state === "error" && (
          <button
            onClick={() => { setState("idle"); setServerMessage(""); }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-background"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
