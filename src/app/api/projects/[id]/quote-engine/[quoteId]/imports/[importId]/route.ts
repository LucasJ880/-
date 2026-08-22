import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { applyImport, cancelImport, confirmImport, getImport, serializeImport, updateImportReview } from "@/lib/quote-engine/import/import-service";

/**
 *  GET  ：导入详情 + Review 行（internal_cost）
 *  PUT  ：保存 Review（行编辑 / 类别 / 勾选 / 供应商名 / 币种）（edit）
 *  POST ：{ action: "confirm" | "apply" | "confirm_apply" | "cancel", reason? }（edit）
 *         confirm = 校验并锁定；apply = 单事务写入 QuoteCostLine（provenance 同一 INSERT）+ APPLIED（幂等：已应用的重试返回 alreadyApplied，零重复）；
 *         confirm_apply = 同一原子边界内确认并应用
 */

type Ctx = { params: Promise<{ id: string; quoteId: string; importId: string }> };

function errorResponse(e: unknown) {
  if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
  if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "输入校验失败", code: "VALIDATION", details: (e as { issues: unknown }).issues }, { status: 400 });
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, quoteId, importId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "internal_cost");
  if (access instanceof NextResponse) return access;
  try {
    const record = await getImport({ importId, quoteId, projectId: id, orgId: access.orgId });
    return NextResponse.json({ import: serializeImport(record, { withRows: true }) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id, quoteId, importId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => ({}));
  try {
    const record = await updateImportReview({ importId, quoteId, projectId: id, orgId: access.orgId, userId: access.user.id, patch: body });
    return NextResponse.json({ import: serializeImport(record, { withRows: true }) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId, importId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { action?: string; reason?: string | null };
  const base = { importId, quoteId, projectId: id, orgId: access.orgId, userId: access.user.id };
  try {
    if (body.action === "confirm") {
      const record = await confirmImport(base);
      return NextResponse.json({ import: serializeImport(record, { withRows: true }) });
    }
    if (body.action === "apply" || body.action === "confirm_apply") {
      const { record, lineIds, alreadyApplied, snapshotRefreshed } = await applyImport({ ...base, allowConfirm: body.action === "confirm_apply" });
      return NextResponse.json({ import: serializeImport(record, { withRows: true }), lineIds, alreadyApplied, snapshotRefreshed });
    }
    if (body.action === "cancel") {
      const record = await cancelImport({ ...base, reason: body.reason ?? null });
      return NextResponse.json({ import: serializeImport(record, { withRows: false }) });
    }
    return NextResponse.json({ error: "action 必须是 confirm | apply | confirm_apply | cancel" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
