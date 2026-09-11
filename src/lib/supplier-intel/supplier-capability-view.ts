/**
 * S3-B：供应商能力与资质的人工归一视图（服务层）。
 *
 * S3-A 让采购同事把一条线索**归属**到某家供应商（LINK）。到此为止我们知道
 * 「这是谁」，但还不知道「他到底能供什么、凭什么信」。S3-B 补的就是这一层：
 *
 *   能力声明（SupplierCapabilitySignal） —— 他说他能做什么，出处是哪条线索
 *   可供产品（SupplierOffering）         —— 具体的产品/型号；**Supplier ≠ Product**
 *   资质（SupplierCertification）        —— 声称的认证，以及人工核验后的状态
 *
 * 三条纪律（沿用 S1 冻结口径，服务层已强制，这里只是把它们如实呈现）：
 *   1. **CLAIMED ≠ VERIFIED**。social/discovery 写路径永远产不出 VERIFIED；
 *      VERIFIED 只能由「独立证据 + 人工确认」产生（archive 证据或官方登记库白名单）。
 *   2. **缺价合法**。priceStatus=UNKNOWN 且无单价，不构成任何拒绝理由——
 *      国内厂家报价普遍要谈，缺价就拒等于把大半个市场排除掉。
 *   3. **能力声明必须有出处**。SupplierCapabilitySignal 挂在 discoverySignal 上，
 *      因此每一条能力都能回溯到「哪条线索、哪段原文」，不存在凭空出现的能力。
 */

import { getOrgMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { SupplierIntelActor } from "./actor";
import { SupplierIntelError } from "./errors";

/**
 * 供应商是 **org 级**资源（不像 Run/Signal 那样绑项目），所以这里的门是
 * 「本 org 的活跃成员」，与既有 `/api/suppliers` 一致——不为 S3-B 另造一套供应商权限。
 * 跨 org 一律 NOT_FOUND（不泄露存在性）。
 *
 * 读写同门，所以**不收 level 参数**：加一个不起作用的 level 只会让调用处看起来
 * 像做了区分。真要区分时再加，并同时加测试。
 *
 * 另外刻意**没有**给 VERIFIED 加额外角色门：认证可信度的真正控制点是
 * 「必须有独立证据」（certification-service 已 fail-closed 强制），不是谁点的按钮。
 * 把控制点放在证据上，比放在角色上更难被绕过。
 *
 * 注意本门**不替代项目门**：能力声明挂在项目范围的线索上，
 * createCapabilitySignal 内部仍会断言该线索所属项目的写权限（B6e 有断言）。
 */
export async function assertSupplierAccessForActor(
  actor: SupplierIntelActor,
  supplierId: string,
): Promise<{ id: string; name: string }> {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, orgId: actor.orgId },
    select: { id: true, name: true },
  });
  if (!supplier) throw new SupplierIntelError("NOT_FOUND", "供应商不存在");

  if (await isSuperAdmin(actor.userId)) return supplier;
  const membership = await getOrgMembership(actor.userId, actor.orgId);
  if (!membership || membership.status !== "active") {
    throw new SupplierIntelError("NOT_FOUND", "供应商不存在");
  }
  return supplier;
}

export interface CapabilityClaimView {
  id: string;
  type: string;
  value: string | null;
  evidenceStatus: string;
  confidence: number | null;
  explanation: string | null;
  extractedBy: string;
  createdAt: string;
  /** 出处：这条能力是从哪条线索读出来的 */
  source: { signalId: string; title: string | null; platform: string } | null;
}

export interface OfferingView {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  unitPrice: string | null;
  currency: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  priceStatus: string;
  sourceKind: string;
  sourceUrl: string | null;
  createdAt: string;
}

export interface CertificationView {
  id: string;
  scope: string;
  certificationType: string;
  certificateNumber: string | null;
  issuer: string | null;
  status: string;
  sourceKind: string;
  sourceUrl: string | null;
  validFrom: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  offeringId: string | null;
  /** 过期是客观事实，不依赖有没有人来点一下「置为过期」 */
  expiredByDate: boolean;
}

export interface SupplierCapabilityPayload {
  supplier: { id: string; name: string };
  canWrite: boolean;
  capabilities: CapabilityClaimView[];
  offerings: OfferingView[];
  certifications: CertificationView[];
  /** 已归属到这家供应商的线索——新增能力声明必须挂在其中一条上（能力必须有出处） */
  linkedSignals: Array<{ id: string; title: string | null; platform: string; discoveredAt: string }>;
  counts: { capabilities: number; offerings: number; certifications: number; verifiedCertifications: number };
}

const LIST_CAP = 200;

export async function loadSupplierCapabilityView(
  actor: SupplierIntelActor,
  supplierId: string,
): Promise<SupplierCapabilityPayload> {
  // 读写同门：能读到这里就说明是本 org 活跃成员，也就有写权限。
  // canWrite 仍然由服务端给出（前端不自行推断），每个写操作再独立裁决一次。
  const supplier = await assertSupplierAccessForActor(actor, supplierId);
  const canWrite = true;

  const [linkedSignals, offerings, certifications] = await Promise.all([
    db.supplierDiscoverySignal.findMany({
      where: { orgId: actor.orgId, linkedSupplierId: supplierId, status: "LINKED" },
      orderBy: { discoveredAt: "desc" },
      take: LIST_CAP,
      select: { id: true, title: true, accountName: true, platform: true, discoveredAt: true },
    }),
    db.supplierOffering.findMany({
      where: { orgId: actor.orgId, supplierId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
    }),
    db.supplierCertification.findMany({
      where: { orgId: actor.orgId, supplierId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
    }),
  ]);

  // 能力声明挂在 discoverySignal 上：只取归属到这家供应商的那些，
  // 保证「能力 → 线索 → 原文」这条回溯链不断。
  const capabilityRows = linkedSignals.length
    ? await db.supplierCapabilitySignal.findMany({
        where: { orgId: actor.orgId, discoverySignalId: { in: linkedSignals.map((s) => s.id) } },
        orderBy: { createdAt: "desc" },
        take: LIST_CAP,
      })
    : [];

  const signalById = new Map(linkedSignals.map((s) => [s.id, s]));
  const now = Date.now();

  return {
    supplier,
    canWrite,
    capabilities: capabilityRows.map((c) => {
      const src = signalById.get(c.discoverySignalId);
      return {
        id: c.id,
        type: c.type,
        value: c.value,
        evidenceStatus: c.evidenceStatus,
        confidence: c.confidence,
        explanation: c.explanation,
        extractedBy: c.extractedBy,
        createdAt: c.createdAt.toISOString(),
        source: src
          ? { signalId: src.id, title: src.title ?? src.accountName, platform: src.platform }
          : null,
      };
    }),
    offerings: offerings.map((o) => ({
      id: o.id,
      name: o.name,
      sku: o.sku,
      category: o.category,
      description: o.description,
      // Decimal → string：不经过 JS number，避免价格精度被悄悄改掉
      unitPrice: o.unitPrice === null ? null : String(o.unitPrice),
      currency: o.currency,
      moq: o.moq,
      leadTimeDays: o.leadTimeDays,
      incoterm: o.incoterm,
      priceStatus: o.priceStatus,
      sourceKind: o.sourceKind,
      sourceUrl: o.sourceUrl,
      createdAt: o.createdAt.toISOString(),
    })),
    certifications: certifications.map((c) => ({
      id: c.id,
      scope: c.scope,
      certificationType: c.certificationType,
      certificateNumber: c.certificateNumber,
      issuer: c.issuer,
      status: c.status,
      sourceKind: c.sourceKind,
      sourceUrl: c.sourceUrl,
      validFrom: c.validFrom ? c.validFrom.toISOString() : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
      offeringId: c.offeringId,
      expiredByDate: Boolean(c.expiresAt && c.expiresAt.getTime() < now),
    })),
    linkedSignals: linkedSignals.map((s) => ({
      id: s.id,
      title: s.title ?? s.accountName,
      platform: s.platform,
      discoveredAt: s.discoveredAt.toISOString(),
    })),
    counts: {
      capabilities: capabilityRows.length,
      offerings: offerings.length,
      certifications: certifications.length,
      verifiedCertifications: certifications.filter((c) => c.status === "VERIFIED").length,
    },
  };
}
