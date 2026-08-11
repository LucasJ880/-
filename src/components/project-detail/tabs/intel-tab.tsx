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
import { Radar } from "lucide-react";

/** T3/T4 情报模块的稳定 UI Slot（key 与 T0 架构文档七域对应） */
const INTEL_FUTURE_SLOTS: Array<{ key: string; title: string; hint: string }> = [
  { key: "historical_awards", title: "历史中标", hint: "企业历史数据尚未建立" },
  { key: "buyer_history", title: "采购机构画像", hint: "尚未建立采购机构历史档案" },
  { key: "comparable_prices", title: "可比价格", hint: "尚无可比价格数据" },
  { key: "competitors", title: "竞争对手", hint: "尚未建立竞争对手档案" },
  { key: "procurement_cycle", title: "采购周期", hint: "尚未分析" },
  { key: "supply_chain", title: "供应链情报", hint: "尚未建立供应链数据" },
  { key: "bid_strategy", title: "AI 投标策略", hint: "尚未分析" },
];

interface IntelTabProps {
  projectId: string;
  project: ProjectDetail;
  orgRulesRefreshKey: number;
  onProjectUpdate: () => void;
  onNavigate: (target: ProjectContextTarget) => void;
}

export function IntelTab({
  projectId,
  project,
  orgRulesRefreshKey,
  onProjectUpdate,
  onNavigate,
}: IntelTabProps) {
  const hasIntelligenceCard = project.sourceSystem === "bidtogo" || Boolean(project.intelligence);
  const projectTypeLabel = project.category?.trim() || null;

  return (
    <div className="space-y-6">
      {/* 当前项目情报主卡（含人工复核流） */}
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
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">尚未生成项目情报分析</p>
          <p className="mt-1 text-xs text-muted">
            上传招标文件并完成「招标要求」分析，或在工作台确认进入投标调查后，这里将展示项目情报。
          </p>
        </div>
      )}

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

      {/* 企业历史情报 Slot（T3/T4 规划位；诚实空态） */}
      <section className="space-y-3" data-testid="intel-future-slots">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Radar size={16} className="text-accent/60" />
          企业历史情报
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-muted">
            建设中
          </span>
        </h3>
        <p className="text-xs text-muted">
          以下模块将随企业项目档案与历史数据积累逐步启用；当前尚无数据，不展示估计值。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEL_FUTURE_SLOTS.map((slot) => (
            <div
              key={slot.key}
              data-intel-slot={slot.key}
              className="rounded-xl border border-dashed border-border/70 bg-background/40 p-4"
            >
              <p className="text-sm font-medium text-foreground/80">{slot.title}</p>
              <p className="mt-1 text-xs text-muted">{slot.hint}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
