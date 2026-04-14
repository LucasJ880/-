import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';

export const GET = withAuth(async (_request, _ctx, user) => {
  const quotes = await db.salesQuote.findMany({
    where: user.role === 'admin' || user.role === 'super_admin'
      ? {}
      : { createdById: user.id },
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
