import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { isSuperAdmin } from '@/lib/rbac/roles';
import { db } from '@/lib/db';

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const stage = searchParams.get('stage') || '';
  const priority = searchParams.get('priority') || '';
  const customerId = searchParams.get('customerId') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)),
  );

  const where: Record<string, unknown> = {};
  if (!isSuperAdmin(user.role)) {
    where.OR = [{ createdById: user.id }, { assignedToId: user.id }];
  }
  if (stage) where.stage = stage;
  if (priority) where.priority = priority;
  if (customerId) where.customerId = customerId;

  const [opportunities, total] = await Promise.all([
    db.salesOpportunity.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { grandTotal: true, status: true, createdAt: true },
        },
        _count: { select: { interactions: true, quotes: true, blindsOrders: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.salesOpportunity.count({ where }),
  ]);

  const enriched = opportunities.map((o) => ({
    ...o,
    latestQuoteTotal: o.quotes[0]?.grandTotal ?? null,
    latestQuoteStatus: o.quotes[0]?.status ?? null,
    quotes: undefined,
  }));

  return NextResponse.json({ opportunities: enriched, total, page, pageSize });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  if (!body.customerId || !body.title?.trim()) {
    return NextResponse.json({ error: '客户 ID 和标题不能为空' }, { status: 400 });
  }

  const opportunity = await db.salesOpportunity.create({
    data: {
      customerId: body.customerId,
      title: body.title.trim(),
      stage: body.stage || 'new_lead',
      estimatedValue: body.estimatedValue ? parseFloat(body.estimatedValue) : null,
      windowCount: body.windowCount ? parseInt(body.windowCount) : null,
      productTypes: body.productTypes || null,
      priority: body.priority || 'warm',
      assignedToId: body.assignedToId || null,
      createdById: user.id,
    },
  });

  return NextResponse.json(opportunity, { status: 201 });
});
