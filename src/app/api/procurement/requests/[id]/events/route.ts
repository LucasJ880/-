/**
 * POST /api/procurement/requests/{id}/events（org_member+）：登记政府来信与处理事件（只追加；更正指向旧事件）
 *   { type, effectiveAt?, noteZh?, attachmentIds?, confirmedMatch?, payload? }
 * 最终回应 / 撤回确认必须附来信；同一来信重复登记只保留一条；不自动上诉、不自动重新申请、不发信。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { addCaseEvent, type CaseEventInput } from "@/lib/procurement-records/events";
import { getRequestDetail } from "@/lib/procurement-records/views";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const r = await addCaseEvent({
    requestId: id,
    userId: user.id,
    type: String(b.type ?? ""),
    effectiveAt: typeof b.effectiveAt === "string" ? b.effectiveAt : null,
    noteZh: typeof b.noteZh === "string" ? b.noteZh : null,
    attachmentIds: Array.isArray(b.attachmentIds) ? (b.attachmentIds as unknown[]).map(String) : [],
    confirmedMatch: b.confirmedMatch === true,
    payload: (b.payload && typeof b.payload === "object" ? b.payload : {}) as CaseEventInput["payload"],
  });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, eventId: r.eventId, duplicate: r.duplicate, request: await getRequestDetail(id) });
});
