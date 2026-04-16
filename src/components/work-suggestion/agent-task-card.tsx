"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { AgentTaskSuggestion } from "@/lib/ai/schemas";
import { Bot } from "lucide-react";

export function AgentTaskCard({ suggestion, onCreated }: { suggestion: AgentTaskSuggestion; onCreated?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const body: Record<string, string> = {
        intent: suggestion.intent,
        projectId: suggestion.projectId,
      };
      if (suggestion.templateId) body.templateId = suggestion.templateId;

      const result = await apiJson<{ taskId?: string }>("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (result.taskId) {
        await apiFetch(`/api/agent/tasks/${result.taskId}/execute`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      setDone(true);
      onCreated?.();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Bot className="h-4 w-4" />
          <span>AI 任务已创建并开始执行</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          前往项目页「AI 任务」区块查看进度
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium text-foreground">AI 自动化任务</span>
      </div>
      <p className="text-sm text-muted-foreground mb-2">{suggestion.intent}</p>
      {suggestion.project && (
        <p className="text-xs text-muted-foreground mb-3">项目：{suggestion.project}</p>
      )}
      <button
        onClick={handleCreate}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          "bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        )}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
        {loading ? "创建中..." : "创建并执行"}
      </button>
    </div>
  );
}
