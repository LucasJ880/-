import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { isSuperAdmin } from '@/lib/rbac/roles';
import { db } from '@/lib/db';

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

  const where: Record<string, unknown> = {};
  if (!isSuperAdmin(user.role)) {
    where.createdById = user.id;
  }
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [customers, total] = await Promise.all([
    db.salesCustomer.findMany({
      where,
      include: {
        opportunities: { select: { id: true, title: true, stage: true, estimatedValue: true } },
        _count: { select: { interactions: true, quotes: true, blindsOrders: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.salesCustomer.count({ where }),
  ]);

  return NextResponse.json({ customers, total, page, pageSize });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: '客户名称不能为空' }, { status: 400 });
  }

  const customer = await db.salesCustomer.create({
    data: {
      name: body.name.trim(),
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      source: body.source || null,
      wechatNote: body.wechatNote?.trim() || null,
      notes: body.notes?.trim() || null,
      tags: body.tags?.trim() || null,
      createdById: user.id,
    },
  });

  return NextResponse.json(customer, { status: 201 });
});
