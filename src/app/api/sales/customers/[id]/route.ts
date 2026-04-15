import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;

  const customer = await db.salesCustomer.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { quotes: true, blindsOrders: true } },
        },
      },
      interactions: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          createdBy: { select: { name: true } },
        },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          items: true,
          addons: true,
        },
      },
      blindsOrders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }

  return NextResponse.json(customer);
});

export const PATCH = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await request.json();

  const allowedFields = [
    'name', 'phone', 'email', 'address', 'source',
    'wechatNote', 'status', 'tags', 'notes',
  ];

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) data[key] = body[key];
  }

  const customer = await db.salesCustomer.update({
    where: { id },
    data,
  });

  return NextResponse.json(customer);
});
