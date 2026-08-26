/**
 * Mention Gateway M2-B — 绑定管理（SELF-SERVICE 无；AI-write 无）
 *
 * GET  /api/mention-gateway/bindings?projectId=|customerId= — 管理列表
 *   （挂同一 BINDING_ADMIN flag，避免暴露未启用管理面；逐条按 target 权限 + 租户归属过滤）
 * POST /api/mention-gateway/bindings — 创建（B0：只有显式持久化绑定可建立业务上下文）
 *   body 绝不接受 orgId / status / bindingLevel / createdById / updatedById：
 *   orgId 由 target 服务端推导且必须等于管理租户 org；bindingLevel 由 threadId 有无推导。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import {
  bindingServiceResponse,
  requireBindingAdminContext,
  toBindingDto,
} from "@/lib/mention-gateway/binding-admin";
import {
  createChannelBinding,
  listChannelBindingsForAdmin,
} from "@/lib/mention-gateway/binding-service";

export const GET = withAuth(async (request, _ctx, user) => {
  const admin = await requireBindingAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const result = await listChannelBindingsForAdmin({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    projectId,
    customerId,
  });
  return NextResponse.json({ bindings: result.bindings.map(toBindingDto) });
});

const CreateSchema = z
  .object({
    provider: z.string().min(1).max(64),
    providerTenantId: z.string().min(1).max(128),
    providerChannelId: z.string().min(1).max(256),
    providerThreadId: z.string().min(1).max(256).optional(),
    targetType: z.enum(["project", "customer"]),
    targetId: z.string().min(1).max(128),
    contextRole: z.enum(["tender"]).optional(),
  })
  .strict();

export const POST = withAuth(async (request, _ctx, user) => {
  const admin = await requireBindingAdminContext(request);
  if (admin instanceof NextResponse) return admin;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const result = await createChannelBinding({
    caller: { userId: user.id, role: user.role },
    managementOrgId: admin.tenant.orgId,
    provider: parsed.data.provider,
    providerTenantId: parsed.data.providerTenantId,
    providerChannelId: parsed.data.providerChannelId,
    providerThreadId: parsed.data.providerThreadId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    contextRole: parsed.data.contextRole ?? null,
  });
  return bindingServiceResponse(result);
});
