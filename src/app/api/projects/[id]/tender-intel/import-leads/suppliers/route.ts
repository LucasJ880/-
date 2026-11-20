/**
 * POST /api/projects/[id]/tender-intel/import-leads/suppliers（CHAIN-3）
 *
 * 把本项目进口线索汇总里的一家出口商加入供应商库：{ exporterKey }。库里已有同名的关联一家，没有才新建
 * （来源 trade_data、邮箱留空）；不去网上找邮箱。
 */

import { NextRequest, NextResponse } from "next/server";
import { NO_STORE, readJsonBody, requireImportLeadsWrite } from "@/lib/tender-import-leads/api-access";
import { addImportLeadSupplier } from "@/lib/tender-import-leads/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const gate = await requireImportLeadsWrite(request, projectId);
  if (gate instanceof NextResponse) return gate;
  const body = await readJsonBody(request, 16 * 1024);
  const exporterKey = body && body !== "TOO_LARGE" && typeof body.exporterKey === "string" ? body.exporterKey : "";
  if (!exporterKey) return NextResponse.json({ error: "请求不完整", code: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
  const out = await addImportLeadSupplier({ orgId: gate.orgId, projectId, userId: gate.access.user.id, exporterKey });
  if (!out.ok) return NextResponse.json({ error: out.messageZh, code: out.code }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ result: out.result, view: out.view }, { headers: NO_STORE });
}
