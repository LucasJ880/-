import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  assertSalesCustomerInOrgForMutation,
  assertSalesOpportunityInOrgForMutation,
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";
import {
  buildSalesActionActiveKey,
  defaultSalesActionDueAt,
  summarizeSalesActions,
} from "@/lib/sales/action-loop";
import { writeAuditLog, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

const ACTIVE_STATUSES = ["open", "in_progress"];
const PRIORITIES = new Set(["urgent", "high", "medium", "low"]);

function ownScope(userId: string) {
  return {
    OR: [
      { assignedToId: userId },
      { createdById: userId },
      { customer: { createdById: userId } },
      { opportunity: { OR: [{ createdById: userId }, { assignedToId: userId }] } },
    ],
  };
}

const actionInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  opportunity: { select: { id: true, title: true, stage: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.opportunity.read");
  if (!scope.allowed) {
    return NextResponse.json({ error: "无权查看销售行动", code: scope.reasonCode }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const opportunityId = searchParams.get("opportunityId");
  const status = searchParams.get("status") ?? "active";
  const baseWhere: Prisma.SalesActionWhereInput = {
    orgId: orgRes.orgId,
    customer: { archivedAt: null },
    ...(scope.ownOnly ? ownScope(user.id) : {}),
    ...(customerId ? { customerId } : {}),
    ...(opportunityId ? { opportunityId } : {}),
  };
  const where: Prisma.SalesActionWhereInput = {
    ...baseWhere,
    ...(status === "all"
      ? {}
      : status === "active"
        ? { status: { in: ACTIVE_STATUSES } }
        : { status }),
  };

  const metricSince = new Date(Date.now() - 90 * 86_400_000);
  const [actions, metricRows, latestSync] = await Promise.all([
    db.salesAction.findMany({
      where,
      include: actionInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.salesAction.findMany({
      where: { ...baseWhere, createdAt: { gte: metricSince } },
      select: { status: true, dueAt: true, completedAt: true },
      take: 500,
    }),
    db.salesActionSyncRun.findFirst({
      where: { orgId: orgRes.orgId },
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        scannedCount: true,
        createdCount: true,
        autoResolvedCount: true,
        truncated: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ]);

  return NextResponse.json({ actions, metrics: summarizeSalesActions(metricRows), latestSync });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  if (!body.customerId || !body.signalKey || !body.title || !body.category) {
    return NextResponse.json({ error: "客户、信号、标题和分类不能为空" }, { status: 400 });
  }

  const customer = await db.salesCustomer.findFirst({
    where: { id: String(body.customerId), orgId: orgRes.orgId, archivedAt: null },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  const denied = await assertSalesCustomerInOrgForMutation(customer, orgRes.orgId, {
    user,
    permission: "sales.customer.update",
  });
  if (denied) return denied;

  const opportunityId = typeof body.opportunityId === "string" && body.opportunityId ? body.opportunityId : null;
  if (opportunityId) {
    const oppResult = await assertSalesOpportunityInOrgForMutation(opportunityId, orgRes.orgId, {
      user,
      permission: "sales.opportunity.update",
    });
    if (!oppResult.ok) return oppResult.response;
    const matches = await db.salesOpportunity.count({ where: { id: opportunityId, customerId: customer.id } });
    if (!matches) return NextResponse.json({ error: "商机与客户不匹配" }, { status: 400 });
  }

  const assignedToId = typeof body.assignedToId === "string" && body.assignedToId ? body.assignedToId : user.id;
  if (assignedToId !== user.id) {
    const assignmentScope = await resolveSalesScope(user, orgRes.orgId, "sales.customer.update");
    if (!assignmentScope.allowed || assignmentScope.ownOnly) {
      return NextResponse.json({ error: "只有销售经理可以把行动分配给其他成员" }, { status: 403 });
    }
  }
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: orgRes.orgId, userId: assignedToId } },
    select: { status: true },
  });
  if (assignedToId !== user.id && member?.status !== "active") {
    return NextResponse.json({ error: "负责人不是当前企业的有效成员" }, { status: 400 });
  }

  const signalKey = String(body.signalKey).trim().slice(0, 80);
  const activeKey = buildSalesActionActiveKey({
    orgId: orgRes.orgId,
    customerId: customer.id,
    opportunityId,
    signalKey,
  });
  const existing = await db.salesAction.findUnique({ where: { activeKey }, include: actionInclude });
  if (existing) return NextResponse.json({ action: existing, duplicate: true });

  const priority = PRIORITIES.has(body.priority) ? body.priority : "medium";
  const dueAt = body.dueAt ? new Date(body.dueAt) : defaultSalesActionDueAt(priority);
  if (Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: "截止时间无效" }, { status: 400 });

  try {
    const action = await db.$transaction(async (tx) => {
      const created = await tx.salesAction.create({
        data: {
          orgId: orgRes.orgId,
          customerId: customer.id,
          opportunityId,
          signalKey,
          activeKey,
          category: String(body.category).trim().slice(0, 80),
          title: String(body.title).trim().slice(0, 160),
          description: typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null,
          priority,
          dueAt,
          assignedToId,
          createdById: user.id,
        },
        include: actionInclude,
      });
      await writeAuditLog(tx, {
        userId: user.id,
        orgId: orgRes.orgId,
        action: AUDIT_ACTIONS.CREATE,
        targetType: AUDIT_TARGETS.SALES_ACTION,
        targetId: created.id,
        afterData: { customerId: customer.id, opportunityId, signalKey, assignedToId, dueAt },
        request,
      });
      return created;
    });
    return NextResponse.json({ action, duplicate: false }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await db.salesAction.findUnique({ where: { activeKey }, include: actionInclude });
      if (duplicate) return NextResponse.json({ action: duplicate, duplicate: true });
    }
    throw error;
  }
});
