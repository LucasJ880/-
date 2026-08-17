/**
 * POST /api/projects/[id]/finance/revenue/materialize-award
 *   body: { awardRecordId, asRecognized?, description? }
 *
 * R1 §E/§F：由一条**合法关联本项目**的 AwardRecord 物化 CONTRACT_AWARD 收入条目。
 *
 * 这是 AwardRecord → Revenue 的**唯一**通道，且必须由人显式发起：
 * 系统中**不存在** `on AwardRecord created → auto create revenue` 的路径
 * （AwardRecord 可能是历史买家授标 / 竞争对手中标 / 外部市场情报）。
 *
 * 拒绝时如实返回 refusedReason（AWARD_NOT_LINKED_TO_PROJECT / AWARD_NOT_VERIFIED /
 * PROJECT_NOT_AWARDED_TO_US …），绝不静默跳过。
 * 权限：COST_WRITE（与录入收入同权）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  FinanceContractError,
  FinanceTenantError,
  FxContractError,
  RevenueLifecycleError,
  materializeAwardRevenue,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_WRITE);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const awardRecordId = String(body.awardRecordId ?? "").trim();
  if (!awardRecordId) {
    return NextResponse.json({ error: "缺少 awardRecordId" }, { status: 400 });
  }

  try {
    const result = await materializeAwardRevenue({
      orgId: access.orgId,
      projectId: id,
      awardRecordId,
      actor: serverActor(access.user.id),
      createdById: access.user.id,
      asRecognized: body.asRecognized === true,
      description: (body.description as string) ?? null,
    });
    // 资格不满足 → 409 + 明确原因（可审计，不静默）
    if (!result.materialized && result.refusedReason) {
      return NextResponse.json(
        { ok: false, code: result.refusedReason, error: `不满足物化资格：${result.refusedReason}` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.materialized ? 201 : 200 },
    );
  } catch (e) {
    if (
      e instanceof RevenueLifecycleError ||
      e instanceof FxContractError ||
      e instanceof FinanceContractError
    ) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: (e as { statusCode?: number }).statusCode ?? 409 },
      );
    }
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "项目不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
