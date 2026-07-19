import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import {
  deleteOrgKnowledge,
  getOrgKnowledge,
  indexOrgKnowledgeDocument,
} from "@/lib/knowledge/org-knowledge";
import { logAudit } from "@/lib/audit/logger";

async function assertMember(userId: string, orgId: string, role: string) {
  if (role === "admin" || role === "super_admin") return null;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { status: true },
  });
  if (membership?.status !== "active") {
    return NextResponse.json({ error: "无权访问该组织知识库" }, { status: 403 });
  }
  return null;
}

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const denied = await assertMember(user.id, orgRes.orgId, user.role);
  if (denied) return denied;

  const document = await getOrgKnowledge(orgRes.orgId, id);
  if (!document) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ document });
});

export const DELETE = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const denied = await assertMember(user.id, orgRes.orgId, user.role);
  if (denied) return denied;

  const deleted = await deleteOrgKnowledge(orgRes.orgId, id);
  if (!deleted) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "org_knowledge_delete",
    targetType: "org_knowledge_document",
    targetId: id,
    request,
  });
  return NextResponse.json({ ok: true });
});

/** POST：重建向量索引 */
export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await assertMember(user.id, orgRes.orgId, user.role);
  if (denied) return denied;

  const document = await getOrgKnowledge(orgRes.orgId, id);
  if (!document) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  if (body.action !== "reindex") {
    return NextResponse.json({ error: "仅支持 action=reindex" }, { status: 400 });
  }
  const result = await indexOrgKnowledgeDocument(id);
  return NextResponse.json({ ok: true, ...result });
});
