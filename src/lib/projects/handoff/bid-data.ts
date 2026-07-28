/**
 * Bid Data Layer 校验（表可能存在于 DB 但不在本地 Prisma schema）
 * 使用原始 SQL；无 revision 时返回 hasRevisions=false，不伪造审批状态。
 */

import { db } from "@/lib/db";

export type BidDataGateResult = {
  hasRevisions: boolean;
  finalRevisionId: string | null;
  finalStatus: string | null;
  technicalApproved: boolean | null;
  financialApproved: boolean | null;
  locked: boolean | null;
  ready: boolean;
  message: string | null;
};

type RevisionRow = {
  id: string;
  status: string | null;
  technicalApprovedAt: Date | null;
  financialApprovedAt: Date | null;
  lockedAt: Date | null;
  technicalReviewStatus: string | null;
  financialReviewStatus: string | null;
};

export async function inspectBidDataGate(
  projectId: string,
): Promise<BidDataGateResult> {
  try {
    const rows = await db.$queryRaw<RevisionRow[]>`
      SELECT
        id,
        status,
        "technicalApprovedAt",
        "financialApprovedAt",
        "lockedAt",
        "technicalReviewStatus",
        "financialReviewStatus"
      FROM "BidDataRevision"
      WHERE "projectId" = ${projectId}
      ORDER BY "revisionNumber" DESC
      LIMIT 5
    `;

    if (!rows.length) {
      return {
        hasRevisions: false,
        finalRevisionId: null,
        finalStatus: null,
        technicalApproved: null,
        financialApproved: null,
        locked: null,
        ready: false,
        message: "无 Bid Data Revision，需历史项目交接 override",
      };
    }

    // 优先取 locked / approved 终态 revision
    const final =
      rows.find((r) => r.lockedAt) ||
      rows.find((r) => String(r.status || "").toLowerCase() === "locked") ||
      rows.find((r) => String(r.status || "").toLowerCase() === "approved") ||
      rows[0]!;

    const technicalApproved = Boolean(
      final.technicalApprovedAt ||
        String(final.technicalReviewStatus || "").toLowerCase() === "approved",
    );
    const financialApproved = Boolean(
      final.financialApprovedAt ||
        String(final.financialReviewStatus || "").toLowerCase() === "approved" ||
        String(final.financialReviewStatus || "").toLowerCase() === "not_applicable",
    );
    const locked = Boolean(
      final.lockedAt || String(final.status || "").toLowerCase() === "locked",
    );

    const ready = technicalApproved && financialApproved && locked;
    let message: string | null = null;
    if (!technicalApproved) message = "最终 Revision 技术审批未通过";
    else if (!financialApproved) message = "最终 Revision 财务审批未通过";
    else if (!locked) message = "最终 Revision 尚未锁定";

    return {
      hasRevisions: true,
      finalRevisionId: final.id,
      finalStatus: final.status,
      technicalApproved,
      financialApproved,
      locked,
      ready,
      message,
    };
  } catch {
    // 表不存在或无权：视为无 Bid Data Layer
    return {
      hasRevisions: false,
      finalRevisionId: null,
      finalStatus: null,
      technicalApproved: null,
      financialApproved: null,
      locked: null,
      ready: false,
      message: "Bid Data Layer 不可用，需历史项目交接 override",
    };
  }
}
