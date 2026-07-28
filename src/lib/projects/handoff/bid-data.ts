/**
 * Bid Data Layer 校验（表可能存在于 DB 但不在本地 Prisma schema）
 * 使用参数化 raw SQL；表不可用时返回 BID_DATA_UNAVAILABLE，不伪造审批、不自动放行。
 */

import { db } from "@/lib/db";

export type BidDataGateResult = {
  /** false = 表/关系不可用（与「无 revision」区分） */
  layerAvailable: boolean;
  hasRevisions: boolean;
  finalRevisionId: string | null;
  finalStatus: string | null;
  technicalApproved: boolean | null;
  financialApproved: boolean | null;
  locked: boolean | null;
  ready: boolean;
  message: string | null;
  failureCode: "BID_DATA_UNAVAILABLE" | "BID_DATA_INCOMPLETE" | null;
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

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /relation .* does not exist/i.test(msg) ||
    /does not exist/i.test(msg) ||
    /undefined_table/i.test(msg)
  );
}

function unavailableResult(message: string): BidDataGateResult {
  return {
    layerAvailable: false,
    hasRevisions: false,
    finalRevisionId: null,
    finalStatus: null,
    technicalApproved: null,
    financialApproved: null,
    locked: null,
    ready: false,
    message,
    failureCode: "BID_DATA_UNAVAILABLE",
  };
}

export async function inspectBidDataGate(
  projectId: string,
): Promise<BidDataGateResult> {
  try {
    // 参数化绑定 projectId，禁止拼接用户输入
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
        layerAvailable: true,
        hasRevisions: false,
        finalRevisionId: null,
        finalStatus: null,
        technicalApproved: null,
        financialApproved: null,
        locked: null,
        ready: false,
        message: "无 Bid Data Revision，需历史项目交接 override",
        failureCode: null,
      };
    }

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
        String(final.financialReviewStatus || "").toLowerCase() ===
          "approved" ||
        String(final.financialReviewStatus || "").toLowerCase() ===
          "not_applicable",
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
      layerAvailable: true,
      hasRevisions: true,
      finalRevisionId: final.id,
      finalStatus: final.status,
      technicalApproved,
      financialApproved,
      locked,
      ready,
      message,
      failureCode: ready ? null : "BID_DATA_INCOMPLETE",
    };
  } catch (err) {
    if (isMissingRelationError(err)) {
      return unavailableResult(
        "Bid Data 表不可用（BID_DATA_UNAVAILABLE），需管理层历史项目交接 override",
      );
    }
    return unavailableResult(
      "Bid Data Layer 查询失败（BID_DATA_UNAVAILABLE），需管理层历史项目交接 override",
    );
  }
}
