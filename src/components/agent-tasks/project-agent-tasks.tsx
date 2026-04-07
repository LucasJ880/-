"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Pause,
  ChevronDown,
  ChevronRight,
  Settings,
  HelpCircle,
  Sparkles,
  ArrowRight,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { AgentTaskTimeline } from "./agent-task-timeline";
import { AgentTaskCreateDialog } from "./agent-task-create-dialog";
import { TemplateManager } from "./template-manager";
import { AgentTaskGuide, hasSeenGuide } from "./agent-task-guide";
import { WorkflowStatusBar } from "./workflow-status-bar";
import { ExpertRolePanel } from "./expert-role-panel";

interface TaskStep {
  id: string;
  stepIndex: number;
  skillId: string;
  agentName: string;
  title: string;
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  approvalRequests?: Array<{ deadlineAt: string | null; status: string }>;
}

interface AgentTask {
  id: string;
  taskType: string;
  triggerType: string;
  intent: string;
  riskLevel: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  priority: string;
  requiresApproval: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  steps: TaskStep[];
}

interface FlowTemplateSummary {
  id: string;
  name: string;
  description: string;
  stepCount: number;
}

interface Props {
  projectId: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  draft:                 { icon: Clock,          color: "text-slate-500", label: "草稿" },
  queued:                { icon: Clock,          color: "text-sky-500",   label: "排队中" },
  running:               { icon: Loader2,        color: "text-blue-500",  label: "运行中" },
  waiting_for_subagent:  { icon: Loader2,        color: "text-indigo-500", label: "执行中" },
  waiting_for_tool:      { icon: Loader2,        color: "text-violet-500", label: "调用中" },
  waiting_for_approval:  { icon: AlertTriangle,  color: "text-amber-500", label: "待审批" },
  approved:              { icon: CheckCircle2,   color: "text-emerald-500", label: "已批准" },
  rejected:              { icon: XCircle,        color: "text-red-500",   label: "已驳回" },
  paused:                { icon: Pause,          color: "text-gray-500",  label: "已暂停" },
  failed:                { icon: XCircle,        color: "text-red-500",   label: "失败" },
  completed:             { icon: CheckCircle2,   color: "text-green-500", label: "已完成" },
  cancelled:             { icon: XCircle,        color: "text-gray-400",  label: "已取消" },
};

export function ProjectAgentTasks({ projectId }: Props) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [templates, setTemplates] = useState<FlowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showExpertRoles, setShowExpertRoles] = useState(false);

  // 首次访问且无任务时自动弹出指引
  useEffect(() => {
    if (!loading && tasks.length === 0 && !hasSeenGuide()) {
      const timer = setTimeout(() => setShowGuide(true), 600);
      return () => clearTimeout(timer);
    }
  }, [loading, tasks.length]);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiJson<{ tasks: AgentTask[]; templates: FlowTemplateSummary[] }>(
        `/api/agent/tasks?projectId=${projectId}`
      );
      setTasks(data.tasks ?? []);
      setTemplates(data.templates ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleExecute = useCallback(async (taskId: string) => {
    await apiFetch(`/api/agent/tasks/${taskId}/execute`, { method: "POST", body: JSON.stringify({}) });
    await fetchTasks();
  }, [fetchTasks]);

  const handleCancel = useCallback(async (taskId: string) => {
    await apiFetch(`/api/agent/tasks/${taskId}/cancel`, { method: "POST" });
    await fetchTasks();
  }, [fetchTasks]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>加载 AI 任务...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-foreground">AI 任务</h3>
          {tasks.length > 0 && (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-600">
              {tasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            title="使用指引"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowExpertRoles((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
              showExpertRoles
                ? "bg-violet-500/10 text-violet-600"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
            title="专家角色"
          >
            <Brain className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowTemplateManager((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              showTemplateManager
                ? "bg-accent/10 text-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            )}
            title="管理模板"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
        </div>
      </div>

      {/* 工作流状态总览 */}
      <WorkflowStatusBar tasks={tasks} />

      {/* 专家角色面板 */}
      {showExpertRoles && (
        <div className="border-b border-border/30 px-5 py-4">
          <ExpertRolePanel />
        </div>
      )}

      {/* 模板管理面板 */}
      {showTemplateManager && (
        <div className="border-b border-border/30 px-5 py-4">
          <TemplateManager />
        </div>
      )}

      {/* 任务列表 */}
      <div className="divide-y divide-border/20">
        {tasks.length === 0 ? (
          <div className="px-5 py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10">
                <Sparkles className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">让 AI 帮你自动化工作流</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  描述你的目标，AI 拆解步骤、依次执行，关键节点等你审批
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  创建第一个任务
                </button>
                <button
                  onClick={() => setShowGuide(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  了解更多
                </button>
              </div>

              {/* 快速入口卡片 */}
              <div className="w-full mt-3 grid grid-cols-2 gap-2">
                <QuickStartCard
                  icon="🔍"
                  title="项目巡检"
                  desc="全面检查项目状态"
                  onClick={() => setShowCreate(true)}
                />
                <QuickStartCard
                  icon="📋"
                  title="投标报价"
                  desc="AI 辅助准备报价"
                  onClick={() => setShowCreate(true)}
                />
              </div>
            </div>
          </div>
        ) : (
          tasks.map((task) => {
            const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.draft;
            const Icon = cfg.icon;
            const isExpanded = expandedTask === task.id;
            const completedSteps = task.steps.filter(
              (s) => s.status === "completed" || s.status === "approved" || s.status === "skipped"
            ).length;
            const isRunnable = task.status === "queued";
            const isCancellable = !["completed", "cancelled", "failed"].includes(task.status);

            return (
              <div key={task.id} className="px-5 py-3">
                {/* 任务行 */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    className="flex-shrink-0 p-0.5 hover:bg-accent/50 rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  <Icon
                    className={cn(
                      "h-4 w-4 flex-shrink-0",
                      cfg.color,
                      task.status === "running" || task.status === "waiting_for_subagent"
                        ? "animate-spin"
                        : ""
                    )}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {task.intent.slice(0, 50)}
                      </span>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded-md", {
                        "bg-green-500/10 text-green-600": task.status === "completed",
                        "bg-amber-500/10 text-amber-600": task.status === "waiting_for_approval",
                        "bg-blue-500/10 text-blue-600": task.status === "running" || task.status === "waiting_for_subagent",
                        "bg-red-500/10 text-red-600": task.status === "failed" || task.status === "rejected",
                        "bg-slate-500/10 text-slate-600": !["completed", "waiting_for_approval", "running", "waiting_for_subagent", "failed", "rejected"].includes(task.status),
                      })}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {completedSteps}/{task.totalSteps} 步完成
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", {
                        "bg-green-500": task.status === "completed",
                        "bg-blue-500": task.status === "running" || task.status === "waiting_for_subagent",
                        "bg-amber-500": task.status === "waiting_for_approval",
                        "bg-red-500": task.status === "failed",
                        "bg-slate-400": task.status === "cancelled",
                      })}
                      style={{ width: `${task.totalSteps > 0 ? (completedSteps / task.totalSteps) * 100 : 0}%` }}
                    />
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-1">
                    {isRunnable && (
                      <button
                        onClick={() => handleExecute(task.id)}
                        className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                      >
                        执行
                      </button>
                    )}
                    {isCancellable && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="text-xs px-2 py-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>

                {/* 展开的步骤时间线 */}
                {isExpanded && (
                  <div className="mt-3 ml-8">
                    <AgentTaskTimeline
                      taskId={task.id}
                      steps={task.steps}
                      onRefresh={fetchTasks}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 创建弹窗 */}
      {showCreate && (
        <AgentTaskCreateDialog
          projectId={projectId}
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={fetchTasks}
        />
      )}

      {/* 使用指引 */}
      <AgentTaskGuide
        open={showGuide}
        onClose={() => setShowGuide(false)}
        onCreateTask={() => setShowCreate(true)}
      />
    </div>
  );
}

function QuickStartCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg border border-border/40 px-3 py-2.5 text-left hover:border-border hover:bg-muted/20 transition-colors group"
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight size={12} className="text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
    </button>
  );
}
