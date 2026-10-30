import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import {
  resolveSalesAuthorizedWhere,
  resolveSalesOrgIdForRequest,
} from '@/lib/sales/org-context';

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const authz = await resolveSalesAuthorizedWhere(
    user,
    orgRes.orgId,
    'sales.quote.read',
    'sales_quote',
  );
  if (!authz.ok) return authz.response;

  const baseWhere: Record<string, unknown> = {
    ...authz.where,
    customer: { archivedAt: null },
  };
  // STAT-1：按报价创建人筛选——在既有授权范围内再加条件（服务端筛，不是在最近 200 份里筛）
  const createdById = request.nextUrl.searchParams.get('createdById')?.trim() || null;
  const where: Record<string, unknown> = createdById ? { AND: [baseWhere, { createdById }] } : baseWhere;

  const quotes = await db.salesQuote.findMany({
    where,
    select: {
      id: true,
      customerId: true,
      version: true,
      status: true,
      installMode: true,
      grandTotal: true,
      currency: true,
      shareToken: true,
      viewedAt: true,
      createdAt: true,
      updatedAt: true,
      depositAmount: true,
      depositMethod: true,
      depositCollectedAt: true,
      agreedDepositAmount: true,
      agreedBalanceAmount: true,
      customer: {
        select: { id: true, name: true, phone: true, email: true },
      },
      opportunity: {
        select: { id: true, title: true, stage: true },
      },
      items: {
        select: { product: true, fabric: true },
      },
      createdBy: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // 授权范围内出现过的报价创建人（"按销售"下拉；只看本人时只有本人）
  const creators = await db.salesQuote.groupBy({ by: ['createdById'], where: baseWhere });
  const users = creators.length
    ? await db.user.findMany({
        where: { id: { in: creators.map((c) => c.createdById) } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const reps = users
    .map((u) => ({ id: u.id, name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

  return NextResponse.json({ quotes, reps });
});
