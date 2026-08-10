/**
 * GET /api/workforce/jobs — Workforce Job Center 列表（2D-1，只读）
 *
 * 鉴权：withAuth（登录 + 账号 active）→ resolveWorkforceApiOrgForUser
 * （与单 Job 路由共用同一份 org access 逻辑：activeOrgId 仅是偏好，
 * canUserUseOrg 现查重授权；stale/revoked/archived 不得使用；
 * 多可用 org 不随机代选 → 403 needsSelection）。
 *
 * 查询参数（全部 fail-closed 校验）：
 * - status: all|working|needs_you|completed|failed|cancelled（缺省 all）
 * - limit: 1..50（缺省 20；非法 → 400）
 * - cursor: 上一页返回的游标（篡改/非法 → 400）
 *
 * 排序恒为 updatedAt DESC（最近活跃优先）。无任何写入路径。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  decodeWorkforceJobsCursor,
  encodeWorkforceJobsCursor,
  isWorkforceJobStatusFilter,
  listWorkforceJobViews,
  resolveWorkforceApiOrgForUser,
  workforceOrgFailureHttp,
} from "@/lib/workforce-runtime/read-model";
import type { WorkforceJobsCursor } from "@/lib/workforce-runtime/read-model";

export const GET = withAuth(async (req, _ctx, user) => {
  const resolution = await resolveWorkforceApiOrgForUser({
    id: user.id,
    role: user.role,
  });
  if (!resolution.ok) {
    const { status, body } = workforceOrgFailureHttp(resolution.reason);
    return NextResponse.json(body, { status });
  }

  const params = req.nextUrl.searchParams;

  const statusParam = params.get("status") ?? "all";
  if (!isWorkforceJobStatusFilter(statusParam)) {
    return NextResponse.json({ error: "无效的状态筛选" }, { status: 400 });
  }

  let limit = 20;
  const limitParam = params.get("limit");
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return NextResponse.json({ error: "无效的分页大小" }, { status: 400 });
    }
    limit = parsed;
  }

  let cursor: WorkforceJobsCursor | null = null;
  const cursorParam = params.get("cursor");
  if (cursorParam !== null) {
    cursor = decodeWorkforceJobsCursor(cursorParam);
    if (!cursor) {
      return NextResponse.json({ error: "无效的分页游标" }, { status: 400 });
    }
  }

  const result = await listWorkforceJobViews({
    orgId: resolution.orgId,
    status: statusParam,
    limit,
    cursor,
  });

  return NextResponse.json({
    jobs: result.items,
    nextCursor: result.nextCursor
      ? encodeWorkforceJobsCursor(result.nextCursor)
      : null,
  });
});
