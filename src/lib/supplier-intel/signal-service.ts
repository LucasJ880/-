/**
 * SupplierDiscoverySignal / SupplierCapabilitySignal 服务（层 A/C ingestion + 人审流转）
 *
 * 信任边界（B.1 §12，H5）：
 *   - capability 的 social 写路径 evidenceStatus 值域仅 {CLAIMED, OBSERVED, UNKNOWN}；
 *     VERIFIED 一律拒绝（SOCIAL_VERIFIED_WRITE_BLOCKED）。
 *   - AI_ASSISTED 标注 confidence ≤ 0.8，且 extractedBy 落库；信任提升 = append 新记录，
 *     不原地改写 AI observation。
 *   - 所有 LINKED 动作是人工点按；解析结果只 append 进 resolutionJson，不覆盖。
 */

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import {
  AI_ASSISTED_CONFIDENCE_CAP,
  CAPABILITY_EXTRACTED_BY,
  CAPABILITY_TYPES,
  SIGNAL_TRANSITIONS,
  SOCIAL_WRITE_EVIDENCE_STATUSES,
  SUPPLIER_INTEL_AUDIT_ACTIONS,
  SUPPLIER_INTEL_LIMITS,
  type SignalStatus,
} from "./constants";
import { SupplierIntelError } from "./errors";
import { parseUserSubmission } from "./submission-parser";

const SIGNAL_TARGET_TYPE = "supplier_discovery_signal";

function assertShortText(v: string | null | undefined, label: string): string | null {
  const trimmed = v?.trim() || null;
  if (trimmed && trimmed.length > SUPPLIER_INTEL_LIMITS.SHORT_TEXT_MAX_LENGTH) {
    throw new SupplierIntelError("SHORT_TEXT_TOO_LONG", `${label} 超出上限`);
  }
  return trimmed;
}

async function assertProjectPointerInOrg(
  orgId: string,
  pointer: string | null | undefined,
  label: string,
): Promise<string | null> {
  const id = pointer?.trim() || null;
  if (!id) return null;
  const row = await db.project.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!row) {
    throw new SupplierIntelError("INVALID_INPUT", `${label} 不存在或不属于当前组织`);
  }
  return id;
}

export interface SubmitSignalInput {
  url?: string | null;
  rawText?: string | null;
  /** true = 采购人员手工线索（层 C MANUAL_ENTRY）；默认层 A USER_SUBMITTED */
  manualEntry?: boolean;
  projectId?: string | null;
  tenderId?: string | null;
  searchRunId?: string | null;
  rawMetadata?: unknown;
}

/**
 * 用户提交/手工录入 → 建发现信号。纯字符串解析（零抓取零 SSRF，见 submission-parser）；
 * 解析不到的字段留 null，禁止猜（B.1 §16）。
 */
export async function createSubmittedSignal(actor: SupplierIntelActor, input: SubmitSignalInput) {
  const parsed = parseUserSubmission({ url: input.url, rawText: input.rawText });

  let rawMetadataJson: Prisma.InputJsonValue | undefined;
  if (input.rawMetadata !== undefined && input.rawMetadata !== null) {
    let serialized: string;
    try {
      serialized = JSON.stringify(input.rawMetadata);
    } catch {
      throw new SupplierIntelError("METADATA_TOO_LARGE", "metadata 无法序列化");
    }
    if (Buffer.byteLength(serialized, "utf8") > SUPPLIER_INTEL_LIMITS.METADATA_MAX_BYTES) {
      throw new SupplierIntelError("METADATA_TOO_LARGE", "metadata 超出大小上限");
    }
    rawMetadataJson = input.rawMetadata as Prisma.InputJsonValue;
  }

  const projectId = await assertProjectPointerInOrg(actor.orgId, input.projectId, "项目");
  const tenderId = await assertProjectPointerInOrg(actor.orgId, input.tenderId, "招标项目");

  const searchRunId = input.searchRunId?.trim() || null;
  if (searchRunId) {
    const run = await db.supplierSearchRun.findFirst({
      where: { id: searchRunId, orgId: actor.orgId },
      select: { status: true },
    });
    if (!run) throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
    if (run.status !== "PLANNED" && run.status !== "RUNNING") {
      throw new SupplierIntelError(
        "RUN_IMMUTABLE",
        "Run 已处于终态，不能再挂新信号；重评估请新建 Run",
      );
    }
  }

  return db.$transaction(async (tx) => {
    const signal = await tx.supplierDiscoverySignal.create({
      data: {
        orgId: actor.orgId,
        projectId,
        tenderId,
        searchRunId,
        platform: parsed.platform,
        contentType: parsed.contentType,
        sourceOrigin: input.manualEntry ? "MANUAL_ENTRY" : "USER_SUBMITTED",
        contentUrl: parsed.contentUrl,
        rawText: parsed.rawText,
        rawMetadataJson,
        accountName: parsed.accountName,
        accountUrl: parsed.accountUrl,
        title: parsed.title,
        description: parsed.description,
        publishedAt: parsed.publishedAt,
      },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_CREATED,
      targetType: SIGNAL_TARGET_TYPE,
      targetId: signal.id,
      afterData: {
        platform: signal.platform,
        sourceOrigin: signal.sourceOrigin,
        hasUrl: Boolean(signal.contentUrl),
      },
    });
    return signal;
  });
}

export async function getSignal(actor: SupplierIntelActor, signalId: string) {
  return db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
    include: { capabilitySignals: true },
  });
}

export async function listSignals(
  actor: SupplierIntelActor,
  opts?: { status?: string; platform?: string; take?: number },
) {
  return db.supplierDiscoverySignal.findMany({
    where: {
      orgId: actor.orgId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.platform ? { platform: opts.platform } : {}),
    },
    orderBy: { discoveredAt: "desc" },
    take: Math.min(opts?.take ?? 100, 200),
  });
}

function assertSignalTransition(from: string, to: SignalStatus): void {
  const allowed = SIGNAL_TRANSITIONS[from as SignalStatus];
  if (!allowed || !(allowed as readonly string[]).includes(to)) {
    throw new SupplierIntelError(
      "INVALID_SIGNAL_TRANSITION",
      `不允许的信号状态迁移：${from} → ${to}`,
    );
  }
}

async function transitionSignal(
  actor: SupplierIntelActor,
  signalId: string,
  to: SignalStatus,
  action: string,
  extraData?: Record<string, unknown>,
  resolutionEntry?: Record<string, unknown>,
) {
  return db.$transaction(async (tx) => {
    const signal = await tx.supplierDiscoverySignal.findFirst({
      where: { id: signalId, orgId: actor.orgId },
    });
    if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");
    assertSignalTransition(signal.status, to);

    const resolutionJson = resolutionEntry
      ? ([
          ...(Array.isArray(signal.resolutionJson) ? (signal.resolutionJson as unknown[]) : []),
          resolutionEntry,
        ] as unknown as Prisma.InputJsonValue)
      : undefined;

    const updated = await tx.supplierDiscoverySignal.updateMany({
      where: { id: signalId, orgId: actor.orgId, status: signal.status },
      data: {
        status: to,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
        ...(extraData ?? {}),
        ...(resolutionJson !== undefined ? { resolutionJson } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new SupplierIntelError(
        "INVALID_SIGNAL_TRANSITION",
        `信号状态已被并发修改：${signal.status} → ${to} 未生效`,
      );
    }
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: signal.projectId,
      action,
      targetType: SIGNAL_TARGET_TYPE,
      targetId: signalId,
      beforeData: { status: signal.status },
      afterData: { status: to, ...(extraData ?? {}) },
    });
    return tx.supplierDiscoverySignal.findFirst({ where: { id: signalId, orgId: actor.orgId } });
  });
}

export async function reviewSignal(actor: SupplierIntelActor, signalId: string) {
  return transitionSignal(actor, signalId, "REVIEWED", SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_REVIEWED);
}

export async function rejectSignal(actor: SupplierIntelActor, signalId: string) {
  return transitionSignal(actor, signalId, "REJECTED", SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_REJECTED);
}

/**
 * 人工把信号关联到本 org 的既有 Supplier（M1 全部 LINKED 动作都是人工点按；
 * 实体解析只做预填，永不自动合并）。
 */
export async function linkSignalToSupplier(
  actor: SupplierIntelActor,
  signalId: string,
  input: { supplierId: string; note?: string | null },
) {
  const supplierId = input.supplierId?.trim();
  if (!supplierId) throw new SupplierIntelError("INVALID_INPUT", "缺少 supplierId");
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, orgId: actor.orgId },
    select: { id: true, name: true },
  });
  if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");

  return transitionSignal(
    actor,
    signalId,
    "LINKED",
    SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_LINKED,
    { linkedSupplierId: supplier.id },
    {
      decision: "HUMAN_LINKED",
      supplierId: supplier.id,
      supplierName: supplier.name,
      byUserId: actor.userId,
      note: assertShortText(input.note, "备注"),
      at: new Date().toISOString(),
    },
  );
}

// ── Capability Signal（信任边界写路径）─────────────────────

export interface CreateCapabilitySignalInput {
  discoverySignalId: string;
  type: string;
  value?: string | null;
  /** social 写路径值域：CLAIMED | OBSERVED | UNKNOWN（VERIFIED 会被拒绝） */
  evidenceStatus: string;
  confidence?: number | null;
  explanation?: string | null;
  extractedBy: string;
}

export async function createCapabilitySignal(
  actor: SupplierIntelActor,
  input: CreateCapabilitySignalInput,
) {
  if (!(CAPABILITY_TYPES as readonly string[]).includes(input.type)) {
    throw new SupplierIntelError(
      "UNKNOWN_CAPABILITY_TYPE",
      `未知 capability 类型：${input.type}（目录 fail-closed，先扩目录再用）`,
    );
  }
  if (input.evidenceStatus === "VERIFIED") {
    throw new SupplierIntelError(
      "SOCIAL_VERIFIED_WRITE_BLOCKED",
      "social/discovery 写路径不得产生 VERIFIED——VERIFIED 只能由独立证据 + 人工确认路径产生",
    );
  }
  if (!(SOCIAL_WRITE_EVIDENCE_STATUSES as readonly string[]).includes(input.evidenceStatus)) {
    throw new SupplierIntelError(
      "INVALID_EVIDENCE_STATUS",
      `evidenceStatus 必须是 ${SOCIAL_WRITE_EVIDENCE_STATUSES.join("/")}`,
    );
  }
  if (!(CAPABILITY_EXTRACTED_BY as readonly string[]).includes(input.extractedBy)) {
    throw new SupplierIntelError("INVALID_INPUT", "extractedBy 必须是 HUMAN | AI_ASSISTED");
  }
  const confidence = input.confidence ?? null;
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    throw new SupplierIntelError("INVALID_INPUT", "confidence 必须在 0..1");
  }
  if (
    input.extractedBy === "AI_ASSISTED" &&
    confidence !== null &&
    confidence > AI_ASSISTED_CONFIDENCE_CAP
  ) {
    throw new SupplierIntelError(
      "AI_CONFIDENCE_EXCEEDS_CAP",
      `AI_ASSISTED 标注的 confidence 上限为 ${AI_ASSISTED_CONFIDENCE_CAP}`,
    );
  }
  const explanation = input.explanation?.trim() || null;
  if (explanation && explanation.length > SUPPLIER_INTEL_LIMITS.EXPLANATION_MAX_LENGTH) {
    throw new SupplierIntelError(
      "EXPLANATION_TOO_LONG",
      `explanation 超出上限 ${SUPPLIER_INTEL_LIMITS.EXPLANATION_MAX_LENGTH} 字符`,
    );
  }

  const signal = await db.supplierDiscoverySignal.findFirst({
    where: { id: input.discoverySignalId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");

  return db.supplierCapabilitySignal.create({
    data: {
      orgId: actor.orgId,
      discoverySignalId: signal.id,
      type: input.type,
      value: assertShortText(input.value, "value"),
      evidenceStatus: input.evidenceStatus,
      confidence,
      explanation,
      extractedBy: input.extractedBy,
    },
  });
}
