/**
 * GET /api/bridge/muse/events?orgId=&museUserRef=&since=<ISO>&cursor=<ISO|id>&limit=
 *
 * Muse-Bridge-bot 上行拉取。返回绑定用户在该 org 下的 Muse 事件（按 createdAt, id 升序）+ 下一游标。
 * S3：`cursor` / `nextCursor` 是复合游标，优先于 `since` / `nextSince`（后者保留给旧调用方）。
 * 与命令入口同一 token / 同一绑定规则；未绑定用户拿不到任何事件（fail-closed）。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyApiToken, hasPermission } from "@/lib/auth/api-token";
import { MUSE_BRIDGE_CONTRACT_VERSION } from "@/lib/muse-bridge/contract";
import { isMuseBridgeEnabled, isMuseOrgAllowed } from "@/lib/muse-bridge/flags";
import { resolveMuseBinding } from "@/lib/muse-bridge/binding";
import { listMuseEvents, parseEventCursor } from "@/lib/muse-bridge/events";
import { MUSE_BRIDGE_PERMISSION } from "../command/route";

export async function GET(request: NextRequest) {
  if (!isMuseBridgeEnabled()) {
    return NextResponse.json({ error: "Muse 通道未开启", code: "BRIDGE_DISABLED" }, { status: 503 });
  }
  const auth = await verifyApiToken(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.system !== "muse-bridge" || !hasPermission(auth, MUSE_BRIDGE_PERMISSION)) {
    return NextResponse.json({ error: "Token lacks muse:bridge permission", code: "AUTH_FORBIDDEN" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const orgId = (sp.get("orgId") ?? "").trim();
  const museUserRef = (sp.get("museUserRef") ?? "").trim();
  if (!orgId || !museUserRef) {
    return NextResponse.json({ error: "orgId 与 museUserRef 必填", code: "VALIDATION_FAILED" }, { status: 400 });
  }
  if (!isMuseOrgAllowed(orgId)) {
    return NextResponse.json({ error: "该组织未开放 Muse 通道", code: "ORG_MEMBERSHIP_REQUIRED" }, { status: 403 });
  }
  const bound = await resolveMuseBinding(orgId, museUserRef);
  if (!bound.ok) {
    return NextResponse.json({ error: bound.message, code: bound.errorCode }, { status: 403 });
  }

  const cursorRaw = sp.get("cursor");
  const cursor = cursorRaw ? parseEventCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) {
    return NextResponse.json({ error: "cursor 格式应为 <ISO 时间>|<id>", code: "VALIDATION_FAILED" }, { status: 400 });
  }
  const limitRaw = Number(sp.get("limit") ?? "50");
  const { events, nextSince, nextCursor } = await listMuseEvents({
    userId: bound.identity.userId,
    orgId,
    sinceIso: sp.get("since"),
    cursor,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  });
  return NextResponse.json({ contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, events, nextSince, nextCursor });
}
