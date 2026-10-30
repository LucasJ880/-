/**
 * GET  /api/sales/inquiries/:id — 商机询问详情（TASKFLOW S2，只给负责人或发起人看）
 * POST /api/sales/inquiries/:id — 负责人在网页回复（与 Muse reply_inquiry 同一服务，渠道记为 web）
 *
 * 其余登录用户一律 404，不透露询问是否存在。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/common/api-helpers";
import { MUSE_INQUIRY_NEEDS } from "@/lib/muse-bridge/contract";
import { getInquiryForUser, replyInquiry } from "@/lib/muse-bridge/inquiry";

const ReplySchema = z
  .object({
    nextStep: z.string().trim().min(1).max(300),
    customerFeedback: z.string().trim().max(1000).optional(),
    lastContactAt: z.string().datetime().optional(),
    nextStepDueAt: z.string().datetime().optional(),
    needs: z.array(z.enum(MUSE_INQUIRY_NEEDS)).max(5).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

const NOT_FOUND = { error: "没找到这条询问。", code: "INQUIRY_NOT_FOUND" } as const;

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const inquiry = await getInquiryForUser(user.id, id);
  return inquiry ? NextResponse.json(inquiry) : NextResponse.json(NOT_FOUND, { status: 404 });
});

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const parsed = ReplySchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "请填写下一步，其余字段格式需正确。", code: "VALIDATION_FAILED" }, { status: 400 });
  }
  const result = await replyInquiry({ userId: user.id, orgId: null }, { inquiryId: id, ...parsed.data }, "web");
  if (result.ok) return NextResponse.json(result.data);
  const status = result.errorCode === "INQUIRY_NOT_FOUND" ? 404 : result.errorCode === "INQUIRY_CLOSED" ? 409 : 400;
  return NextResponse.json({ error: result.message, code: result.errorCode }, { status });
});
