import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
} from '@/lib/sales/org-context';
import { detectLanguage, extractTopicTags } from '@/lib/ai';
import { indexCommunication } from '@/lib/sales/knowledge-pipeline';

export const POST = withAuth(async (request, ctx, user) => {
  const { id: customerId } = await ctx.params;
  const body = await request.json();

  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === 'string' ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  if (!body.summary?.trim()) {
    return NextResponse.json({ error: '摘要不能为空' }, { status: 400 });
  }

  const customer = await db.salesCustomer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!customer) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }
  const denied = await assertSalesCustomerInOrgForMutation(customer, orgRes.orgId, {
    user,
    permission: "sales.customer.read",
  });
  if (denied) return denied;

  const opportunityId = typeof body.opportunityId === 'string' && body.opportunityId ? body.opportunityId : null;
  if (opportunityId) {
    const matches = await db.salesOpportunity.count({
      where: { id: opportunityId, customerId, orgId: orgRes.orgId },
    });
    if (!matches) {
      return NextResponse.json({ error: '商机与当前客户不匹配' }, { status: 400 });
    }
  }
  const nextFollowupAt = body.nextFollowupAt ? new Date(body.nextFollowupAt) : null;
  if (nextFollowupAt && (Number.isNaN(nextFollowupAt.getTime()) || nextFollowupAt.getTime() <= Date.now())) {
    return NextResponse.json({ error: '下次跟进时间必须晚于当前时间' }, { status: 400 });
  }

  const textForAnalysis = `${body.summary} ${body.content || ""}`;
  const autoLanguage = detectLanguage(textForAnalysis);
  const autoTags = extractTopicTags(textForAnalysis);

  const interaction = await db.customerInteraction.create({
    data: {
      orgId: orgRes.orgId,
      customerId,
      opportunityId,
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

  if (opportunityId) {
    await db.salesOpportunity.update({
      where: { id: opportunityId },
      data: { updatedAt: new Date(), ...(nextFollowupAt ? { nextFollowupAt } : {}) },
    });
  }

  const textContent = `${body.summary} ${body.content || ""}`.trim();
  if (textContent.length > 20) {
    indexCommunication({
      sourceType: (body.channel as "email" | "wechat" | "call_transcript" | "note") || "note",
      content: textContent,
      customerId,
      opportunityId: opportunityId || undefined,
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
