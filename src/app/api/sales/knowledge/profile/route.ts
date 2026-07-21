import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  updateCustomerProfile,
  refreshAllProfiles,
} from "@/lib/sales/profile-engine";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const { orgId } = orgRes;

  const customerId = request.nextUrl.searchParams.get("customerId");

  if (customerId) {
    const profile = await db.customerProfile.findFirst({
      where: { customerId, customer: { orgId } },
      include: {
        customer: { select: { name: true, phone: true, email: true } },
      },
    });
    return NextResponse.json({ profile });
  }

  const profiles = await db.customerProfile.findMany({
    where: { customer: { orgId } },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const stats = {
    total: profiles.length,
    avgConfidence:
      profiles.length > 0
        ? profiles.reduce((s, p) => s + p.confidence, 0) / profiles.length
        : 0,
  };

  return NextResponse.json({ profiles, stats });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const { orgId } = orgRes;

  const body = await request.json();
  const { action, customerId, limit } = body as {
    action?: "update" | "refresh_all";
    customerId?: string;
    limit?: number;
  };

  if (action === "refresh_all") {
    const result = await refreshAllProfiles({ limit, orgId });
    return NextResponse.json({ success: true, ...result });
  }

  if (customerId) {
    const cust = await db.salesCustomer.findFirst({
      where: { id: customerId, orgId },
      select: { id: true },
    });
    if (!cust) {
      return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    }
    const result = await updateCustomerProfile({ customerId });
    return NextResponse.json({ success: true, ...result });
  }

  return NextResponse.json(
    { error: "需要 customerId 或 action" },
    { status: 400 },
  );
});
