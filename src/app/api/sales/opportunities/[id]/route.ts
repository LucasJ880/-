import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/common/api-helpers';
import { authorize, humanPrincipal } from '@/lib/authorization';
import { db } from '@/lib/db';
import { isAdmin } from '@/lib/rbac/roles';
import { onDealWon, onDealLost } from '@/lib/sales/opportunity-lifecycle';
import {
  resolveSalesOrgIdForRequest,
} from '@/lib/sales/org-context';

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const existing = await db.salesOpportunity.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true, createdById: true, assignedToId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: '机会不存在' }, { status: 404 });
  }

  if (!isAdmin(user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: 'sales.opportunity.update',
      resource: {
        type: 'sales_opportunity',
        id: existing.id,
        ownerId: existing.createdById,
        assignedToId: existing.assignedToId,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: '无权修改该机会', code: decision.reasonCode },
        { status: 403 },
      );
    }
  }

  const body = await request.json();

  const allowedFields = [
    'title', 'stage', 'estimatedValue', 'priority',
    'productTypes', 'windowCount', 'nextFollowupAt', 'notes',
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) {
      if (key === 'estimatedValue') {
        data[key] = body[key] !== null ? parseFloat(body[key]) : null;
      } else if (key === 'windowCount') {
        data[key] = body[key] !== null ? parseInt(body[key]) : null;
      } else if (key === 'nextFollowupAt') {
        data[key] = body[key] ? new Date(body[key]) : null;
      } else {
        data[key] = body[key];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  if (body.stage === "completed" && !data.wonAt) {
    data.wonAt = new Date();
  }
  if (body.stage === "lost" && !data.lostAt) {
    data.lostAt = new Date();
  }
  if (body.lostReason !== undefined) {
    data.lostReason = body.lostReason;
  }

  const updated = await db.salesOpportunity.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  if (body.stage === "completed") {
    onDealWon(id).catch((e) => console.error("[RAG] onDealWon error:", e));
  } else if (body.stage === "lost") {
    onDealLost(id).catch((e) => console.error("[RAG] onDealLost error:", e));
  }

  return NextResponse.json(updated);
});

export const GET = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const opportunity = await db.salesOpportunity.findFirst({
    where: { id, orgId: orgRes.orgId },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 5 },
      interactions: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  if (!opportunity) {
    return NextResponse.json({ error: '机会不存在' }, { status: 404 });
  }

  if (!isAdmin(user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: 'sales.opportunity.read',
      resource: {
        type: 'sales_opportunity',
        id: opportunity.id,
        ownerId: opportunity.createdById,
        assignedToId: opportunity.assignedToId,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: '无权访问该机会', code: decision.reasonCode },
        { status: 403 },
      );
    }
  }

  return NextResponse.json(opportunity);
});
