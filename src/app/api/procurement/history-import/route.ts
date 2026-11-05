/**
 * POST /api/procurement/history-import?orgId（org_admin+）：{ items: HistoricalRequestItem[] }
 * 旧状态经显式映射（未知值拒绝该条，不静默丢弃）；无证据不 CLOSED、不标已取得文件；证据等级 user_reported；幂等。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { importHistoricalRequest, type HistoricalRequestItem } from "@/lib/procurement-records/requests";

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const items = Array.isArray(b.items) ? (b.items as HistoricalRequestItem[]).slice(0, 200) : [];
  if (!items.length) return NextResponse.json({ error: "items 为空", code: "EMPTY_IMPORT" }, { status: 400 });
  const results = [];
  for (const item of items) {
    if (!item || typeof item.title !== "string" || !item.title.trim() || typeof item.originNote !== "string" || !Array.isArray(item.instrumentNumbers)) {
      results.push({ ok: false, code: "INVALID_ITEM", message: "缺少 title / originNote / instrumentNumbers" });
      continue;
    }
    const r = await importHistoricalRequest({ orgId: a.orgId, userId: user.id, item: { ...item, isFixture: false } });
    results.push(r.ok ? { ok: true, requestId: r.requestId, created: r.created, notes: r.notes } : { ok: false, code: r.code, message: r.message });
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
});
