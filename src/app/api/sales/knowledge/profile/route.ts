import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { updateCustomerProfile, refreshAllProfiles } from "@/lib/sales/profile-engine";

export const GET = withAuth(async (request) => {
  const customerId = request.nextUrl.searchParams.get("customerId");

  if (customerId) {
    const profile = await db.customerProfile.findUnique({
      where: { customerId },
      include: { customer: { select: { name: true, phone: true, email: true } } },
    });
    return NextResponse.json({ profile });
  }

  const profiles = await db.customerProfile.findMany({
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const stats = {
    total: profiles.length,
    avgConfidence: profiles.length > 0
      ? profiles.reduce((s, p) => s + p.confidence, 0) / profiles.length
      : 0,
  };

  return NextResponse.json({ profiles, stats });
});

export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { action, customerId, limit } = body as {
    action?: "update" | "refresh_all";
    customerId?: string;
    limit?: number;
  };

  if (action === "refresh_all") {
    const result = await refreshAllProfiles({ limit });
    return NextResponse.json({ success: true, ...result });
  }

  if (customerId) {
    const result = await updateCustomerProfile({ customerId });
    return NextResponse.json({ success: true, ...result });
  }

  return NextResponse.json({ error: "需要 customerId 或 action" }, { status: 400 });
});
