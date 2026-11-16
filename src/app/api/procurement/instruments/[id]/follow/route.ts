/**
 * POST /api/procurement/instruments/{id}/follow（org_member+）：「跟这个标」——招标公告 → 招投标项目 + 关联（本项目）+ 改为关注。
 * 同一组织同一公告只建一次；已跟过返回原项目（created:false）。规则见 src/lib/procurement-records/tender-follow.ts。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireInstrumentAccess, schemaGate } from "@/lib/procurement-records/access";
import { followTenderNotice } from "@/lib/procurement-records/tender-follow";

export const POST = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireInstrumentAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const r = await followTenderNotice({ orgId: a.orgId, user, instrumentId: id });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true, projectId: r.projectId, created: r.created }, { status: r.created ? 201 : 200 });
});
