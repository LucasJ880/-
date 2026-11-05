/**
 * /api/procurement/ledger-attestations?orgId
 *   GET  台账确认记录（org_member+）
 *   POST 真实用户确认某辖区 / 机关范围无历史申请，或已导入历史（org_admin+）；系统不自行宣称台账完整
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { attestLedger } from "@/lib/procurement-records/requests";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  const rows = await db.recordsLedgerAttestation.findMany({ where: { orgId: a.orgId }, orderBy: { attestedAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.attestedById) } }, select: { id: true, name: true } });
  return NextResponse.json({ available: true, items: rows.map((r) => ({ ...r, attestedBy: users.find((u) => u.id === r.attestedById)?.name ?? "成员" })) });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const r = await attestLedger({
    orgId: a.orgId,
    userId: user.id,
    jurisdiction: String(b.jurisdiction ?? ""),
    institutionKey: String(b.institutionKey ?? "*"),
    applicantKey: typeof b.applicantKey === "string" ? b.applicantKey : null,
    method: String(b.method ?? "") as never,
    note: typeof b.note === "string" ? b.note : null,
    coverageFrom: typeof b.coverageFrom === "string" ? b.coverageFrom : null,
    coverageTo: typeof b.coverageTo === "string" ? b.coverageTo : null,
  });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, attestationId: r.attestationId });
});
