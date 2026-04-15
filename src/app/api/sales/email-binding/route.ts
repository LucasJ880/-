import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (_request, _ctx, user) => {
  const binding = await db.emailBinding.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      provider: true,
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      useTls: true,
      verified: true,
      verifiedAt: true,
      lastSentAt: true,
      lastError: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ binding });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const { email, displayName, smtpHost, smtpPort, smtpUser, smtpPass, useTls } = body as {
    email: string;
    displayName: string;
    smtpHost: string;
    smtpPort?: number;
    smtpUser: string;
    smtpPass: string;
    useTls?: boolean;
  };

  if (!email || !smtpHost || !smtpUser || !smtpPass) {
    return NextResponse.json({ error: "必填字段不完整" }, { status: 400 });
  }

  const binding = await db.emailBinding.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      email,
      displayName: displayName || user.name || "Sales",
      provider: "smtp",
      smtpHost,
      smtpPort: smtpPort || 587,
      smtpUser,
      smtpPass,
      useTls: useTls ?? true,
      verified: false,
    },
    update: {
      email,
      displayName: displayName || user.name || "Sales",
      smtpHost,
      smtpPort: smtpPort || 587,
      smtpUser,
      smtpPass,
      useTls: useTls ?? true,
      verified: false,
      verifiedAt: null,
      lastError: null,
    },
  });

  return NextResponse.json({ binding: { id: binding.id, email: binding.email, verified: binding.verified } });
});

export const DELETE = withAuth(async (_request, _ctx, user) => {
  await db.emailBinding.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
});
