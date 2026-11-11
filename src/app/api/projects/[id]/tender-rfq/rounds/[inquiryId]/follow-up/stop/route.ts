/**
 * POST /api/projects/[id]/tender-rfq/rounds/[inquiryId]/follow-up/stop（RFQ-AUTO-1）
 *
 * 停止这一轮的自动跟进：立即生效、不可恢复、留审计。之后这一轮的催单与追问退回逐张待批。
 * 本路由不发信、不建审批卡。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { stopRoundFollowUp } from "@/lib/tender-rfq/followup-service";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

const STATUS_OF = { DISABLED: 404, ROUND_NOT_FOUND: 404, NO_POLICY: 409 } as const;

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ ok: false, error: "这个项目不属于任何组织。" }, { status: 404 });

  const result = await stopRoundFollowUp({ orgId, projectId, inquiryId, userId: access.user.id });
  if (!result.ok) return NextResponse.json({ ok: false, errorCode: result.errorCode, error: result.message }, { status: STATUS_OF[result.errorCode] });
  return NextResponse.json({ ok: true, alreadyStopped: result.alreadyStopped });
}
