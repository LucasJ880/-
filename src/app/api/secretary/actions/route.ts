/**
 * AI 秘书一键动作 API
 *
 * POST — 执行一个动作（生成草稿、延期报价、批准客户等）
 */

import { NextResponse } from "next/server";
import { executeAction } from "@/lib/secretary/actions";
import type { ActionType } from "@/lib/secretary/actions";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveTradeOrgId } from "@/lib/trade/access";

const VALID_TYPES: ActionType[] = [
  "followup_draft",
  "quote_extend",
  "prospect_approve",
  "prospect_skip",
  "send_draft",
];

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => null);
  if (!body?.type || !body?.entityId) {
    return NextResponse.json(
      { error: "需要 type 和 entityId" },
      { status: 400 },
    );
  }

  if (!VALID_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `不支持的动作类型: ${body.type}` },
      { status: 400 },
    );
  }

  const orgRes = await resolveTradeOrgId(request, user, { bodyOrgId: body?.orgId });
  if (!orgRes.ok) return orgRes.response;

  try {
    const result = await executeAction({
      type: body.type,
      entityId: body.entityId,
      orgId: orgRes.orgId,
      params: body.params,
    });

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    });
  } catch (e) {
    console.error("[secretary/actions] Error:", e);
    return NextResponse.json(
      { success: false, error: "动作执行失败", detail: String(e) },
      { status: 500 },
    );
  }
});
