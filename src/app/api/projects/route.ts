import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import type { IntakeStatusFilter } from "@/lib/projects/visibility";
import {
  buildProjectLifecycleWhere,
  isProjectLifecycleFilter,
  type ProjectLifecycleFilter,
} from "@/lib/projects/lifecycle";
import { onProjectCreated } from "@/lib/project-discussion/system-events";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import { projectCreatedEventKey } from "@/lib/project-ledger/event-keys";
import { isLedgerProducersEnabled } from "@/lib/project-ledger/flags";
import {
  bidListFilterStatuses,
  isBidListFilterKey,
} from "@/lib/bid-workflow/labels";
import {
  bidWorkflowUnavailableFields,
  withBidWorkflowSchemaFallback,
} from "@/lib/bid-workflow/schema-drift";
import { LEGACY_PROJECT_LIST_SELECT } from "@/lib/bid-workflow/legacy-project-select";

const projectInclude = {
  owner: { select: { id: true, name: true } },
  _count: { select: { tasks: true, environments: true } },
  intelligenceRoom: {
    select: {
      id: true,
      goDecision: true,
      summaryStatus: true,
      summaryJson: true,
      updatedAt: true,
    },
  },
} as const;

export const GET = withAuth(async (request, _ctx, user) => {
  const intakeFilter = (request.nextUrl.searchParams.get("intakeStatus") ?? "all") as IntakeStatusFilter;
  const lifecycleParam = request.nextUrl.searchParams.get("lifecycle");
  const lifecycle: ProjectLifecycleFilter = isProjectLifecycleFilter(lifecycleParam)
    ? lifecycleParam
    : "active";
  const bidFilterParam = request.nextUrl.searchParams.get("bidListFilter");
  const bidListFilter = isBidListFilterKey(bidFilterParam)
    ? bidFilterParam
    : "all";
  const bidStatuses = bidListFilterStatuses(bidListFilter);

  const visibilityWhere = await buildProjectVisibilityWhere(user, {
    intakeStatusFilter: intakeFilter,
  });
  const lifecycleWhere = buildProjectLifecycleWhere(lifecycle);
  const bidWhere =
    bidStatuses == null
      ? null
      : { bidPhaseStatus: { in: [...bidStatuses] } };

  const clauses = [visibilityWhere, lifecycleWhere, bidWhere].filter(
    (c): c is NonNullable<typeof c> => c != null,
  );
  const where = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { AND: clauses };

  // legacy：不得引用 bidPhaseStatus / BidIntelligenceRoom
  const legacyWhereClauses = [visibilityWhere, lifecycleWhere].filter(
    (c): c is NonNullable<typeof c> => c != null,
  );
  const legacyWhere =
    legacyWhereClauses.length === 0
      ? {}
      : legacyWhereClauses.length === 1
        ? legacyWhereClauses[0]
        : { AND: legacyWhereClauses };

  const take = Math.min(
    parseInt(request.nextUrl.searchParams.get("take") ?? "50", 10) || 50,
    200
  );

  const { value: projects, usedFallback } = await withBidWorkflowSchemaFallback({
    logLabel: "projects.list",
    primary: () =>
      db.project.findMany({
        where,
        include: projectInclude,
        orderBy: { createdAt: "desc" },
        take,
      }),
    fallback: () =>
      db.project.findMany({
        where: legacyWhere,
        select: LEGACY_PROJECT_LIST_SELECT,
        orderBy: { createdAt: "desc" },
        take,
      }),
  });

  const unavailable = bidWorkflowUnavailableFields();
  const mapped = projects.map((p) => {
    if (!usedFallback) {
      return {
        ...p,
        intelligenceAvailable: true,
      };
    }
    return {
      ...p,
      bidPhaseStatus: unavailable.bidPhaseStatus,
      intelligenceRoom: unavailable.intelligenceRoom,
      intelligenceAvailable: unavailable.intelligenceAvailable,
    };
  });

  return NextResponse.json(mapped);
});

/**
 * POST：创建项目 + 创建者 project_admin + 默认 test / prod 环境（同一事务）
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) {
    return NextResponse.json(
      { error: "必须指定所属组织 orgId" },
      { status: 400 }
    );
  }

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  }

  if (org.status !== "active") {
    return NextResponse.json(
      { error: "组织已归档或不可用，无法新建项目" },
      { status: 403 }
    );
  }

  if (!isSuperAdmin(user.role)) {
    const om = await getOrgMembership(user.id, orgId);
    if (!om || om.status !== "active") {
      return NextResponse.json({ error: "无权在该组织下创建项目" }, { status: 403 });
    }
    if (!hasOrgRole(om.role, "org_member")) {
      return NextResponse.json(
        { error: "组织观察员不能创建项目" },
        { status: 403 }
      );
    }
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
  }

  // 创建时可显式选择投标域；非法值回落 general（绝不由上传侧自动改写）
  const requestedDomain =
    typeof body.workDomain === "string"
      ? body.workDomain.trim().toLowerCase()
      : "";
  const workDomain =
    requestedDomain === "tender" ||
    requestedDomain === "delivery" ||
    requestedDomain === "general"
      ? requestedDomain
      : "general";

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        description: body.description || null,
        color: body.color || "#3B82F6",
        ownerId: user.id,
        orgId,
        workDomain,
        members: {
          create: {
            userId: user.id,
            role: "project_admin",
            status: "active",
          },
        },
        environments: {
          create: [
            {
              name: "测试环境",
              code: "test",
              status: "active",
            },
            {
              name: "正式环境",
              code: "prod",
              status: "active",
            },
          ],
        },
      },
      include: projectInclude,
    });
    await onProjectCreated(p.id, p.name, user.id, user.name, tx);

    // T2-P1 authoritative ledger（activation gate 未开时保持 dark；开启后与业务写同事务，
    // append 失败 = 整个创建回滚——禁止 best-effort）
    if (isLedgerProducersEnabled()) {
      await appendProjectEvent({
        tx,
        orgId,
        projectId: p.id,
        eventType: "project.created",
        eventKey: projectCreatedEventKey(p.id),
        occurredAt: p.createdAt,
        actor: { actorType: "user", actorId: user.id },
        title: `项目创建：${p.name}`,
        payload: {
          schemaVersion: 1,
          name: p.name,
          workDomain,
          ownerId: user.id,
        },
      });
    }
    return p;
  });

  await logAudit({
    userId: user.id,
    orgId,
    projectId: project.id,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: project.id,
    afterData: {
      id: project.id,
      name: project.name,
      orgId,
      defaultEnvironments: ["test", "prod"],
    },
    request,
  });

  return NextResponse.json(project, { status: 201 });
});
