"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Bot, Zap, FileText, Loader2, Workflow, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface FlowTemplateSummary {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  type?: "preset" | "custom";
}

interface Props {
  projectId: string;
  templates: FlowTemplateSummary[];
  onClose: () => void;
  onCreated: () => void;
}

export function AgentTaskCreateDialog({
  projectId,
  templates,
  onClose,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<"template" | "custom">("template");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [customIntent, setCustomIntent] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoExecute, setAutoExecute] = useState(true);
  const [customTemplates, setCustomTemplates] = useState<FlowTemplateSummary[]>([]);

  useEffect(() => {
    apiJson<{ presets: FlowTemplateSummary[]; custom: FlowTemplateSummary[] }>("/api/agent/templates")
      .then((data) => setCustomTemplates((data.custom ?? []).map((t) => ({ ...t, type: "custom" as const }))))
      .catch(() => {});
  }, []);

  const allTemplates = [
    ...templates.map((t) => ({ ...t, type: "preset" as const })),
    ...customTemplates,
  ];

  const handleCreate = useCallback(async () => {
    const intent =
      mode === "template"
        ? allTemplates.find((t) => t.id === selectedTemplate)?.name ?? ""
        : customIntent.trim();

    if (!intent) {
      setError("请选择模板或输入任务描述");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const body: Record<string, string> = { intent, projectId };
      if (mode === "template" && selectedTemplate) {
        body.templateId = selectedTemplate;
      }

      const result = await apiJson<{ taskId?: string }>("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // 如果 autoExecute，直接开始执行
      if (autoExecute && result.taskId) {
        await apiFetch(`/api/agent/tasks/${result.taskId}/execute`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }, [mode, selectedTemplate, customIntent, projectId, templates, autoExecute, onCreated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-500" />
            <h3 className="font-semibold text-foreground">新建 AI 任务</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent/50 rounded">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* 模式切换 */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("template")}
              className={cn(
                "flex-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                mode === "template"
                  ? "border-blue-500 bg-blue-500/5 text-blue-600"
                  : "border-border/50 text-muted-foreground hover:border-border"
              )}
            >
              <Zap className="h-4 w-4" />
              选择预置流程
            </button>
            <button
              onClick={() => setMode("custom")}
              className={cn(
                "flex-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                mode === "custom"
                  ? "border-blue-500 bg-blue-500/5 text-blue-600"
                  : "border-border/50 text-muted-foreground hover:border-border"
              )}
            >
              <FileText className="h-4 w-4" />
              自由描述意图
            </button>
          </div>

          {/* 模板列表 */}
          {mode === "template" && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {allTemplates.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  暂无可用模板
                </div>
              ) : (
                allTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => setSelectedTemplate(tpl.id)}
                    className={cn(
                      "w-full text-left rounded-lg border px-4 py-3 transition-colors",
                      selectedTemplate === tpl.id
                        ? "border-blue-500 bg-blue-500/5"
                        : "border-border/50 hover:border-border"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {tpl.type === "custom" ? (
                        <Workflow size={13} className="text-blue-500 shrink-0" />
                      ) : (
                        <Sparkles size={13} className="text-accent shrink-0" />
                      )}
                      <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                      <span className="text-[9px] text-muted-foreground bg-muted/20 rounded px-1 py-0.5">
                        {tpl.type === "custom" ? "自定义" : "预设"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 pl-5">
                      {tpl.description} · {tpl.stepCount} 步
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* 自由输入 */}
          {mode === "custom" && (
            <textarea
              value={customIntent}
              onChange={(e) => setCustomIntent(e.target.value)}
              placeholder="描述你希望 AI 完成的任务，例如：&#10;• 帮我准备这个项目的投标报价&#10;• 全面检查项目状态和风险&#10;• 生成项目进展摘要"
              className="w-full h-28 rounded-lg border border-border/50 bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          )}

          {/* 选项 */}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={(e) => setAutoExecute(e.target.checked)}
              className="rounded"
            />
            创建后立即开始执行
          </label>

          {error && (
            <div className="text-sm text-red-500 bg-red-500/5 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border/30 px-5 py-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={
              creating ||
              (mode === "template" && !selectedTemplate) ||
              (mode === "custom" && !customIntent.trim())
            }
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? "创建中..." : autoExecute ? "创建并执行" : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  );
}
