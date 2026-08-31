/**
 * 评估脊柱：SupplierCandidate + SupplierRequirementMatch（B2/B3 + S1 Final Review Guard §3）
 *
 * 历史可重现的三条铁律（T11）：
 *   1. Candidate 创建时按值冻结 supplierSnapshotJson / offeringSnapshotJson——
 *      live Supplier/Offering 后续修改不得影响历史候选；回放读 snapshot，不读 live 行。
 *   2. Match 证据按值冻结进 evidenceJson（认证证据必须整组字段冻结，
 *      不能只存 certificationId）——证书之后 VERIFIED→EXPIRED，历史 Run 仍能回答
 *      「当时评估时它是什么状态」。
 *   3. 只允许在 Run RUNNING 期间创建；Run 终态后 Candidate/Match 不可原地重算，
 *      重评估 = 新 Run（B.1 §9）。
 */

import type {
  Prisma,
  Supplier,
  SupplierCertification,
  SupplierOffering,
} from "@prisma/client";
import { isPrismaUniqueViolation } from "@/lib/bid-workflow/prisma-errors";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import {
  CANDIDATE_ORIGIN_SOURCES,
  MATCH_EVALUATED_BY,
  MATCH_VERDICTS,
  SUPPLIER_INTEL_LIMITS,
} from "./constants";
import { SupplierIntelError } from "./errors";
import { resolveArchiveEvidence } from "./evidence-scope";
import {
  collapseMandatoryForMatch,
  indexRequirementSnapshot,
  validateRequirementSnapshot,
} from "./requirement-snapshot";
import { lockSupplierSearchRunForWrite } from "./run-service";

// ── 按值快照构造器（S1 Guard §3.1/§3.2/§3.3）────────────────

/** 评估当时的供应商身份快照：只复制 audit-relevant 字段，不复制整行 */
export function buildSupplierSnapshot(supplier: Supplier, capturedAt: Date) {
  return {
    supplierId: supplier.id,
    name: supplier.name,
    region: supplier.region ?? null,
    category: supplier.category ?? null,
    website: supplier.website ?? null,
    status: supplier.status,
    capturedAt: capturedAt.toISOString(),
  };
}

export function buildOfferingSnapshot(offering: SupplierOffering, capturedAt: Date) {
  return {
    offeringId: offering.id,
    name: offering.name,
    sku: offering.sku ?? null,
    category: offering.category ?? null,
    description: offering.description ?? null,
    attributes: (offering.attributesJson as unknown) ?? null,
    unitPrice: offering.unitPrice ? offering.unitPrice.toString() : null,
    currency: offering.currency ?? null,
    priceStatus: offering.priceStatus,
    moq: offering.moq ?? null,
    leadTimeDays: offering.leadTimeDays ?? null,
    incoterm: offering.incoterm ?? null,
    sourceKind: offering.sourceKind,
    sourceUrl: offering.sourceUrl ?? null,
    capturedAt: capturedAt.toISOString(),
  };
}

/** 认证证据冻结（§3.3：不能只存 certificationId，整组字段按值复制） */
export function buildCertificationEvidenceSnapshot(
  cert: SupplierCertification,
  capturedAt: Date,
) {
  return {
    kind: "certification" as const,
    certificationId: cert.id,
    certificationType: cert.certificationType,
    scope: cert.scope,
    offeringId: cert.offeringId ?? null,
    statusAtEvaluation: cert.status,
    certificateNumber: cert.certificateNumber ?? null,
    issuer: cert.issuer ?? null,
    validFrom: cert.validFrom ? cert.validFrom.toISOString() : null,
    expiresAt: cert.expiresAt ? cert.expiresAt.toISOString() : null,
    verifiedAt: cert.verifiedAt ? cert.verifiedAt.toISOString() : null,
    sourceKind: cert.sourceKind,
    sourceUrl: cert.sourceUrl ?? null,
    archiveItemId: cert.archiveItemId ?? null,
    capturedAt: capturedAt.toISOString(),
  };
}

// ── Candidate ─────────────────────────────────────────────

export interface CreateCandidateInput {
  searchRunId: string;
  supplierId: string;
  offeringId?: string | null;
  /** 检索优先级 1–5 的审计痕迹 */
  originSource: string;
  discoveryConfidence?: unknown;
}

export function buildCandidateKey(
  searchRunId: string,
  supplierId: string,
  offeringId: string | null,
): string {
  return `${searchRunId}:${supplierId}:${offeringId ?? "-"}`;
}

export async function createSupplierCandidate(
  actor: SupplierIntelActor,
  input: CreateCandidateInput,
) {
  if (!(CANDIDATE_ORIGIN_SOURCES as readonly string[]).includes(input.originSource)) {
    throw new SupplierIntelError(
      "INVALID_ORIGIN_SOURCE",
      `originSource 必须是 ${CANDIDATE_ORIGIN_SOURCES.join("/")}`,
    );
  }

  return db.$transaction(async (tx) => {
    // F2.2 锁序：Run 锁最先，锁内裁决 RUNNING —— 与终态迁移互相串行（T20）
    const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, input.searchRunId);
    if (run.status !== "RUNNING") {
      throw new SupplierIntelError(
        "RUN_NOT_RUNNING",
        `候选只能在 RUNNING 的 Run 中创建（当前 ${run.status}）；重评估请新建 Run`,
      );
    }

    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, orgId: actor.orgId },
    });
    if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");

    const offeringId = input.offeringId?.trim() || null;
    let offering: SupplierOffering | null = null;
    if (offeringId) {
      offering = await tx.supplierOffering.findFirst({
        where: { id: offeringId, orgId: actor.orgId },
      });
      if (!offering) throw new SupplierIntelError("NOT_FOUND", "产品/报盘不存在");
      if (offering.supplierId !== supplier.id) {
        throw new SupplierIntelError(
          "OFFERING_SUPPLIER_MISMATCH",
          "offering 不属于该供应商",
        );
      }
    }

    const capturedAt = new Date();
    try {
      return await tx.supplierCandidate.create({
        data: {
          orgId: actor.orgId,
          searchRunId: run.id,
          supplierId: supplier.id,
          offeringId,
          candidateKey: buildCandidateKey(run.id, supplier.id, offeringId),
          originSource: input.originSource,
          supplierSnapshotJson: buildSupplierSnapshot(
            supplier,
            capturedAt,
          ) as Prisma.InputJsonValue,
          offeringSnapshotJson: offering
            ? (buildOfferingSnapshot(offering, capturedAt) as Prisma.InputJsonValue)
            : undefined,
          scoreVersion: run.scoreVersion,
          ...(input.discoveryConfidence !== undefined
            ? { discoveryConfidenceJson: input.discoveryConfidence as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        throw new SupplierIntelError(
          "DUPLICATE_CANDIDATE",
          "该 Run 中已存在同一 供应商×offering 候选",
        );
      }
      throw err;
    }
  });
}

export async function getCandidate(actor: SupplierIntelActor, candidateId: string) {
  return db.supplierCandidate.findFirst({
    where: { id: candidateId, orgId: actor.orgId },
    include: { matches: true },
  });
}

// ── Requirement Match ─────────────────────────────────────

/** 证据输入：certification 引用会在服务层被解析并整组冻结（不允许裸 id 落库） */
export type MatchEvidenceInput =
  | { kind: "certification"; certificationId: string }
  | { kind: "url"; url: string; snippet?: string | null }
  | { kind: "signal"; signalId: string; snippet?: string | null }
  | { kind: "archive"; archiveItemId: string; snippet?: string | null }
  | { kind: "note"; snippet: string };

export interface CreateRequirementMatchInput {
  candidateId: string;
  requirementKey: string;
  // F1.7：不接受调用方提供的 requirementRefId——canonical 需求身份一律由
  // Run.requirementSnapshotJson 服务端推导（快照是历史真相）
  verdict: string;
  confidence?: number | null;
  explanation?: string | null;
  evidence: MatchEvidenceInput[];
  evaluatedBy: string;
}

function clampSnippet(v: string | null | undefined): string | null {
  const trimmed = v?.trim() || null;
  if (!trimmed) return null;
  return trimmed.slice(0, SUPPLIER_INTEL_LIMITS.EXPLANATION_MAX_LENGTH);
}

export async function createRequirementMatch(
  actor: SupplierIntelActor,
  input: CreateRequirementMatchInput,
) {
  if (!(MATCH_VERDICTS as readonly string[]).includes(input.verdict)) {
    throw new SupplierIntelError(
      "INVALID_VERDICT",
      `verdict 必须是 ${MATCH_VERDICTS.join("/")}（UNKNOWN 永不折算 PASS）`,
    );
  }
  if (!(MATCH_EVALUATED_BY as readonly string[]).includes(input.evaluatedBy)) {
    throw new SupplierIntelError("INVALID_INPUT", "evaluatedBy 非法");
  }
  if (!Array.isArray(input.evidence)) {
    throw new SupplierIntelError("INVALID_INPUT", "evidence 必须是数组");
  }
  const explanation = clampSnippet(input.explanation);
  const confidence = input.confidence ?? null;
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    throw new SupplierIntelError("INVALID_INPUT", "confidence 必须在 0..1");
  }

  return db.$transaction(async (tx) => {
    // candidateId → searchRunId 为不可变字段，此读取仅取指针；随后按 F2.2 锁序先锁 Run
    const candidate = await tx.supplierCandidate.findFirst({
      where: { id: input.candidateId, orgId: actor.orgId },
      select: { id: true, searchRunId: true, supplierId: true, offeringId: true },
    });
    if (!candidate) throw new SupplierIntelError("NOT_FOUND", "候选不存在");

    const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, candidate.searchRunId);
    if (run.status !== "RUNNING") {
      throw new SupplierIntelError(
        "RUN_NOT_RUNNING",
        `需求匹配只能在 RUNNING 的 Run 中写入（当前 ${run.status}）；重评估请新建 Run`,
      );
    }

    const snapshotEntries = validateRequirementSnapshot(run.requirementSnapshotJson);
    const entry = indexRequirementSnapshot(snapshotEntries).get(input.requirementKey.trim());
    if (!entry) {
      throw new SupplierIntelError(
        "REQUIREMENT_KEY_NOT_IN_SNAPSHOT",
        `requirementKey 不在本 Run 的需求快照中：${input.requirementKey}`,
      );
    }
    const { mandatory, mandatoryUncertain } = collapseMandatoryForMatch(entry);

    // F1.8：先完成全部绑定/scope 裁决，通过后才按值冻结（快照不能把非法活引用洗白）
    const capturedAt = new Date();
    const frozenEvidence: Record<string, unknown>[] = [];
    for (const item of input.evidence) {
      if (!item || typeof item !== "object" || typeof item.kind !== "string") {
        throw new SupplierIntelError("INVALID_INPUT", "evidence 条目非法");
      }
      if (item.kind === "certification") {
        const cert = await tx.supplierCertification.findFirst({
          where: { id: item.certificationId, orgId: actor.orgId },
        });
        if (!cert) throw new SupplierIntelError("NOT_FOUND", "证据引用的认证不存在");
        // F1.2：证书必须属于本候选的供应商（供应商 B 的证书永远不能支撑供应商 A）
        if (cert.supplierId !== candidate.supplierId) {
          throw new SupplierIntelError(
            "CERT_SUPPLIER_MISMATCH",
            "认证属于其它供应商，不能支撑本候选",
          );
        }
        // F1.3：scope 兼容性显式裁决——SUPPLIER 级适用该供应商任何候选；
        // PRODUCT/MODEL_SERIES 级必须与候选的具体 offering 精确一致
        //（Offering X 的证书不得满足 Offering Y；候选无 offering 绑定时同样拒绝）
        if (cert.scope !== "SUPPLIER") {
          if (!candidate.offeringId || cert.offeringId !== candidate.offeringId) {
            throw new SupplierIntelError(
              "CERT_SCOPE_MISMATCH",
              `${cert.scope} 级认证只能支撑其绑定 offering 的候选（认证 offering=${cert.offeringId ?? "无"}，候选 offering=${candidate.offeringId ?? "无"}）`,
            );
          }
        }
        frozenEvidence.push(buildCertificationEvidenceSnapshot(cert, capturedAt));
      } else if (item.kind === "url") {
        const url = item.url?.trim();
        if (!url || url.length > SUPPLIER_INTEL_LIMITS.URL_MAX_LENGTH) {
          throw new SupplierIntelError("INVALID_INPUT", "证据 URL 非法或超长");
        }
        frozenEvidence.push({
          kind: "url",
          url,
          snippet: clampSnippet(item.snippet),
          capturedAt: capturedAt.toISOString(),
        });
      } else if (item.kind === "signal") {
        const signal = await tx.supplierDiscoverySignal.findFirst({
          where: { id: item.signalId, orgId: actor.orgId },
          select: { id: true, platform: true, contentUrl: true, status: true, linkedSupplierId: true },
        });
        if (!signal) throw new SupplierIntelError("NOT_FOUND", "证据引用的信号不存在");
        // F1.4：作为正式候选证据的信号必须已被人工 LINKED 到本候选的供应商——
        // 未关联 / 关联到其它供应商的信号只能是发现语境，不得支撑正式判定
        if (signal.status !== "LINKED" || signal.linkedSupplierId !== candidate.supplierId) {
          throw new SupplierIntelError(
            "SIGNAL_NOT_LINKED_TO_SUPPLIER",
            "信号未经人工关联到本候选供应商（实体解析工作流），不能作为正式证据",
          );
        }
        frozenEvidence.push({
          kind: "signal",
          signalId: signal.id,
          platform: signal.platform,
          contentUrl: signal.contentUrl,
          linkedSupplierId: signal.linkedSupplierId,
          snippet: clampSnippet(item.snippet),
          capturedAt: capturedAt.toISOString(),
        });
      } else if (item.kind === "archive") {
        const archiveItemId = item.archiveItemId?.trim();
        if (!archiveItemId) throw new SupplierIntelError("INVALID_INPUT", "archiveItemId 缺失");
        // F1.1：档案引用必须解析为本 org 的 TenderArchiveItem（非空字符串≠证据）
        await resolveArchiveEvidence(tx, actor.orgId, archiveItemId);
        frozenEvidence.push({
          kind: "archive",
          archiveItemId,
          snippet: clampSnippet(item.snippet),
          capturedAt: capturedAt.toISOString(),
        });
      } else if (item.kind === "note") {
        const snippet = clampSnippet(item.snippet);
        if (!snippet) throw new SupplierIntelError("INVALID_INPUT", "note 证据缺少内容");
        frozenEvidence.push({ kind: "note", snippet, capturedAt: capturedAt.toISOString() });
      } else {
        // 运行期兜底：路由层输入可能带未知 kind（类型层此分支为 never，故显式收窄）
        const rawKind = (item as { kind?: unknown }).kind;
        throw new SupplierIntelError("INVALID_INPUT", `未知证据类型：${String(rawKind)}`);
      }
    }

    try {
      return await tx.supplierRequirementMatch.create({
        data: {
          orgId: actor.orgId,
          candidateId: candidate.id,
          requirementKey: entry.code,
          // F1.7：导航 id 由 Run 快照服务端推导（快照=历史真相），不信任调用方
          requirementRefId: entry.id,
          mandatory,
          mandatoryUncertain,
          verdict: input.verdict,
          confidence,
          explanation,
          evidenceJson: frozenEvidence as unknown as Prisma.InputJsonValue,
          evaluationVersion: run.evaluationVersion,
          evaluatedBy: input.evaluatedBy,
        },
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        throw new SupplierIntelError(
          "DUPLICATE_MATCH",
          "该候选已存在同一 requirementKey 的匹配行",
        );
      }
      throw err;
    }
  });
}
