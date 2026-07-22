import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from '@/lib/audit/logger';
import { authorize, humanPrincipal } from '@/lib/authorization';
import { isAdmin, isSuperAdmin } from '@/lib/rbac/roles';
import {
  resolveSalesOrgIdForRequest,
} from '@/lib/sales/org-context';

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const customer = await db.salesCustomer.findFirst({
    where: { id, orgId: orgRes.orgId },
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

  if (!isAdmin(user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: 'sales.customer.read',
      resource: {
        type: 'sales_customer',
        id: customer.id,
        ownerId: customer.createdById,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: '无权访问该客户', code: decision.reasonCode },
        { status: 403 },
      );
    }
  }

  return NextResponse.json(customer);
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const customer = await db.salesCustomer.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true, createdById: true, archivedAt: true },
  });
  if (!customer) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }
  if (customer.archivedAt) {
    return NextResponse.json({ error: '该客户已归档，不可修改' }, { status: 400 });
  }

  // Security-1：sales.customer.update + Scope；另保留 canEditCustomers 细开关
  if (!isAdmin(user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: 'sales.customer.update',
      resource: {
        type: 'sales_customer',
        id: customer.id,
        ownerId: customer.createdById,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: '无权修改该客户', code: decision.reasonCode },
        { status: 403 },
      );
    }
    if (decision.matchedScope !== 'ORG') {
      const currentUser = await db.user.findUnique({
        where: { id: user.id },
        select: { canEditCustomers: true },
      });
      if (currentUser?.canEditCustomers === false) {
        return NextResponse.json(
          { error: '管理员暂未授权你修改客户信息，请联系管理员' },
          { status: 403 },
        );
      }
    }
  }

  const body = await request.json();

  const allowedFields = [
    'name', 'phone', 'email', 'address', 'source',
    'wechatNote', 'status', 'tags', 'notes',
  ];

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) data[key] = body[key];
  }

  const updated = await db.salesCustomer.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
});

/**
 * DELETE /api/sales/customers/[id]
 * 仅 admin/super_admin 可调。软删：设置 archivedAt = now()。
 * 不级联删除 quote / order / interaction 等关联数据，确保可审计。
 */
export const DELETE = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: '仅管理员可删除客户' }, { status: 403 });
  }

  const customer = await db.salesCustomer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { opportunities: true, quotes: true, blindsOrders: true } },
    },
  });
  if (!customer) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 });
  }
  if (customer.archivedAt) {
    return NextResponse.json({ error: '该客户已归档' }, { status: 400 });
  }

  const archivedAt = new Date();
  await db.salesCustomer.update({
    where: { id },
    data: { archivedAt },
  });

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.DELETE,
    targetType: AUDIT_TARGETS.SALES_CUSTOMER,
    targetId: id,
    beforeData: { name: customer.name, archivedAt: null, counts: customer._count },
    afterData: { archivedAt: archivedAt.toISOString() },
    request,
  });

  return NextResponse.json({ ok: true, archivedAt: archivedAt.toISOString() });
});
