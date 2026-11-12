"use client";

import { BarChart3, AlertCircle, Clock, CheckCircle2, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenderProject, TenderStage } from "@/lib/tender/types";
import {
  laterStage,
  getProjectStage,
  getProjectStageStatus,
  getStageSteps,
  getProjectCompletion,
  resolveCloseDate,
  formatCountdown,
} from "@/lib/tender/stage";
import { buildProjectTimelineEvents } from "@/lib/tender/timeline";
import { ProjectStageStepper } from "./project-stage-stepper";
import { ProjectTimeline } from "./project-timeline";
import { ProjectKeyDates } from "./project-key-dates";

const STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; cls: string; icon: React.ReactNode }
> = {
  in_progress: {
    label: "进行中",
    cls: "bg-accent/10 text-accent",
    icon: <Timer size={12} />,
  },
  completed: {
    label: "已完成",
    cls: "bg-success-light text-success-text",
    icon: <CheckCircle2 size={12} />,
  },
  due_soon: {
    label: "即将截止",
    cls: "bg-warning-light text-warning-text",
    icon: <Clock size={12} />,
  },
  overdue: {
    label: "已逾期",
    cls: "bg-danger-light text-danger-text",
    icon: <AlertCircle size={12} />,
  },
};

export function ProjectProgressSection({
  project,
  projectId,
  canManage,
  onUpdated,
  actualStage,
}: {
  project: TenderProject;
  projectId?: string;
  canManage?: boolean;
  onUpdated?: () => void;
  /** FLOW-H1b：按实际进度到达的阶段（来自「下一步」接口）；没有时只用记录的阶段，与原来相同 */
  actualStage?: TenderStage | null;
}) {
  // 显示的阶段 = 记录的阶段与实际到达的阶段里靠后的那个。只改显示，不写阶段记录
  const recordedStage = getProjectStage(project);
  const currentStage = laterStage(recordedStage, actualStage);
  const stageStatus = getProjectStageStatus(project);
  const stages = getStageSteps(project, currentStage);
  const completion = getProjectCompletion(project, currentStage);
  const timelineEvents = buildProjectTimelineEvents(project);
  const closeDate = resolveCloseDate(project);
  const countdown = closeDate ? formatCountdown(closeDate) : null;
  const statusCfg = STATUS_CONFIG[stageStatus] || STATUS_CONFIG.in_progress;

  const isOverdueNotSubmitted =
    stageStatus === "overdue" && !project.submittedAt;

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card-bg p-5">
      {/* ===== A. 顶部摘要区 ===== */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 size={16} className="text-accent/60" />
            项目进度
          </h3>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              statusCfg.cls
            )}
          >
            {statusCfg.icon}
            {statusCfg.label}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted">当前阶段：</span>
            <span className="font-semibold text-foreground">
              {STAGE_LABELS[currentStage] || currentStage}
            </span>
          </div>
          <div>
            <span className="text-muted">完成进度：</span>
            <span className={cn(
              "font-semibold",
              completion >= 100 ? "text-success-text" : "text-foreground"
            )}>
              {completion}%
            </span>
          </div>
          {countdown && (
            <div>
              <span className="text-muted">距离截标：</span>
              <span
                className={cn(
                  "font-semibold",
                  countdown.isOverdue
                    ? "text-danger-text"
                    : countdown.isDueSoon
                      ? "text-warning-text"
                      : "text-foreground"
                )}
              >
                {countdown.text}
              </span>
            </div>
          )}
        </div>

        {currentStage !== recordedStage && (
          <p className="mt-2 text-xs text-muted" data-testid="progress-stage-note">
            这里显示的是按实际进度得出的阶段。记录的阶段还是「{STAGE_LABELS[recordedStage] || recordedStage}」——阶段记录没有自动推进，别处（项目列表等）看到的仍是记录的阶段。
          </p>
        )}

        {/* Overdue warning banner */}
        {isOverdueNotSubmitted && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger-text">
            <AlertCircle size={16} />
            <span className="font-medium">项目已逾期，尚未提交</span>
          </div>
        )}

        {/* Key date chips */}
        <div className="mt-3">
          <ProjectKeyDates
            project={project}
            projectId={projectId}
            canManage={canManage}
            onUpdated={onUpdated}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* ===== B. 流程进度 Stepper ===== */}
      <div>
        <h4 className="mb-3 text-xs font-medium text-muted">流程阶段</h4>
        <ProjectStageStepper stages={stages} completion={completion} />
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* ===== C. 真实时间轴 ===== */}
      <div>
        <h4 className="mb-3 text-xs font-medium text-muted">时间轴</h4>
        <ProjectTimeline events={timelineEvents} />
      </div>
    </div>
  );
}
