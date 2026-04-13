import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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
}
