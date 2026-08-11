"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  History,
  ListTodo,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { FormattedActivity } from "@/lib/activity/formatter";
import type { TenderDetailTab } from "@/lib/tender/detail-tabs";

/**
 * 项目内导航目标：五个一级 tab + 两个贯穿抽屉（资料 / 问青砚）。
 * 旧 4-tab 值由 lib/tender/detail-tabs.ts 的别名解析兜底。
 */
export type ProjectContextTarget = TenderDetailTab | "files" | "chat";

export interface ProjectContextPendingAction {
  id: string;
  title: string;
  preview: string;
  expiresAt: string;
}

export interface ProjectContextInput {
  status: string;
  stage: string;
  orgBound: boolean;
  documentCount: number;
  closeDate: string | null;
  riskLevel: string | null;
  riskLabel: string | null;
  isOverdue: boolean;
  completedTasks: number;
  totalTasks: number;
  pendingCount: number;
  hasIntelligence: boolean;
}

interface ContextNotice {
  label: string;
  tone: "neutral" | "warning" | "danger";
}

export interface ProjectCommandState {
  stageLabel: string;
  statusLabel: string;
  statusTone: "neutral" | "success" | "warning" | "danger";
  missingItems: string[];
  risks: ContextNotice[];
  nextAction: {
    label: string;
    reason: string;
    target: ProjectContextTarget;
  };
}

const STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

const TECHNICAL_ACTIVITY_ACTIONS = new Set([
  "runtime_run",
  "runtime_tool",
  "runtime_fail",
]);
const TECHNICAL_ACTIVITY_TARGETS = new Set([
  "runtime",
  "tool",
  "tool_trace",
  "prompt",
  "agent",
  "environment",
]);

export function filterProjectContextActivities(
  activities: FormattedActivity[],
  showTechnical: boolean,
) {
  if (showTechnical) return activities;
  return activities.filter(
    (activity) =>
      !TECHNICAL_ACTIVITY_ACTIONS.has(activity.actionKey) &&
      !TECHNICAL_ACTIVITY_TARGETS.has(activity.targetType),
  );
}

export function deriveProjectCommandState(
  input: ProjectContextInput,
): ProjectCommandState {
  const missingItems: string[] = [];
  const risks: ContextNotice[] = [];

  if (!input.orgBound) missingItems.push("绑定所属企业");
  if (input.documentCount === 0) missingItems.push("上传项目文件");
  if (!input.closeDate) missingItems.push("补充截标日期");
  if (!input.hasIntelligence) missingItems.push("完成项目解读");
  if (input.totalTasks === 0) missingItems.push("建立项目任务");

  if (input.status === "abandoned") {
    risks.push({ label: "项目已放弃，仅保留历史记录", tone: "danger" });
  }
  if (input.isOverdue) {
    risks.push({ label: "项目已逾期，需要立即复核计划", tone: "danger" });
  } else if (input.riskLabel) {
    risks.push({
      label: input.riskLabel,
      tone: input.riskLevel === "high" ? "danger" : "warning",
    });
  }
  if (input.riskLevel === "high" && !input.riskLabel) {
    risks.push({ label: "AI 识别为高风险项目，需人工复核", tone: "danger" });
  }
  if (input.pendingCount > 0) {
    risks.push({
      label: `${input.pendingCount} 项 AI 动作等待人工确认`,
      tone: "warning",
    });
  }

  let nextAction: ProjectCommandState["nextAction"];
  if (input.status === "abandoned") {
    nextAction = {
      label: "查看项目活动记录",
      reason: "项目已停止推进，先确认历史决定和遗留事项。",
      target: "workbench",
    };
  } else if (!input.orgBound) {
    nextAction = {
      label: "完善项目归属",
      reason: "企业归属决定数据范围和后续协作权限。",
      target: "workbench",
    };
  } else if (input.documentCount === 0) {
    nextAction = {
      label: "上传并整理项目文件",
      reason: "缺少源文件时，项目解读、询价和技术标都无法可靠推进。",
      target: "files",
    };
  } else if (!input.hasIntelligence) {
    nextAction = {
      label: "开始项目解读",
      reason: "先确认要求、范围与风险，再推进供应商询价。",
      target: "requirements",
    };
  } else if (input.pendingCount > 0) {
    nextAction = {
      label: "处理待确认动作",
      reason: "AI 只提供草稿，必须由有权限的用户确认后才会执行。",
      target: "workbench",
    };
  } else if (input.stage === "supplier_inquiry") {
    nextAction = {
      label: "跟进供应商报价",
      reason: "当前处于询价阶段，应优先补齐供应商回复。",
      target: "bid",
    };
  } else if (input.stage === "supplier_quote") {
    nextAction = {
      label: "核对报价并准备提交",
      reason: "供应商报价已进入汇总阶段，需要检查缺失项和风险。",
      target: "bid",
    };
  } else {
    nextAction = {
      label: "查看 AI 项目建议",
      reason: "结合当前阶段、文件与最近变化确认下一步。",
      target: "workbench",
    };
  }

  const statusLabel =
    input.status === "active"
      ? "进行中"
      : input.status === "abandoned"
        ? "已放弃"
        : input.status === "archived"
          ? "已归档"
          : input.status;

  return {
    stageLabel: STAGE_LABELS[input.stage] ?? input.stage,
    statusLabel,
    statusTone:
      input.status === "active"
        ? "success"
        : input.status === "abandoned"
          ? "danger"
          : "neutral",
    missingItems,
    risks,
    nextAction,
  };
}

interface ProjectContextPanelProps {
  command: ProjectCommandState;
  completedTasks: number;
  totalTasks: number;
  pendingActions: ProjectContextPendingAction[];
  activities: FormattedActivity[];
  onNavigate: (target: ProjectContextTarget) => void;
}

export function ProjectCommandOverview({
  command,
  pendingCount,
  recentActivity,
  onNavigate,
}: {
  command: ProjectCommandState;
  pendingCount: number;
  recentActivity: FormattedActivity | null;
  onNavigate: (target: ProjectContextTarget) => void;
}) {
  const primaryRisk = command.risks[0]?.label ?? "当前没有需要立即处理的风险";

  return (
    <section
      className="rounded-[var(--radius-xl)] border border-border bg-card-bg p-4 sm:p-5"
      aria-labelledby="project-command-title"
      data-testid="project-command-overview"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
            项目决策摘要
          </p>
          <h2 id="project-command-title" className="mt-1 text-base font-semibold text-foreground">
            当前处于“{command.stageLabel}”阶段
          </h2>
          <p className="mt-1 text-xs text-muted">
            {command.missingItems.length > 0
              ? `还有 ${command.missingItems.length} 项基础信息或工作尚未完成`
              : "关键基础项已补齐"}
          </p>
        </div>
        <Button size="sm" onClick={() => onNavigate(command.nextAction.target)}>
          {command.nextAction.label} <ArrowRight size={13} />
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          icon={AlertTriangle}
          label="主要风险"
          value={primaryRisk}
          tone={command.risks.length > 0 ? "warning" : "neutral"}
        />
        <SummaryCell
          icon={Clock3}
          label="等待确认"
          value={pendingCount > 0 ? `${pendingCount} 项 AI 动作` : "暂无待确认动作"}
          tone={pendingCount > 0 ? "warning" : "neutral"}
        />
        <SummaryCell
          icon={History}
          label="最近变化"
          value={recentActivity?.summary ?? "暂无业务活动记录"}
        />
        <SummaryCell
          icon={Sparkles}
          label="推荐下一步"
          value={command.nextAction.reason}
          tone="accent"
        />
      </div>
    </section>
  );
}

function SummaryCell({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border p-3",
        tone === "warning"
          ? "border-amber-200 bg-amber-50/70"
          : tone === "accent"
            ? "border-accent/20 bg-accent-soft"
            : "border-border bg-background/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <Icon size={13} className={tone === "accent" ? "text-accent" : undefined} />
        {label}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-foreground">
        {value}
      </p>
    </div>
  );
}

export function ProjectContextPanel({
  command,
  completedTasks,
  totalTasks,
  pendingActions,
  activities,
  onNavigate,
}: ProjectContextPanelProps) {
  const completion = totalTasks > 0
    ? Math.round((completedTasks / totalTasks) * 100)
    : 0;

  return (
    <div className="space-y-4" data-testid="project-context-panel">
      <section className="rounded-[var(--radius-lg)] border border-border bg-background/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              当前阶段
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">
              {command.stageLabel}
            </p>
          </div>
          <StatusBadge
            status={command.statusLabel}
            label={command.statusLabel}
            tone={command.statusTone}
          />
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>任务完成</span>
            <span>{completedTasks}/{totalTasks || 0}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-accent/20 bg-accent-soft p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowRight size={15} className="text-accent" />
          推荐下一步
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          {command.nextAction.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          {command.nextAction.reason}
        </p>
        <Button
          size="sm"
          className="mt-3 w-full"
          onClick={() => onNavigate(command.nextAction.target)}
        >
          前往处理 <ArrowRight size={13} />
        </Button>
      </section>

      <ContextSection
        icon={AlertTriangle}
        title="风险"
        empty="当前没有识别到需要立即处理的风险"
        emptyIcon={ShieldCheck}
        hasContent={command.risks.length > 0}
      >
        {command.risks.map((risk) => (
          <div
            key={risk.label}
            className={cn(
              "rounded-[var(--radius-sm)] border px-3 py-2 text-xs leading-5",
              risk.tone === "danger"
                ? "border-danger/20 bg-danger-bg text-danger"
                : risk.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-border bg-background text-muted",
            )}
          >
            {risk.label}
          </div>
        ))}
      </ContextSection>

      <ContextSection
        icon={ListTodo}
        title="尚未完成"
        empty="关键基础项已补齐"
        emptyIcon={CheckCircle2}
        hasContent={command.missingItems.length > 0}
      >
        {command.missingItems.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-foreground">
            <CircleHelp size={13} className="mt-0.5 shrink-0 text-muted" />
            <span>{item}</span>
          </div>
        ))}
      </ContextSection>

      <ContextSection
        icon={Clock3}
        title={`等待确认${pendingActions.length ? ` · ${pendingActions.length}` : ""}`}
        empty="当前项目没有等待确认的 AI 动作"
        emptyIcon={CheckCircle2}
        hasContent={pendingActions.length > 0}
      >
        {pendingActions.slice(0, 3).map((action) => (
          <div key={action.id} className="rounded-[var(--radius-sm)] border border-border bg-background p-3">
            <p className="text-xs font-medium text-foreground">{action.title}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-muted">
              {action.preview}
            </p>
          </div>
        ))}
        {pendingActions.length > 0 ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => onNavigate("workbench")}>
            打开安全确认入口
          </Button>
        ) : null}
      </ContextSection>

      <ContextSection
        icon={History}
        title="最近变化"
        empty="暂无业务活动记录"
        emptyIcon={History}
        hasContent={activities.length > 0}
      >
        {activities.slice(0, 4).map((activity) => (
          <div key={activity.id} className="border-l-2 border-accent/20 pl-3">
            <p className="text-xs leading-5 text-foreground">{activity.summary}</p>
            <p className="mt-0.5 text-[10px] text-muted">
              {activity.actor.name} · {new Date(activity.timestamp).toLocaleDateString("zh-CN", {
                timeZone: "America/Toronto",
              })}
            </p>
          </div>
        ))}
      </ContextSection>

      <Button variant="outline" className="w-full" onClick={() => onNavigate("chat")}>
        <Sparkles size={14} />
        询问青砚项目助手
      </Button>
    </div>
  );
}

function ContextSection({
  icon: Icon,
  title,
  empty,
  emptyIcon: EmptyIcon,
  hasContent,
  children,
}: {
  icon: LucideIcon;
  title: string;
  empty: string;
  emptyIcon: LucideIcon;
  hasContent: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-card-bg p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Icon size={14} className="text-accent/70" />
        {title}
      </h3>
      <div className="mt-3 space-y-2">
        {hasContent ? children : (
          <div className="flex items-center gap-2 text-xs leading-5 text-muted">
            <EmptyIcon size={13} className="shrink-0 text-accent/60" />
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}
