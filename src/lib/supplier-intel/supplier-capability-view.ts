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
 *
 * ── Slice 2 的访问面收紧 ─────────────────────────────────────
 * 供应商、产品、资质是 **org 级**；但线索是**项目级**的情报。Slice 1 的视图把「所有
 * 已归属到这家供应商的线索」连同标题一起列出，没有过项目可见性——于是一个没有某项目
 * 权限的 org 成员，可以经由供应商页读到那个项目的线索标题与能力内容，违反 S2 R1
 * 「信号读取必须过项目读权限」的不变量。现在线索与挂在其上的能力证据一律按
 * `buildSignalListScopeFilter`（S2 的同一套批量可见性）过滤。
 */

import { getOrgMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import type { SupplierIntelActor } from "./actor";
import { assertProjectAccessForActor, listAccessibleProjectIdsForActor } from "./access";
import { resolveRegistryProvider } from "./constants";
import { SupplierIntelError } from "./errors";
import { buildSignalListScopeFilter, buildSignalProjectVisibilityFilter } from "./signal-scope";

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
 *
 * 注意本门**不替代项目门**：能力声明挂在项目范围的线索上，
 * createCapabilitySignal 内部仍会断言该线索所属项目的写权限。
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

  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (user && isSuperAdmin(user.role)) return supplier;
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
  /** 出处：这条能力是从哪条线索读出来的（只会是当前用户看得见的线索） */
  source: {
    signalId: string;
    title: string | null;
    platform: string;
    contentUrl: string | null;
    rawTextExcerpt: string | null;
  };
}

export interface OfferingView {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  attributes: Record<string, string>;
  unitPrice: string | null;
  currency: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  priceStatus: string;
  sourceKind: string;
  sourceUrl: string | null;
  /** 该产品是从哪条线索登记的（只在当前用户看得见那条线索时给出） */
  sourceSignal: { id: string; title: string | null } | null;
  createdAt: string;
  /** 乐观并发的版本号：编辑时原样带回，服务端据此拒绝覆盖别人的改动 */
  updatedAt: string;
}

export interface CertificationEvidenceView {
  kind: "ARCHIVE" | "REGISTRY";
  /** ARCHIVE：档案标题（看不见所属项目时为 null，不泄露内容） */
  label: string | null;
  /** REGISTRY：登记库链接；ARCHIVE 不给直链（档案按内容寻址存储，经项目页查看） */
  url: string | null;
  providerLabel: string | null;
  /** 当前用户能否查看这份依据的内容 */
  viewable: boolean;
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
  verificationNote: string | null;
  offeringId: string | null;
  /** 过期是客观事实，不依赖有没有人来点一下「置为过期」；GET 不写库 */
  expiredByDate: boolean;
  /** VERIFIED 的核验依据；非 VERIFIED 为 null */
  evidence: CertificationEvidenceView | null;
}

export interface LinkedSignalView {
  id: string;
  title: string | null;
  platform: string;
  discoveredAt: string;
  contentUrl: string | null;
  rawTextExcerpt: string | null;
  /** 当前用户能否把能力声明挂到这条线索上（= 对其所属项目有写权限） */
  canAttachCapability: boolean;
}

export interface SupplierCapabilityPayload {
  supplier: { id: string; name: string };
  canWrite: boolean;
  /** 当前用于哪个项目（仅在用户对该项目有读权限时给出；供应商本身仍是 org 级） */
  projectContext: { id: string; name: string } | null;
  /**
   * 从哪里进来的——由**服务端核实**后给出，不是照抄 URL 参数：
   *   linkedSignal      该线索确实已人工关联到这家供应商，且用户看得见它
   *   internalCandidate 该次搜索确实把这家作为内部候选命中，且用户看得见那次搜索
   */
  entryContext: {
    linkedSignal: { id: string; title: string | null } | null;
    internalCandidate: { searchRunId: string; originSource: string } | null;
  };
  capabilities: CapabilityClaimView[];
  offerings: OfferingView[];
  certifications: CertificationView[];
  /** 已归属到这家供应商、且当前用户看得见的线索 */
  linkedSignals: LinkedSignalView[];
  counts: {
    capabilities: number;
    offerings: number;
    certifications: number;
    verifiedCertifications: number;
  };
}

const LIST_CAP = 200;
const EXCERPT_MAX = 280;

function excerpt(text: string | null): string | null {
  if (!text) return null;
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

/**
 * 线索的显示名：标题 → 账号名 → 原文前 40 字。
 * 人工提交的线索常常没有标题，只有一段原文；回退到 CUID 等于让采购同事在下拉里认 id。
 */
function signalLabel(s: { title: string | null; accountName: string | null; rawText: string | null }): string | null {
  if (s.title?.trim()) return s.title.trim();
  if (s.accountName?.trim()) return s.accountName.trim();
  const t = s.rawText?.trim();
  if (!t) return null;
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

function readAttributes(json: unknown): Record<string, string> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

async function canReadProject(actor: SupplierIntelActor, projectId: string): Promise<boolean> {
  try {
    await assertProjectAccessForActor(actor, projectId, "read");
    return true;
  } catch {
    return false;
  }
}

export async function loadSupplierCapabilityView(
  actor: SupplierIntelActor,
  supplierId: string,
  opts?: { projectId?: string | null; signalId?: string | null; searchRunId?: string | null },
): Promise<SupplierCapabilityPayload> {
  // 读写同门：能读到这里就说明是本 org 活跃成员，也就有写权限。
  // canWrite 仍然由服务端给出（前端不自行推断），每个写操作再独立裁决一次。
  const supplier = await assertSupplierAccessForActor(actor, supplierId);
  const canWrite = true;

  // 线索是项目级情报：只列当前用户看得见的（S2 同一套批量可见性，一次查询，不逐行鉴权）
  const [readFilter, writeScope] = await Promise.all([
    buildSignalListScopeFilter(actor),
    listAccessibleProjectIdsForActor(actor, "write"),
  ]);
  const baseSignalWhere = { orgId: actor.orgId, linkedSupplierId: supplierId, status: "LINKED" };

  const [linkedSignals, offerings, certifications] = await Promise.all([
    db.supplierDiscoverySignal.findMany({
      where: { AND: [...readFilter, baseSignalWhere] },
      orderBy: { discoveredAt: "desc" },
      take: LIST_CAP,
      select: {
        id: true, title: true, accountName: true, platform: true, discoveredAt: true,
        contentUrl: true, rawText: true,
      },
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

  const visibleIds = linkedSignals.map((s) => s.id);
  // 可写集合：同样是一次集合查询，与 createCapabilitySignal 的单条写门同一套判定树
  const writableRows = visibleIds.length
    ? await db.supplierDiscoverySignal.findMany({
        where: {
          AND: [
            ...buildSignalProjectVisibilityFilter(writeScope, actor.orgId),
            { id: { in: visibleIds } },
          ],
        },
        select: { id: true },
      })
    : [];
  const writable = new Set(writableRows.map((r) => r.id));

  // 能力证据挂在线索上：只取挂在**可见**线索上的，保证「能力 → 线索 → 原文」回溯链不断
  const capabilityRows = visibleIds.length
    ? await db.supplierCapabilitySignal.findMany({
        where: { orgId: actor.orgId, discoverySignalId: { in: visibleIds } },
        orderBy: { createdAt: "desc" },
        take: LIST_CAP,
      })
    : [];

  const signalById = new Map(linkedSignals.map((s) => [s.id, s]));

  // 资质的档案依据：档案属于项目，看不见所属项目就只说「有档案依据」，不给标题
  const archiveIds = [
    ...new Set(certifications.map((c) => c.archiveItemId).filter((v): v is string => Boolean(v))),
  ];
  const archiveRows = archiveIds.length
    ? await db.tenderArchiveItem.findMany({
        where: { orgId: actor.orgId, id: { in: archiveIds } },
        select: { id: true, projectId: true, kind: true, projectDocumentId: true, capturedAt: true },
      })
    : [];
  const docIds = archiveRows.map((a) => a.projectDocumentId).filter((v): v is string => Boolean(v));
  const docs = docIds.length
    ? await db.projectDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, title: true } })
    : [];
  const docTitle = new Map(docs.map((d) => [d.id, d.title]));
  const archiveReadable = new Map<string, boolean>();
  for (const a of archiveRows) {
    archiveReadable.set(a.id, await canReadProject(actor, a.projectId));
  }
  const archiveById = new Map(archiveRows.map((a) => [a.id, a]));

  // 项目上下文 / 入口上下文：服务端核实，URL 参数只是「想看哪个」，不是事实
  let projectContext: SupplierCapabilityPayload["projectContext"] = null;
  if (opts?.projectId && (await canReadProject(actor, opts.projectId))) {
    const p = await db.project.findFirst({
      where: { id: opts.projectId, orgId: actor.orgId },
      select: { id: true, name: true },
    });
    if (p) projectContext = p;
  }

  let entryLinkedSignal: SupplierCapabilityPayload["entryContext"]["linkedSignal"] = null;
  if (opts?.signalId) {
    const s = signalById.get(opts.signalId);
    if (s) entryLinkedSignal = { id: s.id, title: signalLabel(s) };
  }

  let entryCandidate: SupplierCapabilityPayload["entryContext"]["internalCandidate"] = null;
  if (opts?.searchRunId) {
    const run = await db.supplierSearchRun.findFirst({
      where: { id: opts.searchRunId, orgId: actor.orgId },
      select: { id: true, projectId: true },
    });
    if (run?.projectId && (await canReadProject(actor, run.projectId))) {
      const cand = await db.supplierCandidate.findFirst({
        where: { orgId: actor.orgId, searchRunId: run.id, supplierId },
        select: { originSource: true },
      });
      if (cand) entryCandidate = { searchRunId: run.id, originSource: cand.originSource };
    }
  }

  const now = Date.now();

  return {
    supplier,
    canWrite,
    projectContext,
    entryContext: { linkedSignal: entryLinkedSignal, internalCandidate: entryCandidate },
    capabilities: capabilityRows
      .filter((c) => signalById.has(c.discoverySignalId))
      .map((c) => {
        const src = signalById.get(c.discoverySignalId)!;
        return {
          id: c.id,
          type: c.type,
          value: c.value,
          evidenceStatus: c.evidenceStatus,
          confidence: c.confidence,
          explanation: c.explanation,
          extractedBy: c.extractedBy,
          createdAt: c.createdAt.toISOString(),
          source: {
            signalId: src.id,
            title: signalLabel(src),
            platform: src.platform,
            contentUrl: src.contentUrl,
            rawTextExcerpt: excerpt(src.rawText),
          },
        };
      }),
    offerings: offerings.map((o) => {
      const src = o.sourceSignalId ? signalById.get(o.sourceSignalId) : undefined;
      return {
        id: o.id,
        name: o.name,
        sku: o.sku,
        category: o.category,
        description: o.description,
        attributes: readAttributes(o.attributesJson),
        // Decimal → string：不经过 JS number，避免价格精度被悄悄改掉
        unitPrice: o.unitPrice === null ? null : String(o.unitPrice),
        currency: o.currency,
        moq: o.moq,
        leadTimeDays: o.leadTimeDays,
        incoterm: o.incoterm,
        priceStatus: o.priceStatus,
        sourceKind: o.sourceKind,
        sourceUrl: o.sourceUrl,
        sourceSignal: src ? { id: src.id, title: signalLabel(src) } : null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      };
    }),
    certifications: certifications.map((c) => {
      let evidence: CertificationEvidenceView | null = null;
      if (c.status === "VERIFIED") {
        if (c.archiveItemId) {
          const a = archiveById.get(c.archiveItemId);
          const viewable = Boolean(a && archiveReadable.get(a.id));
          evidence = {
            kind: "ARCHIVE",
            label: viewable && a
              ? (a.projectDocumentId ? docTitle.get(a.projectDocumentId) : null) ??
                `${a.kind} · ${a.capturedAt.toISOString().slice(0, 10)}`
              : null,
            url: null,
            providerLabel: null,
            viewable,
          };
        } else if (c.sourceUrl) {
          const provider = resolveRegistryProvider(c.sourceUrl);
          evidence = {
            kind: "REGISTRY",
            label: provider?.label ?? null,
            url: c.sourceUrl,
            providerLabel: provider?.label ?? null,
            viewable: true,
          };
        }
      }
      return {
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
        verificationNote: c.verificationNote,
        offeringId: c.offeringId,
        expiredByDate: Boolean(c.expiresAt && c.expiresAt.getTime() < now),
        evidence,
      };
    }),
    linkedSignals: linkedSignals.map((s) => ({
      id: s.id,
      title: signalLabel(s),
      platform: s.platform,
      discoveredAt: s.discoveredAt.toISOString(),
      contentUrl: s.contentUrl,
      rawTextExcerpt: excerpt(s.rawText),
      canAttachCapability: writable.has(s.id),
    })),
    counts: {
      capabilities: capabilityRows.filter((c) => signalById.has(c.discoverySignalId)).length,
      offerings: offerings.length,
      certifications: certifications.length,
      verifiedCertifications: certifications.filter((c) => c.status === "VERIFIED").length,
    },
  };
}
