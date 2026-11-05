/** PATCH /api/procurement/requests/{id}/line-items/{lineId}（org_member+）：{ action: CONFIRM | REJECT | EDIT_AND_CONFIRM, patch?, note? }；复核后重算分析（新版本） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { reviewLineItem, runAnalysis } from "@/lib/procurement-records/analysis";
import type { LineItemPatch } from "@/lib/procurement-records/attachments";

export const PATCH = withAuth<{ id: string; lineId: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id, lineId } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const action = String(b.action ?? "");
  if (!["CONFIRM", "REJECT", "EDIT_AND_CONFIRM"].includes(action)) return NextResponse.json({ error: "复核操作无效", code: "INVALID_ACTION" }, { status: 400 });
  const r = await reviewLineItem({ requestId: id, lineItemId: lineId, userId: user.id, action: action as "CONFIRM", patch: (b.patch ?? {}) as LineItemPatch, note: typeof b.note === "string" ? b.note : null });
  if (!r.ok) return serviceResponse(r);
  if (b.reanalyze !== false) await runAnalysis({ requestId: id, userId: user.id, trigger: "REVIEW" });
  return NextResponse.json({ ok: true });
});
