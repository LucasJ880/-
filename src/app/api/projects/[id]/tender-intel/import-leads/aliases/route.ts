/**
 * POST /api/projects/[id]/tender-intel/import-leads/aliases（CHAIN-3）
 *
 * 裁决一对「疑似同一家」：{ pairKey, decision: "CONFIRMED" | "REJECTED" }。只接受本项目当前待裁决的一对；
 * 已经有人裁决过 → 409。裁决记下裁决人与时间，对本组织所有项目生效。
 */

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, requireImportLeadsWrite } from "@/lib/tender-import-leads/api-access";
import { decideImportLeadAlias } from "@/lib/tender-import-leads/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const gate = await requireImportLeadsWrite(request, projectId);
  if (gate instanceof NextResponse) return gate;
  const body = await readJsonBody(request, 16 * 1024);
  const pairKey = body && body !== "TOO_LARGE" && typeof body.pairKey === "string" ? body.pairKey : "";
  const decision = body && body !== "TOO_LARGE" ? body.decision : null;
  if (!pairKey || (decision !== "CONFIRMED" && decision !== "REJECTED")) return NextResponse.json({ error: "请求不完整", code: "INVALID_INPUT" }, { status: 400 });
  const out = await decideImportLeadAlias({ orgId: gate.orgId, projectId, userId: gate.access.user.id, pairKey, decision });
  if (!out.ok) return NextResponse.json({ error: out.messageZh, code: out.code }, { status: out.status });
  return NextResponse.json({ view: out.view }, { headers: { "Cache-Control": "private, no-store" } });
}
