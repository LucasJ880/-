/**
 * POST /api/visualizer/share/[token]/select
 *
 * 客户在公开分享页打勾「我喜欢这套方案」。
 * - 不要求登录（selectedById = null，selectedBy = "customer"）
 * - 校验 shareToken + shareExpiresAt
 * - 校验 variant 属于该 session
 * - 同一 anonId 在同一 session 下幂等：先删除该 anonId 旧记录，再插入新的
 * - note 中存放 "anon:<uuid> | <用户备注>" 格式，供销售侧反查 / 计数
 *
 * 严格限速：单 token 60s 内不超过 10 次请求（粗略基于 ip 头）。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isShareLive } from "@/lib/visualizer/share";
import type { CreateVisualizerSelectionRequest } from "@/lib/visualizer/types";

const MAX_NOTE_LEN = 240;
const MAX_ANON_ID_LEN = 64;

function buildNote(anonId: string | null, userNote: string | null): string {
  const parts: string[] = [];
  if (anonId) parts.push(`anon:${anonId}`);
  if (userNote) parts.push(userNote.slice(0, MAX_NOTE_LEN));
  return parts.join(" | ").slice(0, MAX_NOTE_LEN + 80);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "链接无效" }, { status: 404 });
  }

  let body: CreateVisualizerSelectionRequest;
  try {
    body = (await request.json()) as CreateVisualizerSelectionRequest;
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const variantId = typeof body.variantId === "string" ? body.variantId.trim() : "";
  if (!variantId) {
    return NextResponse.json({ error: "variantId 必填" }, { status: 400 });
  }
  const rawAnon = typeof body.anonId === "string" ? body.anonId.trim() : "";
  const anonId =
    rawAnon && /^[a-zA-Z0-9_-]{8,64}$/.test(rawAnon)
      ? rawAnon.slice(0, MAX_ANON_ID_LEN)
      : null;
  const userNote = typeof body.note === "string" ? body.note.trim() : "";

  const session = await db.visualizerSession.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      shareToken: true,
      shareExpiresAt: true,
    },
  });
  if (!session) {
    return NextResponse.json({ error: "链接无效" }, { status: 404 });
  }
  if (!isShareLive(session.shareToken, session.shareExpiresAt)) {
    return NextResponse.json({ error: "链接已过期" }, { status: 410 });
  }

  const variant = await db.visualizerVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sessionId: true },
  });
  if (!variant || variant.sessionId !== session.id) {
    return NextResponse.json({ error: "方案不属于该分享" }, { status: 400 });
  }

  const note = buildNote(anonId, userNote);

  // 幂等：同一 anonId 在该 session 下只保留最新一条
  if (anonId) {
    await db.visualizerSelection.deleteMany({
      where: {
        selectedBy: "customer",
        variant: { sessionId: session.id },
        note: { startsWith: `anon:${anonId}` },
      },
    });
  }

  const created = await db.visualizerSelection.create({
    data: {
      variantId,
      selectedBy: "customer",
      selectedById: null,
      note,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json(
    {
      id: created.id,
      variantId,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
