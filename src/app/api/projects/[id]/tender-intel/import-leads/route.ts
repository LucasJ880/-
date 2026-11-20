/**
 * /api/projects/[id]/tender-intel/import-leads（CHAIN-3）
 *
 * GET  读进口线索视图：线索说明、来源情况、历史中标者、待裁决的疑似同一家、出口商汇总、canEdit。
 * POST 导入：{ text, sourceLabel?, dateOrder? }——只解析贴进来的文字，不访问任何网站、不调模型。
 * 权限与判定顺序见 src/lib/tender-import-leads/api-access.ts。
 */

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, requireImportLeadsRead, requireImportLeadsWrite } from "@/lib/tender-import-leads/api-access";
import { BATCH_TEXT, DATE_ORDERS, IMPORT_MAX_BYTES, type DateOrder } from "@/lib/tender-import-leads/parse";
import { importLeads, loadImportLeadsView } from "@/lib/tender-import-leads/service";

type Params = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const gate = await requireImportLeadsRead(request, projectId);
  if (gate instanceof NextResponse) return gate;
  const view = await loadImportLeadsView({ orgId: gate.orgId, projectId, canEdit: gate.canEdit });
  return NextResponse.json(view, { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const gate = await requireImportLeadsWrite(request, projectId);
  if (gate instanceof NextResponse) return gate;
  const body = await readJsonBody(request, IMPORT_MAX_BYTES * 2);
  if (body === "TOO_LARGE") return NextResponse.json({ error: BATCH_TEXT.tooLarge, code: "TOO_LARGE" }, { status: 400 });
  if (!body || typeof body.text !== "string") return NextResponse.json({ error: BATCH_TEXT.empty, code: "EMPTY" }, { status: 400 });
  const dateOrder = typeof body.dateOrder === "string" && (DATE_ORDERS as readonly string[]).includes(body.dateOrder) ? (body.dateOrder as DateOrder) : null;
  const sourceLabel = typeof body.sourceLabel === "string" ? body.sourceLabel : null;
  const out = await importLeads({ orgId: gate.orgId, projectId, userId: gate.access.user.id, text: body.text, sourceLabel, dateOrder });
  if (!out.ok) return NextResponse.json({ error: out.messageZh, code: out.code }, { status: out.status });
  return NextResponse.json({ result: out.result, view: out.view }, { headers: NO_STORE });
}
