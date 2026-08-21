/**
 * 合规记忆 · 读写（建立在 T3 企业记忆层之上，零 schema）。
 * 写入只由人工标注触发（actor=user；T3 拒 ai/system）；同一指纹立场变化走 supersede 版本链。
 * 任何失败只 console.warn，绝不让标注请求失败。
 */

import { db } from "@/lib/db";
import { createMemoryClaim, supersedeMemoryClaim } from "@/lib/corporate-memory/claim-service";
import { searchMemoryClaims } from "@/lib/corporate-memory/retrieval";
import { COMPLIANCE_MEMORY_SUBJECT_PREFIX, requirementFingerprint } from "./fingerprint";
import { positionFromClaim, type CompliancePosition } from "./match";

export const COMPLIANCE_CLAIM_TYPE = "COMPLIANCE_POSITION";
/**
 * T3 subjectKey 规则：ORGANIZATION 必须 = orgId、PROJECT/TENDER 必须 = Project.id、BUYER = Buyer.id
 * ——按要求指纹建 key 只能用自由键的 OTHER（真实 E2E 实测）。
 */
export const COMPLIANCE_SUBJECT_TYPE = "OTHER";

export async function recordCompliancePosition(input: {
  orgId: string;
  userId: string;
  requirement: { text: string; code: string | null; category: string | null };
  fit: string;
  noteZh: string | null;
  project: { id: string; name: string };
}): Promise<{ action: "created" | "superseded" | "unchanged" | "skipped"; claimId: string | null }> {
  try {
    const fp = requirementFingerprint(input.requirement.text);
    const subjectKey = `${COMPLIANCE_MEMORY_SUBJECT_PREFIX}${fp}`;
    const structuredValue = {
      fingerprint: fp,
      textSample: input.requirement.text.slice(0, 400),
      category: input.requirement.category,
      fit: input.fit,
      noteZh: input.noteZh,
      sourceProjectId: input.project.id,
      sourceProjectName: input.project.name.slice(0, 120),
      sourceRequirementCode: input.requirement.code,
    };
    const statement = `合规立场：${input.fit}${input.noteZh ? `（${input.noteZh.slice(0, 120)}）` : ""} — ${input.requirement.text.slice(0, 160)}`;
    const existing = await db.memoryClaim.findFirst({
      where: { orgId: input.orgId, subjectType: COMPLIANCE_SUBJECT_TYPE, subjectKey, claimType: COMPLIANCE_CLAIM_TYPE, status: "ACTIVE" },
      select: { id: true, structuredValue: true },
    });
    // T3 纪律：FACT 须带直接证据；合规立场是「有依据的人工解读」→ INTERPRETATION，
    // 并附要求原文作为证据（可审计：来自哪个项目哪条要求）。
    const now = new Date();
    const core = {
      claimType: COMPLIANCE_CLAIM_TYPE,
      claimNature: "INTERPRETATION",
      statement,
      structuredValue,
      confidence: "HIGH",
      verificationStatus: "HUMAN_CONFIRMED",
      sourceType: "PROJECT_RECORD",
      capturedAt: now,
      evidence: [
        {
          sourceType: "PROJECT_RECORD",
          sourceKey: `tender-req:${input.project.id}:${input.requirement.code ?? fp}`,
          sectionLabel: input.requirement.code ?? undefined,
          sourceSnippet: input.requirement.text.slice(0, 400),
          capturedAt: now,
          metadata: { projectName: input.project.name.slice(0, 120), fit: input.fit },
        },
      ],
    };
    if (!existing) {
      const c = await createMemoryClaim({ orgId: input.orgId, actor: { userId: input.userId, actorType: "user" }, subjectType: COMPLIANCE_SUBJECT_TYPE, subjectKey, ...core });
      return { action: "created", claimId: c.id };
    }
    const prev = existing.structuredValue as { fit?: string; noteZh?: string | null } | null;
    if (prev?.fit === input.fit && (prev?.noteZh ?? null) === (input.noteZh ?? null)) {
      return { action: "unchanged", claimId: existing.id };
    }
    const r = await supersedeMemoryClaim({ orgId: input.orgId, actor: { userId: input.userId, actorType: "user" }, claimId: existing.id, replacement: core });
    return { action: "superseded", claimId: (r as { replacement?: { id?: string } }).replacement?.id ?? null };
  } catch (e) {
    console.warn("[compliance-memory] record failed (non-blocking):", e instanceof Error ? e.message : String(e));
    return { action: "skipped", claimId: null };
  }
}

export async function listCompliancePositions(input: { orgId: string; userId: string }): Promise<CompliancePosition[]> {
  try {
    const rows = await searchMemoryClaims({
      orgId: input.orgId,
      actor: { userId: input.userId, actorType: "user" },
      subjectType: COMPLIANCE_SUBJECT_TYPE,
      claimType: COMPLIANCE_CLAIM_TYPE,
      limit: 2000,
    });
    return rows
      .map((r) => positionFromClaim({ id: r.claimId, subjectKey: r.subjectKey, structuredValue: r.structuredValue, capturedAt: r.capturedAt }))
      .filter((p): p is CompliancePosition => p !== null);
  } catch (e) {
    console.warn("[compliance-memory] list failed (non-blocking):", e instanceof Error ? e.message : String(e));
    return [];
  }
}
