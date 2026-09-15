import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { requireCandidateProjectWrite } from "@/lib/supplier-intel/candidate-route-access";
import {
  applyDeterministicMatch,
  recordEvaluationMatch,
} from "@/lib/supplier-intel/evaluation-run-service";
import type { MatchEvidenceInput } from "@/lib/supplier-intel/evaluation-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";

type Ctx = { params: Promise<{ candidateId: string }> };

/** 只接受这些证据形状；kind 之外的字段按类型收窄，未知 kind 直接 400 */
function readEvidence(raw: unknown): MatchEvidenceInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MatchEvidenceInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const o = item as Record<string, unknown>;
    const snippet = typeof o.snippet === "string" ? o.snippet : null;
    switch (o.kind) {
      case "certification":
        if (typeof o.certificationId !== "string") return null;
        out.push({ kind: "certification", certificationId: o.certificationId });
        break;
      case "signal":
        if (typeof o.signalId !== "string") return null;
        out.push({ kind: "signal", signalId: o.signalId, snippet });
        break;
      case "archive":
        if (typeof o.archiveItemId !== "string") return null;
        out.push({ kind: "archive", archiveItemId: o.archiveItemId, snippet });
        break;
      case "url":
        if (typeof o.url !== "string") return null;
        out.push({ kind: "url", url: o.url, snippet });
        break;
      case "note":
        if (typeof o.snippet !== "string") return null;
        out.push({ kind: "note", snippet: o.snippet });
        break;
      default:
        return null;
    }
  }
  return out;
}

/**
 * S4-A：写一条需求匹配。
 *   { requirementKey, verdict, evidence[], explanation? }  → 人工判定（evaluatedBy 服务端固定 HUMAN）
 *   { requirementKey, applyDeterministic: true }           → 服务端按规则重算并写成 DETERMINISTIC
 * 客户端不能声明 evaluatedBy / mandatory / requirementRefId / evaluationVersion。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { candidateId } = await ctx.params;
  const gate = await requireCandidateProjectWrite(request, tenant.orgId, candidateId);
  if (gate instanceof NextResponse) return gate;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  const requirementKey = typeof body.requirementKey === "string" ? body.requirementKey.trim() : "";
  if (!requirementKey) return NextResponse.json({ error: "requirementKey 必填" }, { status: 400 });
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    if (body.applyDeterministic === true) {
      const { match, suggestion } = await applyDeterministicMatch(actor, { candidateId, requirementKey });
      return NextResponse.json({ match: { id: match.id, verdict: match.verdict, evaluatedBy: match.evaluatedBy }, ruleId: suggestion.ruleId }, { status: 201 });
    }
    const evidence = readEvidence(body.evidence ?? []);
    if (!evidence) return NextResponse.json({ error: "evidence 形状非法" }, { status: 400 });
    const match = await recordEvaluationMatch(actor, {
      candidateId,
      requirementKey,
      verdict: typeof body.verdict === "string" ? body.verdict : "",
      evidence,
      explanation: typeof body.explanation === "string" ? body.explanation : null,
    });
    return NextResponse.json({ match: { id: match.id, verdict: match.verdict, evaluatedBy: match.evaluatedBy } }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
