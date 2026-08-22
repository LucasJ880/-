"use client";

/**
 * Tab 3「标书与报价」— 报价 / 供应商询价 / 标书文档集中区（T1A）。
 * Version 不占一级入口：版本历史 = 只读 Drawer（报价版本链 + 生成文档版本 + 分析运行史）。
 * 报价确认/锁定语义完全沿用 ProjectQuote 既有规则，此处不改动。
 */

import { useState } from "react";
import { History } from "lucide-react";
import { ProjectInquirySection } from "@/components/inquiry/project-inquiry-section";
import { BidQuoteArea } from "@/components/quote-engine/bid-quote-area";
import { ProjectGenerateMenu } from "@/components/project-generate/project-generate-menu";
import { ChinaSupplierBriefPanel } from "@/components/bid-workflow/china-supplier-brief-panel";
import { ProjectSupplierLinks } from "@/components/bid-workflow/project-supplier-links";
import { VersionHistoryDrawer } from "@/components/project-detail/version-history-drawer";

interface BidTabProps {
  projectId: string;
  orgId: string | null;
  canManage: boolean;
}

export function BidTab({ projectId, orgId, canManage }: BidTabProps) {
  const [versionsOpen, setVersionsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setVersionsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
          data-testid="open-version-history"
        >
          <History size={12} />
          版本历史
        </button>
      </div>

      {/* 招投标报价（引擎）置顶；legacy 外贸报价折叠（flag OFF 时与原来一致） */}
      <BidQuoteArea projectId={projectId} />

      <ProjectGenerateMenu projectId={projectId} canManage={canManage} />

      <ProjectInquirySection projectId={projectId} orgId={orgId} canManage={canManage} />

      <ChinaSupplierBriefPanel projectId={projectId} />

      <ProjectSupplierLinks projectId={projectId} orgId={orgId} />

      <VersionHistoryDrawer
        projectId={projectId}
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
      />
    </div>
  );
}
