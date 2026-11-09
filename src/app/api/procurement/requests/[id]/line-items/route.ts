/** POST /api/procurement/requests/{id}/line-items（org_member+）：人工录入（扫描件 / 无 OCR）——必须指向附件与原文片段 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { addManualLineItem, runAnalysis } from "@/lib/procurement-records/analysis";
import type { LineItemPatch } from "@/lib/procurement-records/attachments";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const r = await addManualLineItem({
    requestId: id,
    attachmentId: String(b.attachmentId ?? ""),
    userId: user.id,
    sourcePage: typeof b.sourcePage === "number" ? b.sourcePage : null,
    rawSnippet: String(b.rawSnippet ?? ""),
    patch: (b.patch && typeof b.patch === "object" ? b.patch : {}) as LineItemPatch,
  });
  if (!r.ok) return serviceResponse(r);
  await runAnalysis({ requestId: id, userId: user.id, trigger: "REVIEW" });
  return NextResponse.json({ ok: true, lineItemId: r.lineItemId }, { status: 201 });
});
