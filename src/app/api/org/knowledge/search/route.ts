import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import {
  formatOrgKnowledgeHits,
  searchOrgKnowledge,
} from "@/lib/knowledge/org-knowledge";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  if (user.role !== "admin" && user.role !== "super_admin") {
    const membership = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: orgRes.orgId, userId: user.id } },
      select: { status: true },
    });
    if (membership?.status !== "active") {
      return NextResponse.json({ error: "无权检索该组织知识库" }, { status: 403 });
    }
  }

  const query = String(body.query || "").trim();
  if (!query) {
    return NextResponse.json({ error: "query 必填" }, { status: 400 });
  }

  const result = await searchOrgKnowledge({
    orgId: orgRes.orgId,
    query,
    limit: typeof body.limit === "number" ? body.limit : 8,
    category: body.category ? String(body.category) : undefined,
  });

  return NextResponse.json({
    ...result,
    context: formatOrgKnowledgeHits(result.hits),
  });
});
