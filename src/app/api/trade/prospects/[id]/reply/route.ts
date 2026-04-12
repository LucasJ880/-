/**
 * POST /api/trade/prospects/[id]/reply
 *
 * 记录客户回复 → AI 自动分类意图 → 生成建议回复
 * body: { content: string, subject?: string, channel?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getProspect, updateProspect, createMessage } from "@/lib/trade/service";
import { classifyReply } from "@/lib/trade/agents";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) {
    return NextResponse.json({ error: "线索不存在" }, { status: 404 });
  }

  const body = await request.json();
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });
  }

  const conversationHistory = prospect.messages
    .slice(-6)
    .map((m) => `[${m.direction}] ${m.subject ?? ""}\n${m.content}`)
    .join("\n---\n");

  const classification = await classifyReply(body.content, conversationHistory);

  const message = await createMessage({
    prospectId: id,
    direction: "inbound",
    channel: body.channel ?? "email",
    subject: body.subject ?? null,
    content: body.content,
    intent: classification.intent,
    sentiment: classification.confidence >= 0.7 ? "high_confidence" : "low_confidence",
  });

  const stageMap: Record<string, string> = {
    interested: "interested",
    question: "replied",
    request_sample: "interested",
    objection: "negotiating",
    not_interested: "lost",
    ooo: prospect.stage,
    unclear: "replied",
  };

  const newStage = stageMap[classification.intent] ?? "replied";
  const now = new Date();

  const followUpDays: Record<string, number> = {
    interested: 1,
    question: 1,
    request_sample: 2,
    objection: 2,
    not_interested: 30,
    ooo: 5,
    unclear: 3,
  };

  const nextFollowUp = new Date(now);
  nextFollowUp.setDate(nextFollowUp.getDate() + (followUpDays[classification.intent] ?? 3));

  await updateProspect(id, {
    stage: newStage,
    lastContactAt: now,
    nextFollowUpAt: nextFollowUp,
    followUpCount: { increment: 1 },
  });

  if (classification.draftReply) {
    await createMessage({
      prospectId: id,
      direction: "outbound",
      channel: body.channel ?? "email",
      content: classification.draftReply,
      aiDraft: true,
    });
  }

  return NextResponse.json({
    message,
    classification,
    newStage,
    nextFollowUpAt: nextFollowUp.toISOString(),
    draftReply: classification.draftReply ?? null,
  });
}
