/**
 * AI 秘书一键动作 API
 *
 * POST — 执行一个动作（生成草稿、延期报价、批准客户等）
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { executeAction } from "@/lib/secretary/actions";
import type { ActionType } from "@/lib/secretary/actions";

const VALID_TYPES: ActionType[] = [
  "followup_draft",
  "quote_extend",
  "prospect_approve",
  "prospect_skip",
  "send_draft",
];

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  try {
    const result = await executeAction({
      type: body.type,
      entityId: body.entityId,
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
}
