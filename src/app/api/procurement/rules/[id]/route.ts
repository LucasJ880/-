/**
 * PUT /api/procurement/rules/{id}?orgId（org_admin+）：{ patch, verify?: { method } }
 * 任何修改回到 UNVERIFIED；verify 要求入口与费用已知并写明核实方法，记录核实人与时间。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { updateRule, type RuleUpdateInput } from "@/lib/procurement-records/rules";

export const PUT = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  const b = await readJson(request);
  const patch = (b.patch && typeof b.patch === "object" ? b.patch : {}) as RuleUpdateInput;
  const verify = b.verify && typeof b.verify === "object" ? { method: String((b.verify as { method?: unknown }).method ?? "") } : null;
  const r = await updateRule({ orgId: a.orgId, ruleId: id, userId: user.id, patch, verify });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true });
});
