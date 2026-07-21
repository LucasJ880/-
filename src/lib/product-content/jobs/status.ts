import type { ProductContentJobStatus } from "@/lib/product-content/types";

export const ALLOWED_TRANSITIONS: Record<
  ProductContentJobStatus,
  ProductContentJobStatus[]
> = {
  DRAFT: ["INGESTING", "ANALYZING", "CANCELLED", "FAILED"],
  INGESTING: ["ANALYZING", "FAILED", "CANCELLED"],
  ANALYZING: ["NEEDS_INPUT", "PLAN_READY", "FAILED", "CANCELLED"],
  NEEDS_INPUT: ["ANALYZING", "PLAN_READY", "CANCELLED", "FAILED"],
  PLAN_READY: ["AWAITING_APPROVAL", "GENERATING_VISUALS", "CANCELLED", "FAILED"],
  AWAITING_APPROVAL: [
    "PLAN_READY",
    "GENERATING_VISUALS",
    "REVISION_REQUESTED",
    "CANCELLED",
    "FAILED",
  ],
  GENERATING_VISUALS: ["RUNNING_VISUAL_QA", "FAILED", "CANCELLED"],
  RUNNING_VISUAL_QA: ["GENERATING_CONTENT", "GENERATING_VISUALS", "FAILED", "CANCELLED"],
  GENERATING_CONTENT: ["GENERATING_DOCUMENTS", "READY_FOR_REVIEW", "FAILED", "CANCELLED"],
  GENERATING_DOCUMENTS: ["READY_FOR_REVIEW", "FAILED", "CANCELLED"],
  READY_FOR_REVIEW: [
    "REVISION_REQUESTED",
    "APPROVED",
    "GENERATING_VISUALS",
    "GENERATING_CONTENT",
    "GENERATING_DOCUMENTS",
    "CANCELLED",
    "FAILED",
  ],
  REVISION_REQUESTED: [
    "NEEDS_INPUT",
    "PLAN_READY",
    "GENERATING_VISUALS",
    "GENERATING_CONTENT",
    "READY_FOR_REVIEW",
    "CANCELLED",
    "FAILED",
  ],
  APPROVED: ["DELIVERED", "REVISION_REQUESTED", "FAILED"],
  DELIVERED: [],
  FAILED: ["DRAFT", "ANALYZING", "CANCELLED"],
  CANCELLED: [],
};

export function assertTransition(
  from: ProductContentJobStatus,
  to: ProductContentJobStatus,
): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`不允许的状态流转：${from} → ${to}`);
  }
}

export interface ApproveJobChecks {
  openConflictCount: number;
  pendingApprovalCount: number;
  hasCopy: boolean;
  hasZipDocument: boolean;
  rejectedVisualCount: number;
  unverifiedCertificationClaims: number;
  requiredFieldsMissing: number;
  approvedVisualCount?: number;
  copyApproved?: boolean;
  purpose?: "INTERNAL_DRAFT" | "CUSTOMER_REVIEW" | "FORMAL_EXTERNAL";
}

export interface ApproveJobResult {
  ok: boolean;
  reasons: string[];
}

/** INTERNAL_DRAFT 文档生成门禁（宽松） */
export function canGenerateInternalDraftDocs(
  checks: Pick<ApproveJobChecks, "hasCopy" | "pendingApprovalCount">,
): ApproveJobResult {
  const reasons: string[] = [];
  if (checks.pendingApprovalCount > 0) {
    reasons.push(`存在 ${checks.pendingApprovalCount} 条待审批动作`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** 正式 APPROVED 门禁 */
export function canApproveJob(checks: ApproveJobChecks): ApproveJobResult {
  const purpose = checks.purpose ?? "FORMAL_EXTERNAL";
  const reasons: string[] = [];

  if (purpose === "INTERNAL_DRAFT") {
    return canGenerateInternalDraftDocs(checks);
  }

  if (checks.openConflictCount > 0) {
    reasons.push(`存在 ${checks.openConflictCount} 条未解决的事实冲突`);
  }
  if (checks.pendingApprovalCount > 0) {
    reasons.push(`存在 ${checks.pendingApprovalCount} 条待审批动作`);
  }
  if (!checks.hasCopy) {
    reasons.push("缺少产品文案");
  }
  if ((checks.approvedVisualCount ?? 0) < 1) {
    reasons.push("至少需要 1 张已批准/锁定的视觉输出");
  }
  if (!checks.copyApproved) {
    reasons.push("文案尚未批准");
  }
  if (checks.rejectedVisualCount > 0) {
    reasons.push(`存在 ${checks.rejectedVisualCount} 张被拒绝的视觉输出`);
  }
  if (checks.unverifiedCertificationClaims > 0) {
    reasons.push("存在未验证的认证声明");
  }
  if (checks.requiredFieldsMissing > 0) {
    reasons.push(`仍有 ${checks.requiredFieldsMissing} 个必填字段缺失`);
  }

  return { ok: reasons.length === 0, reasons };
}
