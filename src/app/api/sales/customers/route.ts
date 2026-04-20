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

/** 归一化电话（只保留数字），用于唯一性比对 */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** 去重拼接地址：已存在则不重复添加，否则按换行分隔追加 */
function mergeAddress(current: string | null, incoming: string | null): string | null {
  const next = incoming?.trim();
  if (!next) return current;
  const existing = (current ?? '')
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (existing.some((a) => a === next)) return current;
  return existing.length > 0 ? `${existing.join('\n')}\n${next}` : next;
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: '客户名称不能为空' }, { status: 400 });
  }

  const incomingPhone = body.phone?.trim() || null;
  const incomingAddress = body.address?.trim() || null;
  const mergeToCustomerId: string | null = body.mergeToCustomerId ?? null;
  const phoneNorm = normalizePhone(incomingPhone);

  // 电话唯一性校验：仅当提供电话时进行；范围限于当前销售名下
  if (phoneNorm) {
    const candidates = await db.salesCustomer.findMany({
      where: { createdById: user.id, phone: { not: null } },
      select: { id: true, name: true, phone: true, address: true },
    });
    const existing = candidates.find((c) => normalizePhone(c.phone) === phoneNorm);

    if (existing) {
      // 前端确认后传来 mergeToCustomerId，执行"同一客户追加新地址"
      if (mergeToCustomerId && mergeToCustomerId === existing.id) {
        const merged = mergeAddress(existing.address, incomingAddress);
        const updated = await db.salesCustomer.update({
          where: { id: existing.id },
          data: { address: merged },
        });
        return NextResponse.json(
          { ...updated, _merged: true },
          { status: 200 },
        );
      }
      // 否则直接拒绝，并把现有客户信息返回给前端做二次确认
      return NextResponse.json(
        {
          error: 'customer_exists',
          message: '该电话号码已绑定到现有客户',
          existingCustomer: {
            id: existing.id,
            name: existing.name,
            phone: existing.phone,
            address: existing.address,
          },
        },
        { status: 409 },
      );
    }
  }

  const customer = await db.salesCustomer.create({
    data: {
      name: body.name.trim(),
      phone: incomingPhone,
      email: body.email?.trim() || null,
      address: incomingAddress,
      source: body.source || null,
      wechatNote: body.wechatNote?.trim() || null,
      notes: body.notes?.trim() || null,
      tags: body.tags?.trim() || null,
      createdById: user.id,
    },
  });

  return NextResponse.json(customer, { status: 201 });
});
