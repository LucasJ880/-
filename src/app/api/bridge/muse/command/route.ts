/**
 * POST /api/bridge/muse/command
 *
 * Muse-Bridge-bot → 青砚 的唯一下行入口。
 *   Authorization: Bearer <ApiToken>   （ApiToken.system="muse-bridge"，permissions 含 "muse:bridge"）
 *   Body: MuseCommandEnvelope（muse-bridge/v1）
 *
 * 顺序：总开关 → token → 契约解析 → org 允许 → 身份绑定 + membership → 路由。
 * 任何一步失败都返回契约格式的响应（Muse 可直接转述），绝不 500 裸抛。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyApiToken, hasPermission } from "@/lib/auth/api-token";
import { parseMuseCommand, MUSE_BRIDGE_CONTRACT_VERSION } from "@/lib/muse-bridge/contract";
import { isMuseBridgeEnabled, isMuseOrgAllowed } from "@/lib/muse-bridge/flags";
import { resolveMuseBinding } from "@/lib/muse-bridge/binding";
import { handleMuseCommand } from "@/lib/muse-bridge/router";
import { errResponse } from "@/lib/muse-bridge/router-pure";

export const MUSE_BRIDGE_PERMISSION = "muse:bridge" as const;

export async function POST(request: NextRequest) {
  if (!isMuseBridgeEnabled()) {
    return NextResponse.json(errResponse("n/a", "BRIDGE_DISABLED", "Muse 通道未开启。"), { status: 503 });
  }

  const auth = await verifyApiToken(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.system !== "muse-bridge" || !hasPermission(auth, MUSE_BRIDGE_PERMISSION)) {
    return NextResponse.json({ error: "Token lacks muse:bridge permission", code: "AUTH_FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(errResponse("n/a", "VALIDATION_FAILED", "请求体不是合法 JSON。"), { status: 400 });
  }

  const parsed = parseMuseCommand(body);
  if (!parsed.ok) {
    const requestId =
      body && typeof body === "object" && typeof (body as { requestId?: unknown }).requestId === "string"
        ? (body as { requestId: string }).requestId
        : "n/a";
    return NextResponse.json(
      { ...errResponse(requestId, "VALIDATION_FAILED", `指令不符合 ${MUSE_BRIDGE_CONTRACT_VERSION} 契约。`), data: { issues: parsed.issues } },
      { status: 400 },
    );
  }
  const envelope = parsed.value;

  if (!isMuseOrgAllowed(envelope.orgId)) {
    return NextResponse.json(errResponse(envelope.requestId, "ORG_MEMBERSHIP_REQUIRED", "该组织未开放 Muse 通道。"), { status: 403 });
  }

  const bound = await resolveMuseBinding(envelope.orgId, envelope.museUserRef);
  if (!bound.ok) {
    return NextResponse.json(errResponse(envelope.requestId, bound.errorCode, bound.message), { status: 403 });
  }

  const response = await handleMuseCommand(envelope, bound.identity);
  return NextResponse.json(response, { status: response.ok ? 200 : 422 });
}
