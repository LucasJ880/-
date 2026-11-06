/**
 * POST /api/procurement/candidates/import?orgId（org_member+）：人工链接导入（省市门户 / MERX / Bonfire / Ariba 等）。
 * 证据标「人工导入」，不标官方已核实；平台不等于申请接收机关。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { importManualInstrument } from "@/lib/procurement-records/requests";

const CLASSES = ["SOLICITATION", "AWARD_INSTRUMENT", "CALL_UP", "OTHER"] as const;

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() || null : null);
  const cls = (CLASSES as readonly string[]).includes(String(b.instrumentClass)) ? (b.instrumentClass as (typeof CLASSES)[number]) : "SOLICITATION";
  const r = await importManualInstrument({
    orgId: a.orgId,
    userId: user.id,
    jurisdiction: s("jurisdiction") ?? "CA-FED",
    instrumentClass: cls,
    officialNumber: s("officialNumber") ?? "",
    title: s("title"),
    contractingInstitution: s("contractingInstitution"),
    buyingInstitution: s("buyingInstitution"),
    sourceUrl: s("sourceUrl"),
    platform: s("platform"),
    note: s("note"),
  });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, instrumentId: r.instrumentId, created: r.created });
});
