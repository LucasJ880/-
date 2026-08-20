"use client";

/**
 * Tab 2「招标要求」— Requirement + Evidence + Compliance 同一工作空间（T1A）。
 * 复用 TenderAnalysisPanel（要求/风险/澄清/解读/来源，逐条确认 + 行内证据），
 * 顶部为分析运行状态条；正式澄清（RFI）入口从旧报价 tab 移入。
 */

import { useState } from "react";
import { FileQuestion } from "lucide-react";
import { TenderAnalysisPanel } from "@/components/tender-analysis/analysis-panel";
import { BidFitMatrixCard } from "@/components/tender-analysis/bid-fit-matrix-card";
import { AnalysisProgressBanner } from "@/components/tender-analysis/analysis-progress-banner";
import { ProjectQuestionDialog } from "@/components/project-question/project-question-dialog";
import { ProjectQuestionStatusList } from "@/components/project-question/project-question-status-list";

interface RequirementsTabProps {
  projectId: string;
  canManage: boolean;
  projectStatus: string;
}

export function RequirementsTab({ projectId, canManage, projectStatus }: RequirementsTabProps) {
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);

  return (
    <div className="space-y-6">
      <AnalysisProgressBanner projectId={projectId} showDetailLink={false} />

      {/* 批次一：投标合规矩阵（已有/可开发/需Partner/需RFI/No-Go 一眼观） */}
      <BidFitMatrixCard projectId={projectId} canManage={canManage} />

      <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5">
        <TenderAnalysisPanel
          projectId={projectId}
          sections={["requirements", "risks", "clarifications", "report", "sources"]}
          initialTab="requirements"
        />
      </div>

      {/* 正式澄清（RFI） */}
      {canManage && projectStatus !== "abandoned" && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileQuestion size={16} className="text-accent" />
              <h3 className="text-sm font-semibold">正式澄清（RFI）</h3>
              <span className="hidden text-xs text-muted sm:inline">向业主/GC/顾问发送澄清邮件</span>
            </div>
            <button
              type="button"
              onClick={() => setShowQuestionDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover"
            >
              <FileQuestion size={12} />向业主提问
            </button>
          </div>
          <p className="mt-1 text-xs text-muted sm:hidden">向业主/GC/顾问发送澄清邮件</p>
          {/* FB-15：已发问题生命周期 + 业主答复证据 + 手动检索兜底 */}
          <ProjectQuestionStatusList projectId={projectId} />
        </div>
      )}
      <ProjectQuestionDialog
        projectId={projectId}
        open={showQuestionDialog}
        onOpenChange={setShowQuestionDialog}
        onSent={() => setShowQuestionDialog(false)}
      />
    </div>
  );
}
