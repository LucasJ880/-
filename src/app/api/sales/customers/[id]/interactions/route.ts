import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import { detectLanguage, extractTopicTags } from '@/lib/ai';
import { indexCommunication } from '@/lib/sales/knowledge-pipeline';

export const POST = withAuth(async (request, ctx, user) => {
  const { id: customerId } = await ctx.params;
  const body = await request.json();

  if (!body.summary?.trim()) {
    return NextResponse.json({ error: '摘要不能为空' }, { status: 400 });
  }

  const textForAnalysis = `${body.summary} ${body.content || ""}`;
  const autoLanguage = detectLanguage(textForAnalysis);
  const autoTags = extractTopicTags(textForAnalysis);

  const interaction = await db.customerInteraction.create({
    data: {
      customerId,
      opportunityId: body.opportunityId || null,
      type: body.type || 'note',
      direction: body.direction || null,
      summary: body.summary.trim(),
      content: body.content?.trim() || null,
      channel: body.channel || null,
      language: body.language || autoLanguage,
      topicTags: body.topicTags || autoTags.join(",") || null,
      sentiment: body.sentiment || null,
      outcome: body.outcome || null,
      createdById: user.id,
    },
    include: {
      createdBy: { select: { name: true } },
    },
  });

  if (body.opportunityId) {
    await db.salesOpportunity.update({
      where: { id: body.opportunityId },
      data: { updatedAt: new Date() },
    });
  }

  const textContent = `${body.summary} ${body.content || ""}`.trim();
  if (textContent.length > 20) {
    indexCommunication({
      sourceType: (body.channel as "email" | "wechat" | "call_transcript" | "note") || "note",
      content: textContent,
      customerId,
      opportunityId: body.opportunityId || undefined,
      interactionId: interaction.id,
      metadata: {
        direction: body.direction || undefined,
        language: body.language || autoLanguage,
      },
    }).catch((err) => console.error("[RAG] Auto-index interaction failed:", err));

    import("@/lib/sales/profile-engine")
      .then(({ updateCustomerProfile }) =>
        updateCustomerProfile({ customerId }),
      )
      .catch((err) => console.error("[RAG] Auto-update profile failed:", err));
  }

  return NextResponse.json(interaction, { status: 201 });
});
