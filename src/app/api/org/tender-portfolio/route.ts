/**
 * GET /api/org/tender-portfolio?orgId=&from=&to= — Tender 组合分析（org 级）
 *
 * 「2026-06-01 至 2026-08-31 一共投了多少项目？中了几个？没中几个？
 *   投标烧了多少钱？中标项目预测/最终利润多少？最常见的失败原因是什么？」
 *
 * cohort 的 canonical 日期 = `Project.submittedAt`（我方投标提交时间）。
 * 全部聚合在服务端完成（前端零遍历）；forecast 与 final 利润严格分离，绝不相加。
 *
 * 授权：复用既有 org 解析（resolveRequestOrgIdForUser，管理员须显式 orgId），
 * 再叠加财务功能面 flag —— 与 per-project 财务路由同一 dark 纪律。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { financeDisabledResponse } from "@/lib/project-finance/access";
import { getTenderPortfolioSummary } from "@/lib/project-finance";

/** 缺省窗口 = 最近 12 个月（不猜「本年度」等业务口径）。 */
const DEFAULT_WINDOW_DAYS = 365;

function parseDate(raw: string | null, fallback: Date): Date | null {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = withAuth(async (request, _ctx, user) => {
  const disabled = financeDisabledResponse();
  if (disabled) return disabled;

  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const from = parseDate(searchParams.get("from"), defaultFrom);
  const to = parseDate(searchParams.get("to"), now);
  if (!from || !to) {
    return NextResponse.json({ error: "from / to 必须是合法日期" }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "from 不得晚于 to" }, { status: 400 });
  }

  const summary = await getTenderPortfolioSummary(orgRes.orgId, { from, to });
  return NextResponse.json({ orgId: orgRes.orgId, ...summary });
});
