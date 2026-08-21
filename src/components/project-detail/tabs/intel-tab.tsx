"use client";

/**
 * Tab 4「情报」— 当前项目情报 + 调查区块 + 相似项目 + 企业规则 + 未来情报 Slot（T1A）。
 * 本轮只整合既有分析结果，不实现新的情报 Backend；
 * 未来模块（历史中标/采购机构画像/可比价格/竞争对手/采购周期/供应链/AI 策略）
 * 使用诚实空态占位，严禁把缺数据渲染成真实的零。
 */

import { BidToGoIntelligenceCard } from "@/components/bidtogo/intelligence-card";
import { ProjectIntelSections } from "@/components/bid-workflow/project-intel-sections";
import { ProjectHistoryExperienceCard } from "@/components/project-history-experience/project-history-experience-card";
import { ProjectOrgRulesCard } from "@/components/project-org-rules/project-org-rules-card";
import type { ProjectContextTarget } from "@/components/project-detail/project-context-panel";
import type { ProjectDetail } from "@/components/project-detail/project-detail-types";
import { OrgAwardIntelSlots } from "@/components/tender-intel/org-award-intel-slots";
import { TenderWatchCard } from "@/components/tender-intel/tender-watch-card";



interface IntelTabProps {
  projectId: string;
  project: ProjectDetail;
  canManage: boolean;
  orgRulesRefreshKey: number;
  onProjectUpdate: () => void;
  onNavigate: (target: ProjectContextTarget) => void;
}

export function IntelTab({
  projectId,
  project,
  canManage,
  orgRulesRefreshKey,
  onProjectUpdate,
  onNavigate,
}: IntelTabProps) {
  const hasIntelligenceCard = project.sourceSystem === "bidtogo" || Boolean(project.intelligence);
  const projectTypeLabel = project.category?.trim() || null;

  return (
    <div className="space-y-6">
      {/* BidToGo 来源项目的情报主卡（含人工复核流）；上传型项目无此卡 */}
      {hasIntelligenceCard ? (
        <BidToGoIntelligenceCard
          project={{
            projectId,
            sourceSystem: project.sourceSystem === "bidtogo" ? project.sourceSystem : "upload",
            sourcePlatform: project.sourceSystem === "bidtogo" ? (project.sourcePlatform ?? null) : null,
            clientOrganization: project.clientOrganization ?? null,
            location: project.location ?? null,
            estimatedValue: project.estimatedValue ?? null,
            currency: project.currency ?? null,
            solicitationNumber: project.solicitationNumber ?? null,
            tenderStatus: project.tenderStatus ?? null,
            dueDate: project.dueDate ?? null,
            externalRef: project.sourceSystem === "bidtogo" ? (project.externalRef ?? null) : null,
            intelligence: project.intelligence ?? null,
            documents: project.documents ?? [],
          }}
          onUpdate={onProjectUpdate}
        />
      ) : null}
      {/* 上传型项目不再渲染 BidToGo 遗留主卡占位（该卡只由旧人工评估协议写入，
          上传型项目结构性恒空，其「分析后将展示」文案是永不兑现的空头承诺——
          真实情报全在下方调查区块与组织授标槽位） */}

      {/* 调查区块（原调查室内容归位：30 秒摘要 / 八个调查模块 / 事实与可信度） */}
      {project.intelligenceAvailable === false ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前环境尚未启用投标智能（数据库未完成迁移），调查数据暂不可用。
        </div>
      ) : (
        <ProjectIntelSections
          projectId={projectId}
          projectTypeLabel={projectTypeLabel}
          onOpenWorkbench={() => onNavigate("workbench")}
        />
      )}

      {/* 历史相似项目（既有能力） */}
      <ProjectHistoryExperienceCard projectId={projectId} />

      {/* 企业规则（既有能力；确认复盘后自动刷新） */}
      <ProjectOrgRulesCard projectId={projectId} refreshKey={orgRulesRefreshKey} />

      {/* 公告盯梢：Addenda/Q&A 变更提醒（Halifax 时效需求） */}
      <TenderWatchCard projectId={projectId} canManage={canManage} />

      {/* 企业历史情报：七槽位接 T4 组织级授标情报投影（情报阶段1） */}
      <OrgAwardIntelSlots
        orgId={project.orgId ?? null}
        projectId={projectId}
        buyerName={project.clientOrganization ?? null}
      />
    </div>
  );
}
