/**
 * GET /api/revenue/v2-readiness — FDE V2 Quotation Engineer 启动条件就绪度（B-6，只读）：
 * 四条条件（事实提案运行满 30 天 / MOQ 可引用 / 生产周期可引用 / 至少 3 个类目——组织级口径下无法度量）+ 结论 + 依据计数。
 * 口径见 src/lib/revenue-spine/v2-readiness.ts。
 *
 * 权限与组织由 resolveRevenueAccess 在服务端解析（外贸 / 营收读键，与 /api/revenue/sla-metrics 同口径；activeOrg + 在职成员），不接受请求里的 orgId；窗口固定 30 天。
 * 只读：不写任何表、不发布 policy、不建审批卡；响应只含状态、计数、比率与是否配置，不含任何商务值。
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRevenueAccess, REVENUE_READ_KEYS } from "@/lib/revenue-spine/access";
import { getV2Readiness } from "@/lib/revenue-spine/v2-readiness-read-model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request, REVENUE_READ_KEYS);
  if (!access.ok) return access.response;
  const report = await getV2Readiness(access.orgId);
  return NextResponse.json(report);
}
