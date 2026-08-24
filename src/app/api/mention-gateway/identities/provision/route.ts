/**
 * POST /api/mention-gateway/identities/provision — 管理员开通外部身份（M2-A）
 *
 * ADMIN_PROVISIONED 唯一入口。body **不接受** orgId / status / verifiedAt /
 * verifiedById / linkedById（zod strict 拒绝未知键）；管理 org 只来自服务端
 * requireTenantContext。ownership gate 未证明 → 422，且不落任何行（不可抢占唯一键）。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  identityServiceResponse,
  requireIdentityAdminContext,
} from "@/lib/mention-gateway/identity-admin";
import { adminProvisionIdentity } from "@/lib/mention-gateway/identity-service";

const BodySchema = z
  .object({
    provider: z.string().min(1).max(64),
    providerTenantId: z.string().min(1).max(128),
    providerUserId: z.string().min(1).max(128),
    targetUserId: z.string().min(1).max(128),
  })
  .strict();

export const POST = withAuth(async (request, _ctx, user) => {
  const admin = await requireIdentityAdminContext(request);
  if (admin instanceof NextResponse) return admin;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "请求体不合法（不接受 orgId / 状态类字段）" },
      { status: 400 },
    );
  }

  const result = await adminProvisionIdentity({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    ...parsed.data,
  });
  return identityServiceResponse(result);
});
