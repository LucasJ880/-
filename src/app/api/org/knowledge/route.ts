import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import {
  createOrgKnowledge,
  listOrgKnowledge,
} from "@/lib/knowledge/org-knowledge";
import { logAudit } from "@/lib/audit/logger";

async function requireOrgMember(userId: string, orgId: string, role: string) {
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

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireOrgMember(user.id, orgRes.orgId, user.role);
  if (denied) return denied;

  const category = request.nextUrl.searchParams.get("category") || undefined;
  const documents = await listOrgKnowledge(orgRes.orgId, { category });
  return NextResponse.json({ documents });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireOrgMember(user.id, orgRes.orgId, user.role);
  if (denied) return denied;

  if (!body.title || !body.content) {
    return NextResponse.json({ error: "title 与 content 必填" }, { status: 400 });
  }

  const document = await createOrgKnowledge({
    orgId: orgRes.orgId,
    userId: user.id,
    title: String(body.title),
    content: String(body.content),
    category: body.category ? String(body.category) : "general",
    tags: body.tags ? String(body.tags) : null,
    language: body.language ? String(body.language) : "zh",
    sourceType: "manual",
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "org_knowledge_create",
    targetType: "org_knowledge_document",
    targetId: document.id,
    afterData: { title: document.title, category: document.category },
    request,
  });

  return NextResponse.json({ document }, { status: 201 });
});
