/**
 * POST /api/trade/prospects/[id]/reply
 *
 * 记录客户回复 → AI 自动分类意图 → 生成建议回复
 * body: { content: string, subject?: string, channel?: string, orgId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateProspect, createMessage } from "@/lib/trade/service";
import { classifyReply } from "@/lib/trade/agents";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { normalizeTradeProspectStage, type TradeProspectStage } from "@/lib/trade/stage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { prospect } = loaded;

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });
  }

  const conversationHistory = (prospect.messages ?? [])
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

  const stageMap: Record<string, TradeProspectStage> = {
    interested: "follow_up",
    question: "replied",
    request_sample: "follow_up",
    objection: "follow_up",
    not_interested: "lost",
    unclear: "replied",
  };

  const newStage: TradeProspectStage =
    classification.intent === "ooo"
      ? normalizeTradeProspectStage(prospect.stage)
      : stageMap[classification.intent] ?? "replied";
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
