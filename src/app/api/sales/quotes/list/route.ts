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

  const where: Record<string, unknown> = { ...authz.where };

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
        select: { name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({ quotes });
});
