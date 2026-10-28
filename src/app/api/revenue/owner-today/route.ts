/**
 * GET /api/revenue/owner-today — 老板「今日询盘」四栏（今日新询盘 / 回复超时 / 待审批 / 样品与报价到期）
 *
 * 组织由 resolveRevenueAccess 在服务端解析（activeOrg + 在职成员），不接受请求里的 orgId；
 * 「今天」按组织时区（settingsJson.timezone）的当地零点切分。
 */
import { NextRequest, NextResponse } from "next/server";
import { REVENUE_READ_KEYS, resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { buildOwnerToday } from "@/lib/revenue-spine/owner-today";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request, REVENUE_READ_KEYS);
  if (!access.ok) return access.response;
  return NextResponse.json(await buildOwnerToday(access.orgId));
}
