"use client";

import { useState, useCallback, useEffect } from "react";
import { Bot, Zap, FileText, Loader2, Workflow, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AgentTaskCreateDialog({
  projectId,
  templates,
  open,
  onOpenChange,
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }, [mode, selectedTemplate, customIntent, projectId, templates, autoExecute, onCreated, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b border-border/30 px-5 py-4 text-left sm:text-left">
          <div className="flex items-center gap-2 pr-6">
            <Bot className="h-5 w-5 shrink-0 text-blue-500" />
            <DialogTitle>新建 AI 任务</DialogTitle>
          </div>
          <DialogDescription>选择预置流程或描述任务意图以创建 AI 任务。</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 模式切换 */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode("template")}
              className={cn(
                "h-auto flex-1 flex-col gap-2 py-2.5",
                mode === "template"
                  ? "border-blue-500 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 hover:text-blue-600"
                  : "border-border/50 text-muted-foreground hover:border-border"
              )}
            >
              <Zap className="h-4 w-4" />
              选择预置流程
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode("custom")}
              className={cn(
                "h-auto flex-1 flex-col gap-2 py-2.5",
                mode === "custom"
                  ? "border-blue-500 bg-blue-500/5 text-blue-600 hover:bg-blue-500/10 hover:text-blue-600"
                  : "border-border/50 text-muted-foreground hover:border-border"
              )}
            >
              <FileText className="h-4 w-4" />
              自由描述意图
            </Button>
          </div>

          {/* 模板列表 */}
          {mode === "template" && (
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {allTemplates.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">暂无可用模板</div>
              ) : (
                allTemplates.map((tpl) => (
                  <Button
                    key={tpl.id}
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedTemplate(tpl.id)}
                    className={cn(
                      "h-auto w-full flex-col items-start gap-0 px-4 py-3 text-left font-normal",
                      selectedTemplate === tpl.id
                        ? "border-blue-500 bg-blue-500/5 hover:bg-blue-500/10"
                        : "border-border/50 hover:border-border"
                    )}
                  >
                    <div className="flex w-full items-center gap-2">
                      {tpl.type === "custom" ? (
                        <Workflow size={13} className="shrink-0 text-blue-500" />
                      ) : (
                        <Sparkles size={13} className="shrink-0 text-accent" />
                      )}
                      <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                      <span className="rounded bg-muted/20 px-1 py-0.5 text-[9px] text-muted-foreground">
                        {tpl.type === "custom" ? "自定义" : "预设"}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-5 text-xs text-muted-foreground">
                      {tpl.description} · {tpl.stepCount} 步
                    </div>
                  </Button>
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
              className="h-28 w-full resize-none rounded-lg border border-border/50 bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}

          {/* 选项 */}
          <div className="flex items-center gap-2">
            <input
              id="agent-task-auto-exec"
              type="checkbox"
              checked={autoExecute}
              onChange={(e) => setAutoExecute(e.target.checked)}
              className="rounded border-border accent-blue-500"
            />
            <Label htmlFor="agent-task-auto-exec" className="text-sm font-normal text-muted-foreground">
              创建后立即开始执行
            </Label>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/5 px-3 py-2 text-sm text-red-500">{error}</div>
          )}
        </div>

        <DialogFooter className="border-t border-border/30 px-5 py-3 sm:space-x-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={
              creating ||
              (mode === "template" && !selectedTemplate) ||
              (mode === "custom" && !customIntent.trim())
            }
            className="bg-blue-500 text-white hover:bg-blue-600"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? "创建中..." : autoExecute ? "创建并执行" : "创建任务"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
