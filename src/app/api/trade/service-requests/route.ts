/**
 * 外贸客户服务工单 — 列表 / 创建
 *
 * GET  /api/trade/service-requests?view=client|fulfillment&status=&cursor=
 *   - client（默认）：列出归属当前 org 的工单
 *   - fulfillment：列出指派给当前 org 处理的工单（加拿大团队视角）
 * POST /api/trade/service-requests
 *   - 在当前 org 内手动建单
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import {
  createServiceRequest,
  listServiceRequestsForOrg,
  listFulfillmentRequests,
  type ServiceRequestStatus,
  type ServiceRequestPriority,
} from "@/lib/trade/service-request";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "fulfillment" ? "fulfillment" : "client";
  const status = (url.searchParams.get("status") as ServiceRequestStatus | null) ?? undefined;
  const cursor = url.searchParams.get("cursor");
  const limit = Number(url.searchParams.get("limit")) || 50;

  const result =
    view === "fulfillment"
      ? await listFulfillmentRequests({ fulfillmentOrgId: orgRes.orgId, status, cursor, limit })
      : await listServiceRequestsForOrg({ orgId: orgRes.orgId, status, cursor, limit });

  return NextResponse.json({ view, ...result });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: (body.orgId as string | undefined) ?? null,
  });
  if (!orgRes.ok) return orgRes.response;

  const title = (body.title as string | undefined)?.trim();
  if (!title) {
    return NextResponse.json({ error: "缺少 title" }, { status: 400 });
  }

  const created = await createServiceRequest({
    orgId: orgRes.orgId,
    requestType: (body.requestType as string | undefined) ?? "other",
    title,
    description: (body.description as string | undefined) ?? null,
    priority: (body.priority as ServiceRequestPriority | undefined) ?? undefined,
    structuredSpec: body.structuredSpec,
    createdById: auth.user.id,
  });

  return NextResponse.json(created, { status: 201 });
}
