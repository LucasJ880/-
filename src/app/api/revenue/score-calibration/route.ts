/**
 * GET /api/revenue/score-calibration?days=90 — 评分校准报表（B-4，只报不改）：
 * 窗口内首次评估的商机，六维得分与当前阶段（赢 / 输 / 是否报过价）对账，给出分桶、命中率、区分度、等级表与建议权重。
 * 口径见 src/lib/revenue-spine/score-calibration.ts。
 *
 * 权限与组织由 resolveRevenueAccess 在服务端解析（外贸 / 营收读键，与 /api/revenue/sla-metrics 同口径；activeOrg + 在职成员），不接受请求里的 orgId；days 只决定窗口（30–180 天，缺省 90）。
 * 只读：不发布 policy、不写任何表；建议权重只作为片段返回，由负责人自行经 PUT /api/revenue/policy 发布。
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRevenueAccess, REVENUE_READ_KEYS } from "@/lib/revenue-spine/access";
import { getScoreCalibration } from "@/lib/revenue-spine/score-calibration-read-model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request, REVENUE_READ_KEYS);
  if (!access.ok) return access.response;
  const report = await getScoreCalibration(access.orgId, request.nextUrl.searchParams.get("days"));
  return NextResponse.json(report);
}
