import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const stage = searchParams.get('stage') || '';
  const priority = searchParams.get('priority') || '';
  const customerId = searchParams.get('customerId') || '';

  const where: Record<string, unknown> = {};
  if (stage) where.stage = stage;
  if (priority) where.priority = priority;
  if (customerId) where.customerId = customerId;

  const opportunities = await db.salesOpportunity.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      _count: { select: { interactions: true, quotes: true, blindsOrders: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ opportunities });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.customerId || !body.title?.trim()) {
    return NextResponse.json({ error: '客户 ID 和标题不能为空' }, { status: 400 });
  }

  const opportunity = await db.salesOpportunity.create({
    data: {
      customerId: body.customerId,
      title: body.title.trim(),
      stage: body.stage || 'new_inquiry',
      estimatedValue: body.estimatedValue ? parseFloat(body.estimatedValue) : null,
      windowCount: body.windowCount ? parseInt(body.windowCount) : null,
      productTypes: body.productTypes || null,
      priority: body.priority || 'warm',
      assignedToId: body.assignedToId || null,
      createdById: user.id,
    },
  });

  return NextResponse.json(opportunity, { status: 201 });
}
