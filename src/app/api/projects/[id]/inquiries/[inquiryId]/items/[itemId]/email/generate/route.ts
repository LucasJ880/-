/**
 * POST /api/projects/[id]/inquiries/[inquiryId]/items/[itemId]/email/generate — 已下线（W-1，Evan 2026-11-06 拍板）
 *
 * 原功能：单封邮件草稿生成（配套单封直发）。
 * 现在发询价：项目「标书与报价」→「问供应商要价」→ 送审（tender.send_rfq）→ 批准后从组织授权邮箱发出，回信自动进表。
 * 保留路由文件并显式返回 410，避免旧客户端拿到 404 误以为是网络问题。本路由不发邮件、不调 LLM、不写任何数据。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

const LEGACY_DIRECT_EMAIL_GONE_MESSAGE = "单封直发已下线，请用项目页「问供应商要价」";

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  return NextResponse.json(
    { error: LEGACY_DIRECT_EMAIL_GONE_MESSAGE, code: "GONE", next: `/projects/${projectId}?tab=bid` },
    { status: 410 },
  );
}
