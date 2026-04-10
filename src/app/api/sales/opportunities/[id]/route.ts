import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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

  const updated = await db.salesOpportunity.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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
}
