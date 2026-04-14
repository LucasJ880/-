import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import { onDealWon, onDealLost } from '@/lib/sales/opportunity-lifecycle';

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const allowedFields = [
    'title', 'stage', 'estimatedValue', 'priority',
    'productTypes', 'windowCount', 'nextFollowupAt', 'notes',
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) {
      if (key === 'estimatedValue') {
        data[key] = body[key] !== null ? parseFloat(body[key]) : null;
      } else if (key === 'windowCount') {
        data[key] = body[key] !== null ? parseInt(body[key]) : null;
      } else if (key === 'nextFollowupAt') {
        data[key] = body[key] ? new Date(body[key]) : null;
      } else {
        data[key] = body[key];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  if (body.stage === "completed" && !data.wonAt) {
    data.wonAt = new Date();
  }
  if (body.stage === "lost" && !data.lostAt) {
    data.lostAt = new Date();
  }
  if (body.lostReason !== undefined) {
    data.lostReason = body.lostReason;
  }

  const updated = await db.salesOpportunity.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  if (body.stage === "completed") {
    onDealWon(id).catch((e) => console.error("[RAG] onDealWon error:", e));
  } else if (body.stage === "lost") {
    onDealLost(id).catch((e) => console.error("[RAG] onDealLost error:", e));
  }

  return NextResponse.json(updated);
});

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;

  const opportunity = await db.salesOpportunity.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 5 },
      interactions: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  if (!opportunity) {
    return NextResponse.json({ error: '机会不存在' }, { status: 404 });
  }

  return NextResponse.json(opportunity);
});
