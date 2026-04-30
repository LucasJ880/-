import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { isSuperAdmin } from '@/lib/rbac/roles';
import { db } from '@/lib/db';
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
} from '@/lib/sales/org-context';

// 漏斗状态定义（需与 /api/sales/analytics/customer-matrix 保持一致）
const SIGNED_STAGES = new Set(['signed', 'producing', 'installing', 'completed']);
type FunnelStatus = 'new' | 'quoted' | 'signed' | 'lost';

function deriveFunnelStatus(stages: string[], quoteCount: number): FunnelStatus {
  if (stages.some((s) => SIGNED_STAGES.has(s))) return 'signed';
  if (quoteCount > 0 || stages.includes('quoted')) return 'quoted';
  if (stages.length > 0 && stages.every((s) => s === 'lost') && quoteCount === 0) return 'lost';
  return 'new';
}

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

  const includeArchived = searchParams.get('includeArchived') === '1';

  // —— admin 专用筛选 ——
  const createdByIdParam = searchParams.get('createdById'); // 指定归属销售
  const startDateStr = searchParams.get('startDate');       // 按创建时间过滤
  const endDateStr = searchParams.get('endDate');
  const funnelStatusFilter = searchParams.get('funnelStatus') as FunnelStatus | null;

  const where: Record<string, unknown> = {};
  if (!isSuperAdmin(user.role)) {
    where.createdById = user.id;
  } else if (createdByIdParam) {
    where.createdById = createdByIdParam;
  }
  // 默认过滤归档；仅 admin 且显式要求 ?includeArchived=1 时才返回
  if (!(isSuperAdmin(user.role) && includeArchived)) {
    where.archivedAt = null;
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

  // 时间区间（按 createdAt）
  if (startDateStr || endDateStr) {
    const range: Record<string, Date> = {};
    if (startDateStr) {
      const d = new Date(startDateStr);
      if (!Number.isNaN(d.getTime())) range.gte = d;
    }
    if (endDateStr) {
      const d = new Date(endDateStr);
      if (!Number.isNaN(d.getTime())) {
        // 包含结束日当天：转成次日 00:00 的开区间
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 1);
        range.lt = d;
      }
    }
    if (Object.keys(range).length > 0) {
      where.createdAt = range;
    }
  }

  // funnelStatus 过滤无法直接下沉到 Prisma where（需要先聚合机会 + 报价数），
  // 所以先查出候选集、再在内存里过滤 + 重新分页。
  // 在 funnelStatus 无值时走原来的分页路径，性能最佳。
  if (funnelStatusFilter && isSuperAdmin(user.role)) {
    const all = await db.salesCustomer.findMany({
      where,
      include: {
        opportunities: { select: { id: true, title: true, stage: true, estimatedValue: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { interactions: true, quotes: true, blindsOrders: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const filtered = all
      .map((c) => ({
        ...c,
        funnelStatus: deriveFunnelStatus(
          c.opportunities.map((o) => o.stage),
          c._count.quotes,
        ),
      }))
      .filter((c) => c.funnelStatus === funnelStatusFilter);
    const total = filtered.length;
    const sliced = filtered.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({ customers: sliced, total, page, pageSize });
  }

  const [customers, total] = await Promise.all([
    db.salesCustomer.findMany({
      where,
      include: {
        opportunities: { select: { id: true, title: true, stage: true, estimatedValue: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { interactions: true, quotes: true, blindsOrders: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.salesCustomer.count({ where }),
  ]);

  const customersWithFunnel = customers.map((c) => ({
    ...c,
    funnelStatus: deriveFunnelStatus(
      c.opportunities.map((o) => o.stage),
      c._count.quotes,
    ),
  }));

  return NextResponse.json({ customers: customersWithFunnel, total, page, pageSize });
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
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === 'string' ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '客户名称不能为空' }, { status: 400 });
  }

  const incomingPhone = body.phone?.trim() || null;
  const incomingAddress = body.address?.trim() || null;
  const mergeToCustomerId: string | null = body.mergeToCustomerId ?? null;
  const phoneNorm = normalizePhone(incomingPhone);

  // 电话唯一性校验：仅当提供电话时进行；范围限于当前销售名下
  if (phoneNorm) {
    // TODO remove legacy OR orgId null after sales orgId backfill（仅同用户跨历史空 orgId 去重）
    const candidates = await db.salesCustomer.findMany({
      where: {
        createdById: user.id,
        phone: { not: null },
        OR: [{ orgId }, { orgId: null }],
      },
      select: { id: true, name: true, phone: true, address: true },
    });
    const existing = candidates.find((c) => normalizePhone(c.phone) === phoneNorm);

    if (existing) {
      // 前端确认后传来 mergeToCustomerId，执行"同一客户追加新地址"
      if (mergeToCustomerId && mergeToCustomerId === existing.id) {
        const target = await db.salesCustomer.findFirst({
          where: { id: existing.id, archivedAt: null },
          select: { id: true, orgId: true, createdById: true, address: true },
        });
        if (!target) {
          return NextResponse.json({ error: '客户不存在' }, { status: 404 });
        }
        const denied = await assertSalesCustomerInOrgForMutation(target, orgId);
        if (denied) return denied;
        const merged = mergeAddress(target.address, incomingAddress);
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
      orgId,
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
