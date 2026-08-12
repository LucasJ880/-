/**
 * GET  /api/projects/[id]/finance/budget — 预算版本 + 行
 * POST /api/projects/[id]/finance/budget — { action: create_version | activate | freeze_baseline }
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  activateBudgetVersion,
  createBudgetVersion,
  freezeAwardBaseline,
  FinanceContractError,
  FinanceTenantError,
  BaselineImmutableError,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

function financeError(e: unknown): NextResponse {
  if (e instanceof FinanceContractError || e instanceof BaselineImmutableError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: (e as { statusCode?: number }).statusCode ?? 409 });
  }
  if (e instanceof FinanceTenantError) {
    return NextResponse.json({ error: "资源不存在", code: e.code }, { status: 404 });
  }
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;

  const budget = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId, projectId: id } } });
  if (!budget) return NextResponse.json({ budget: null, versions: [] });
  const versions = await db.projectBudgetVersion.findMany({
    where: { budgetId: budget.id },
    orderBy: { versionNumber: "desc" },
  });
  const lines = await db.projectBudgetLine.findMany({
    where: { orgId, projectId: id },
    orderBy: [{ budgetVersionId: "asc" }, { sortOrder: "asc" }],
  });
  const linesByVersion: Record<string, typeof lines> = {};
  for (const l of lines) (linesByVersion[l.budgetVersionId] ??= []).push(l);
  return NextResponse.json({ budget, versions, linesByVersion });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;
  const actor = serverActor(access.user.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    if (action === "create_version") {
      const result = await createBudgetVersion({
        orgId, projectId: id, actor, createdById: access.user.id,
        currency: String(body.currency ?? "CAD"),
        note: (body.note as string) ?? null,
        lines: Array.isArray(body.lines) ? (body.lines as never[]) : [],
      });
      return NextResponse.json({ version: result.version });
    }
    if (action === "activate") {
      const version = await activateBudgetVersion({
        orgId, projectId: id, actor, actorUserId: access.user.id,
        versionId: String(body.versionId ?? ""),
      });
      return NextResponse.json({ version });
    }
    if (action === "freeze_baseline") {
      const baseline = await freezeAwardBaseline({
        orgId, projectId: id, actor, actorUserId: access.user.id,
        sourceVersionId: body.sourceVersionId ? String(body.sourceVersionId) : undefined,
      });
      return NextResponse.json({ baseline });
    }
    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (e) {
    return financeError(e);
  }
}
