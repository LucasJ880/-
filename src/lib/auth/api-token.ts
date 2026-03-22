import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export interface ApiTokenPayload {
  tokenId: string;
  system: string;
  permissions: string[];
}

/**
 * 从 Authorization: Bearer {token} 中验证 API Token。
 * 返回 token payload 或 NextResponse 401/403。
 */
export async function verifyApiToken(
  request: NextRequest
): Promise<ApiTokenPayload | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header", code: "AUTH_MISSING" },
      { status: 401 }
    );
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    return NextResponse.json(
      { error: "Empty token", code: "AUTH_EMPTY" },
      { status: 401 }
    );
  }

  const record = await db.apiToken.findUnique({ where: { token: rawToken } });

  if (!record || !record.isActive) {
    return NextResponse.json(
      { error: "Invalid or revoked API token", code: "AUTH_INVALID" },
      { status: 401 }
    );
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "API token expired", code: "AUTH_EXPIRED" },
      { status: 401 }
    );
  }

  db.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: record.id,
    system: record.system,
    permissions: record.permissions.split(",").map((p) => p.trim()),
  };
}

export function hasPermission(
  payload: ApiTokenPayload,
  required: string
): boolean {
  return payload.permissions.includes("*") || payload.permissions.includes(required);
}
