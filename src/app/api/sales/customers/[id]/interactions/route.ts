import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { id: customerId } = await params;
  const body = await request.json();

  if (!body.summary?.trim()) {
    return NextResponse.json({ error: '摘要不能为空' }, { status: 400 });
  }

  const interaction = await db.customerInteraction.create({
    data: {
      customerId,
      opportunityId: body.opportunityId || null,
      type: body.type || 'note',
      direction: body.direction || null,
      summary: body.summary.trim(),
      content: body.content?.trim() || null,
      createdById: user.id,
    },
    include: {
      createdBy: { select: { name: true } },
    },
  });

  if (body.opportunityId) {
    await db.salesOpportunity.update({
      where: { id: body.opportunityId },
      data: { updatedAt: new Date() },
    });
  }

  return NextResponse.json(interaction, { status: 201 });
}
