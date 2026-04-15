import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const codes = await db.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ codes });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { code, role, label, maxUses, expiresAt } = body as {
    code?: string;
    role?: string;
    label?: string;
    maxUses?: number | null;
    expiresAt?: string | null;
  };

  if (!code || !role) {
    return NextResponse.json(
      { error: "邀请码和角色为必填项" },
      { status: 400 }
    );
  }

  const validRoles = ["admin", "sales", "trade", "user"];
  if (!validRoles.includes(role)) {
    return NextResponse.json(
      { error: `无效角色，可选: ${validRoles.join(", ")}` },
      { status: 400 }
    );
  }

  const existing = await db.inviteCode.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "邀请码已存在" }, { status: 409 });
  }

  const inviteCode = await db.inviteCode.create({
    data: {
      code: code.trim().toUpperCase(),
      role,
      label: label?.trim() || null,
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdById: auth.user.id,
    },
  });

  return NextResponse.json({ inviteCode }, { status: 201 });
}
