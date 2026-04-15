import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { withAuth } from "@/lib/common/api-helpers";

function generateToken(): string {
  return `qy_${crypto.randomBytes(32).toString("hex")}`;
}

export const GET = withAuth(async (request, ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const tokens = await db.apiToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      system: true,
      permissions: true,
      isActive: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      token: false,
    },
  });

  return NextResponse.json({ tokens });
});

export const POST = withAuth(async (request, ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const body = await request.json();
  const name = String(body.name || "").trim();
  const system = String(body.system || "").trim();

  if (!name || !system) {
    return NextResponse.json(
      { error: "name 和 system 为必填" },
      { status: 400 }
    );
  }

  const token = generateToken();
  const record = await db.apiToken.create({
    data: {
      name,
      token,
      system,
      permissions: body.permissions || "project:create",
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });

  return NextResponse.json(
    {
      id: record.id,
      token,
      name: record.name,
      system: record.system,
      permissions: record.permissions,
      createdAt: record.createdAt,
    },
    { status: 201 }
  );
});
