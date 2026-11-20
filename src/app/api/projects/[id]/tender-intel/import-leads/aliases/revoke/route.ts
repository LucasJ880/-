/**
 * POST /api/projects/[id]/tender-intel/import-leads/aliases/revoke（CHAIN-3c）
 *
 * 撤回一对「是不是同一家」的当前裁决：{ pairKey, decisionId, reason }（decisionId = 页面上那条裁决的标识；reason 必填、最多 200 字，记进撤回审计）。
 * 只限组织管理员（含组织所有者；平台超级管理员按既有规则），其他人 403。
 * 不是本项目现有记录涉及的对 → 404；现在没有裁决、或裁决已被同事换掉 → 409。撤回写一条审计，对本组织所有项目生效。
 */

import { NextRequest, NextResponse } from "next/server";
import { NO_STORE, readJsonBody, requireImportLeadsAliasDecide } from "@/lib/tender-import-leads/api-access";
import { revokeImportLeadAlias } from "@/lib/tender-import-leads/service";
import { normalizeRevokeReason } from "@/lib/tender-import-leads/aggregate-pure";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const gate = await requireImportLeadsAliasDecide(request, projectId);
  if (gate instanceof NextResponse) return gate;
  const body = await readJsonBody(request, 16 * 1024);
  const pairKey = body && body !== "TOO_LARGE" && typeof body.pairKey === "string" ? body.pairKey : "";
  const decisionId = body && body !== "TOO_LARGE" && typeof body.decisionId === "string" ? body.decisionId : "";
  if (!pairKey || !decisionId) return NextResponse.json({ error: "请求不完整", code: "INVALID_INPUT" }, { status: 400, headers: NO_STORE });
  const reason = normalizeRevokeReason(body && body !== "TOO_LARGE" ? body.reason : undefined);
  if (!reason.ok) return NextResponse.json({ error: reason.messageZh, code: reason.code }, { status: 400, headers: NO_STORE });
  const out = await revokeImportLeadAlias({ orgId: gate.orgId, projectId, userId: gate.access.user.id, pairKey, decisionId, reason: reason.reason, canEdit: gate.canEdit });
  if (!out.ok) return NextResponse.json({ error: out.messageZh, code: out.code }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ view: out.view, revokedDecision: out.revokedDecision }, { headers: NO_STORE });
}
