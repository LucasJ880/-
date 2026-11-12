/**
 * VIS-1e 预览结束的审计（spec authorization/position-preview「预览审计」）：退出预览与带预览登出各一条。
 * 平台动作：orgId 为空，企业在 targetId / afterData；不含 token。
 */

import type { NextRequest } from "next/server";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

export async function logPreviewEnded(
  userId: string,
  preview: { orgId: string; positions: Array<{ key: string }> },
  request: NextRequest,
  via: "exit" | "logout",
): Promise<void> {
  await logAudit({
    userId,
    action: AUDIT_ACTIONS.PREVIEW_ENDED,
    targetType: AUDIT_TARGETS.ORG,
    targetId: preview.orgId,
    afterData: { orgId: preview.orgId, positionKeys: preview.positions.map((p) => p.key), via },
    request,
  });
}
