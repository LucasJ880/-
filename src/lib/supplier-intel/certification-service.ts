/**
 * SupplierCertification 服务（B5 / B.1 §11）
 *
 * - 创建一律落 CLAIMED（不接受调用方指定 status）——「抖音简介写 UL Certified」永远只是 CLAIMED。
 * - VERIFIED 唯一写路径 = verifyCertification：人工动作 + 独立证据
 *   （archiveItemId，或 REGISTRY 来源的官方可查库 sourceUrl），fail-closed。
 *   SOCIAL/WEBSITE/BROCHURE 仅凭 source 自身不能 VERIFIED。
 * - scope 三级（SUPPLIER/PRODUCT/MODEL_SERIES）；PRODUCT/MODEL_SERIES 必须挂 offering。
 */

import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import {
  CERTIFICATION_SCOPES,
  CERTIFICATION_SOURCE_KINDS,
  CERTIFICATION_TRANSITIONS,
  CERTIFICATION_TYPES,
  SUPPLIER_INTEL_AUDIT_ACTIONS,
  SUPPLIER_INTEL_LIMITS,
  resolveRegistryProvider,
  type CertificationStatus,
} from "./constants";
import { SupplierIntelError } from "./errors";
import { resolveArchiveEvidence, resolveSourceSignalForSupplier } from "./evidence-scope";

const CERT_TARGET_TYPE = "supplier_certification";

export interface CreateCertificationInput {
  supplierId: string;
  offeringId?: string | null;
  scope: string;
  certificationType: string;
  certificateNumber?: string | null;
  issuer?: string | null;
  validFrom?: Date | null;
  expiresAt?: Date | null;
  sourceKind: string;
  sourceUrl?: string | null;
  sourceSignalId?: string | null;
  archiveItemId?: string | null;
  verificationNote?: string | null;
}

function shortOrNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim() || null;
  if (trimmed && trimmed.length > SUPPLIER_INTEL_LIMITS.SHORT_TEXT_MAX_LENGTH) {
    throw new SupplierIntelError("SHORT_TEXT_TOO_LONG", "字段超出长度上限");
  }
  return trimmed;
}

export async function createCertification(
  actor: SupplierIntelActor,
  input: CreateCertificationInput,
) {
  if (!(CERTIFICATION_SCOPES as readonly string[]).includes(input.scope)) {
    throw new SupplierIntelError("INVALID_SCOPE", `scope 必须是 ${CERTIFICATION_SCOPES.join("/")}`);
  }
  if (!(CERTIFICATION_TYPES as readonly string[]).includes(input.certificationType)) {
    throw new SupplierIntelError(
      "UNKNOWN_CERTIFICATION_TYPE",
      `未知认证类型：${input.certificationType}（目录 fail-closed，先扩目录再用）`,
    );
  }
  if (!(CERTIFICATION_SOURCE_KINDS as readonly string[]).includes(input.sourceKind)) {
    throw new SupplierIntelError("INVALID_INPUT", "sourceKind 非法");
  }

  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");

  const offeringId = input.offeringId?.trim() || null;
  // F1.3 scope↔offering 冻结规则：SUPPLIER 级必须 offeringId=null；
  // PRODUCT/MODEL_SERIES 级必须绑定具体 offering 且归属本供应商
  if (input.scope === "SUPPLIER" && offeringId) {
    throw new SupplierIntelError(
      "INVALID_SCOPE",
      "SUPPLIER 级认证不得绑定 offering（产品级认证请用 PRODUCT / MODEL_SERIES scope）",
    );
  }
  if (input.scope !== "SUPPLIER" && !offeringId) {
    throw new SupplierIntelError(
      "INVALID_SCOPE",
      "PRODUCT / MODEL_SERIES 级认证必须关联具体 offering（Supplier ≠ Product）",
    );
  }
  if (offeringId) {
    const offering = await db.supplierOffering.findFirst({
      where: { id: offeringId, orgId: actor.orgId },
      select: { id: true, supplierId: true },
    });
    if (!offering) throw new SupplierIntelError("NOT_FOUND", "产品/报盘不存在");
    if (offering.supplierId !== supplier.id) {
      throw new SupplierIntelError("OFFERING_SUPPLIER_MISMATCH", "offering 不属于该供应商");
    }
  }

  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl && sourceUrl.length > SUPPLIER_INTEL_LIMITS.URL_MAX_LENGTH) {
    throw new SupplierIntelError("URL_TOO_LONG", "sourceUrl 超长");
  }

  // F1.5：溯源信号指针必须真实、同 org、供应商绑定兼容（禁跨供应商溯源）
  const sourceSignalId = input.sourceSignalId?.trim() || null;
  if (sourceSignalId) {
    await resolveSourceSignalForSupplier(db, actor.orgId, sourceSignalId, supplier.id);
  }
  // F1.1：创建期携带的档案指针同样必须解析（避免坏指针在 verify 期被当独立证据）
  const archiveItemId = input.archiveItemId?.trim() || null;
  if (archiveItemId) {
    await resolveArchiveEvidence(db, actor.orgId, archiveItemId);
  }

  // status 恒为 CLAIMED：创建路径没有任何参数能产生 VERIFIED（H5）
  return db.supplierCertification.create({
    data: {
      orgId: actor.orgId,
      supplierId: supplier.id,
      offeringId,
      scope: input.scope,
      certificationType: input.certificationType,
      status: "CLAIMED",
      certificateNumber: shortOrNull(input.certificateNumber),
      issuer: shortOrNull(input.issuer),
      validFrom: input.validFrom ?? null,
      expiresAt: input.expiresAt ?? null,
      sourceKind: input.sourceKind,
      sourceUrl,
      sourceSignalId,
      archiveItemId,
      verificationNote: input.verificationNote?.trim() || null,
    },
  });
}

/**
 * 人工验证（唯一 VERIFIED 写路径）。fail-closed：无独立证据即拒绝——
 * archiveItemId（证书扫描件等，TenderArchiveItem 内容寻址档案）或
 * REGISTRY 来源的官方可查库 sourceUrl；社媒/官网/画册自述不构成证据。
 */
export async function verifyCertification(
  actor: SupplierIntelActor,
  certificationId: string,
  input?: { archiveItemId?: string | null; sourceUrl?: string | null; note?: string | null },
) {
  return db.$transaction(async (tx) => {
    const cert = await tx.supplierCertification.findFirst({
      where: { id: certificationId, orgId: actor.orgId },
    });
    if (!cert) throw new SupplierIntelError("NOT_FOUND", "认证记录不存在");

    const allowed = CERTIFICATION_TRANSITIONS[cert.status as CertificationStatus] ?? [];
    if (!(allowed as readonly string[]).includes("VERIFIED")) {
      throw new SupplierIntelError(
        "INVALID_CERT_TRANSITION",
        `不允许的认证状态迁移：${cert.status} → VERIFIED`,
      );
    }

    // F1.1：档案证据必须解析为本 org 的 TenderArchiveItem——提供了坏指针即拒绝，
    // 不静默回落到其它证据路径（fail-closed）
    const archiveItemId = input?.archiveItemId?.trim() || cert.archiveItemId;
    if (archiveItemId) {
      await resolveArchiveEvidence(tx, actor.orgId, archiveItemId);
    }

    // F1.6：REGISTRY 证据只认受支持的官方登记库（host 白名单）；
    // 任意网站 URL 标成 REGISTRY 不能自我认证成 VERIFIED
    let registryUrl: string | null = null;
    let registryProvider: { id: string; label: string } | null = null;
    if (!archiveItemId && cert.sourceKind === "REGISTRY") {
      registryUrl = input?.sourceUrl?.trim() || cert.sourceUrl;
      if (registryUrl) {
        registryProvider = resolveRegistryProvider(registryUrl);
        if (!registryProvider) {
          throw new SupplierIntelError(
            "REGISTRY_PROVIDER_UNSUPPORTED",
            "该 URL 不属于受支持的官方登记库（fail-closed 白名单）；一般网站链接不构成 REGISTRY 证据",
          );
        }
      }
    }

    if (!archiveItemId && !registryProvider) {
      throw new SupplierIntelError(
        "CERT_VERIFY_REQUIRES_EVIDENCE",
        "VERIFIED 需要独立证据：证书档案（archiveItemId）或受支持官方登记库链接（REGISTRY 来源）；" +
          "SOCIAL/WEBSITE/BROCHURE 仅凭来源自身不能验证",
      );
    }

    const updated = await tx.supplierCertification.updateMany({
      where: { id: cert.id, orgId: actor.orgId, status: cert.status },
      data: {
        status: "VERIFIED",
        archiveItemId: archiveItemId ?? null,
        verifiedByUserId: actor.userId,
        verifiedAt: new Date(),
        ...(input?.note?.trim() ? { verificationNote: input.note.trim() } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new SupplierIntelError("INVALID_CERT_TRANSITION", "认证状态已被并发修改");
    }
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.CERTIFICATION_VERIFIED,
      targetType: CERT_TARGET_TYPE,
      targetId: cert.id,
      beforeData: { status: cert.status },
      afterData: {
        status: "VERIFIED",
        archiveItemId: archiveItemId ?? null,
        registryUrl,
        registryProvider: registryProvider?.id ?? null,
        scope: cert.scope,
        certificationType: cert.certificationType,
      },
    });
    return tx.supplierCertification.findFirst({ where: { id: cert.id, orgId: actor.orgId } });
  });
}

/** 治理动作：REJECTED / EXPIRED（按状态机；不提供回 CLAIMED/VERIFIED 的通道） */
export async function updateCertificationStatus(
  actor: SupplierIntelActor,
  certificationId: string,
  to: "REJECTED" | "EXPIRED",
  note?: string | null,
) {
  const cert = await db.supplierCertification.findFirst({
    where: { id: certificationId, orgId: actor.orgId },
    select: { id: true, status: true },
  });
  if (!cert) throw new SupplierIntelError("NOT_FOUND", "认证记录不存在");
  const allowed = CERTIFICATION_TRANSITIONS[cert.status as CertificationStatus] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new SupplierIntelError(
      "INVALID_CERT_TRANSITION",
      `不允许的认证状态迁移：${cert.status} → ${to}`,
    );
  }
  const updated = await db.supplierCertification.updateMany({
    where: { id: cert.id, orgId: actor.orgId, status: cert.status },
    data: { status: to, ...(note?.trim() ? { verificationNote: note.trim() } : {}) },
  });
  if (updated.count !== 1) {
    throw new SupplierIntelError("INVALID_CERT_TRANSITION", "认证状态已被并发修改");
  }
  return db.supplierCertification.findFirst({ where: { id: cert.id, orgId: actor.orgId } });
}

// ── Offering（B4 最小 CRUD：评估脊柱的输入面）───────────────

export interface CreateOfferingInput {
  supplierId: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  attributes?: unknown;
  unitPrice?: number | string | null;
  currency?: string | null;
  moq?: number | null;
  leadTimeDays?: number | null;
  incoterm?: string | null;
  priceStatus?: string | null;
  sourceKind: string;
  sourceUrl?: string | null;
  sourceSignalId?: string | null;
}

export async function createOffering(actor: SupplierIntelActor, input: CreateOfferingInput) {
  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");
  const name = input.name?.trim();
  if (!name) throw new SupplierIntelError("INVALID_INPUT", "offering 名称必填");

  const priceStatus = input.priceStatus?.trim() || "UNKNOWN";
  if (!["KNOWN", "ESTIMATED", "UNKNOWN"].includes(priceStatus)) {
    throw new SupplierIntelError("INVALID_INPUT", "priceStatus 非法");
  }
  if (!["DISCOVERY", "MANUAL", "BROCHURE", "INQUIRY"].includes(input.sourceKind)) {
    throw new SupplierIntelError("INVALID_INPUT", "sourceKind 非法");
  }

  // F1.5：offering 溯源信号指针同样 fail-closed（同 org + 供应商绑定兼容）
  const offeringSourceSignalId = input.sourceSignalId?.trim() || null;
  if (offeringSourceSignalId) {
    await resolveSourceSignalForSupplier(db, actor.orgId, offeringSourceSignalId, supplier.id);
  }

  // 缺价合法：unitPrice 为空 + priceStatus=UNKNOWN 不构成任何拒绝理由（B4，T13）
  return db.supplierOffering.create({
    data: {
      orgId: actor.orgId,
      supplierId: supplier.id,
      name: name.slice(0, SUPPLIER_INTEL_LIMITS.SHORT_TEXT_MAX_LENGTH),
      sku: shortOrNull(input.sku),
      category: shortOrNull(input.category),
      description: input.description?.trim() || null,
      attributesJson:
        input.attributes === undefined || input.attributes === null
          ? undefined
          : (input.attributes as object),
      unitPrice: input.unitPrice === null || input.unitPrice === undefined ? null : input.unitPrice,
      currency: shortOrNull(input.currency),
      moq: input.moq ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      incoterm: shortOrNull(input.incoterm),
      priceStatus,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl?.trim() || null,
      sourceSignalId: offeringSourceSignalId,
      createdByUserId: actor.userId,
    },
  });
}

/** 工作层可变更新（live 行；历史 Candidate 的 offeringSnapshotJson 不受影响——T11-C/D/E） */
export async function updateOffering(
  actor: SupplierIntelActor,
  offeringId: string,
  patch: Partial<Omit<CreateOfferingInput, "supplierId" | "sourceKind">>,
) {
  const existing = await db.supplierOffering.findFirst({
    where: { id: offeringId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!existing) throw new SupplierIntelError("NOT_FOUND", "产品/报盘不存在");

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name?.trim();
    if (!name) throw new SupplierIntelError("INVALID_INPUT", "offering 名称不能为空");
    data.name = name.slice(0, SUPPLIER_INTEL_LIMITS.SHORT_TEXT_MAX_LENGTH);
  }
  if (patch.sku !== undefined) data.sku = shortOrNull(patch.sku);
  if (patch.category !== undefined) data.category = shortOrNull(patch.category);
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.attributes !== undefined) data.attributesJson = patch.attributes as object;
  if (patch.unitPrice !== undefined) data.unitPrice = patch.unitPrice;
  if (patch.currency !== undefined) data.currency = shortOrNull(patch.currency);
  if (patch.moq !== undefined) data.moq = patch.moq;
  if (patch.leadTimeDays !== undefined) data.leadTimeDays = patch.leadTimeDays;
  if (patch.incoterm !== undefined) data.incoterm = shortOrNull(patch.incoterm);
  if (patch.priceStatus !== undefined) {
    const ps = patch.priceStatus?.trim();
    if (!ps || !["KNOWN", "ESTIMATED", "UNKNOWN"].includes(ps)) {
      throw new SupplierIntelError("INVALID_INPUT", "priceStatus 非法");
    }
    data.priceStatus = ps;
  }
  if (patch.sourceUrl !== undefined) data.sourceUrl = patch.sourceUrl?.trim() || null;

  await db.supplierOffering.updateMany({
    where: { id: offeringId, orgId: actor.orgId },
    data,
  });
  return db.supplierOffering.findFirst({ where: { id: offeringId, orgId: actor.orgId } });
}
