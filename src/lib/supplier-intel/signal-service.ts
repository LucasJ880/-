/**
 * SupplierDiscoverySignal / SupplierCapabilitySignal 服务（层 A/C ingestion + 人审流转）
 *
 * 信任边界（B.1 §12，H5）：
 *   - capability 的 social 写路径 evidenceStatus 值域仅 {CLAIMED, OBSERVED, UNKNOWN}；
 *     VERIFIED 一律拒绝（SOCIAL_VERIFIED_WRITE_BLOCKED）。
 *   - AI_ASSISTED 标注 confidence ≤ 0.8，且 extractedBy 落库；信任提升 = append 新记录，
 *     不原地改写 AI observation。
 *   - 所有 LINKED 动作是人工点按；解析结果只 append 进 resolutionJson，不覆盖。
 *
 * R1（Trust-Boundary Closure）：所有入口按**有效项目归属**做项目级授权（见 signal-scope.ts）——
 * 读（查看单条/列表）要项目 read，写（创建/review/reject/link/capability）要项目 write；
 * signal.projectId 为空但挂在项目绑定 Run 上的信号继承 Run 归属，绝不当组织公共线索。
 */

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import { assertProjectAccessForActor } from "./access";
import {
  AI_ASSISTED_CONFIDENCE_CAP,
  CAPABILITY_EXTRACTED_BY,
  CAPABILITY_TYPES,
  SIGNAL_PLATFORMS,
  SIGNAL_TRANSITIONS,
  SOCIAL_WRITE_EVIDENCE_STATUSES,
  SUPPLIER_INTEL_AUDIT_ACTIONS,
  SUPPLIER_INTEL_LIMITS,
  type SignalStatus,
} from "./constants";
import { SupplierIntelError } from "./errors";
import { lockSupplierSearchRunForWrite } from "./run-service";
import {
  assertSignalAccess,
  assertSubmitSignalAccess,
  buildSignalListScopeFilter,
  buildSignalProjectFilter,
  detectSubmitPointerConflicts,
} from "./signal-scope";
import { existingResolutionEntries, lockSignalForWrite } from "./signal-write-lock";
import { parseUserSubmission, validatePublicHttpUrl } from "./submission-parser";

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

  // R1：授权先于业务写入——解析有效项目归属（含 Run 继承），拒绝混合指针，
  // 对治理集合内每个项目断言写权限（空集合 = 真正的组织级线索，沿用既有 org 授权）
  await assertSubmitSignalAccess(actor, { projectId, tenderId, searchRunId });

  return db.$transaction(async (tx) => {
    // F2.2 锁序：挂 Run 的信号先锁 Run、锁内裁决非终态——与终态迁移互相串行（T20）
    if (searchRunId) {
      const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, searchRunId);
      if (run.status !== "PLANNED" && run.status !== "RUNNING") {
        throw new SupplierIntelError(
          "RUN_IMMUTABLE",
          "Run 已处于终态，不能再挂新信号；重评估请新建 Run",
        );
      }
    }
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

export interface DiscoveredSignalInput {
  searchRunId: string;
  platform: string;
  contentUrl: string;
  title?: string | null;
  description?: string | null;
  sourceQuery?: string | null;
  projectId?: string | null;
  tenderId?: string | null;
}

/**
 * 层 B（PUBLIC_WEB）发现结果落信号（M1-S2）。与用户提交同一信任面：
 * 只存搜索引擎已合法索引的元数据，零抓取；同 Run 同 contentUrl 幂等去重；
 * F2 锁序：先锁 Run、锁内裁决非终态。
 */
export async function createDiscoveredSignal(actor: SupplierIntelActor, input: DiscoveredSignalInput) {
  if (!(SIGNAL_PLATFORMS as readonly string[]).includes(input.platform)) {
    throw new SupplierIntelError("INVALID_INPUT", `未知平台：${input.platform}`);
  }
  const url = validatePublicHttpUrl(input.contentUrl).toString();
  const projectId = await assertProjectPointerInOrg(actor.orgId, input.projectId, "项目");
  const tenderId = await assertProjectPointerInOrg(actor.orgId, input.tenderId, "招标项目");

  return db.$transaction(async (tx) => {
    const run = await lockSupplierSearchRunForWrite(tx, actor.orgId, input.searchRunId);
    if (run.status !== "PLANNED" && run.status !== "RUNNING") {
      throw new SupplierIntelError(
        "RUN_IMMUTABLE",
        "Run 已处于终态，不能再挂新信号；重评估请新建 Run",
      );
    }
    // R1：本函数不是 HTTP 入口——授权由 executeSupplierSearchRun 在任何计划/外呼前对
    // run.projectId 断言写权限完成（覆盖同一治理集合，信号归属 `?? run.*` 继承 Run）。
    // 这里只做零额外查询的指针一致性校验，防止调用方传入与 Run 不一致的项目指针。
    const pointerConflicts = detectSubmitPointerConflicts(
      { projectId, tenderId, searchRunId: run.id },
      run,
    );
    if (pointerConflicts.length > 0) {
      throw new SupplierIntelError(
        "INVALID_INPUT",
        `项目指针与 Run 归属冲突：${pointerConflicts.join("；")}`,
      );
    }
    const existing = await tx.supplierDiscoverySignal.findFirst({
      where: { orgId: actor.orgId, searchRunId: run.id, contentUrl: url },
    });
    if (existing) return { signal: existing, created: false };

    const signal = await tx.supplierDiscoverySignal.create({
      data: {
        orgId: actor.orgId,
        projectId: projectId ?? run.projectId,
        tenderId: tenderId ?? run.tenderId,
        searchRunId: run.id,
        platform: input.platform,
        contentType: "POST",
        sourceOrigin: "PUBLIC_WEB",
        contentUrl: url,
        title: assertShortText(input.title, "标题"),
        description: input.description?.trim().slice(0, 500) || null,
        rawMetadataJson: {
          provider: "search-engine",
          sourceQuery: input.sourceQuery?.slice(0, 200) ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: projectId ?? run.projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_CREATED,
      targetType: SIGNAL_TARGET_TYPE,
      targetId: signal.id,
      afterData: { platform: signal.platform, sourceOrigin: "PUBLIC_WEB", searchRunId: run.id },
    });
    return { signal, created: true };
  });
}

export async function getSignal(actor: SupplierIntelActor, signalId: string) {
  // R1：先按最小归属元数据鉴权，再读正文/capability——授权前不返回受保护内容。
  // 本 org 内不存在 → 沿用既有契约返回 null（路由 404），不泄露存在性。
  const exists = await db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
    select: { id: true },
  });
  if (!exists) return null;
  await assertSignalAccess(actor, signalId, "read");

  return db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
    include: { capabilitySignals: true },
  });
}

/**
 * R1：列表与单条同口径——无权项目的信号不得出现在列表、筛选或计数里。
 * 项目可见性以「一次算出的可访问项目集合 + 关系过滤」实现（单条 SQL，零逐条鉴权）。
 */
export interface SignalListFilter {
  status?: string;
  platform?: string;
  /** 按治理项目筛选（含 Run 继承归属）；调用方须先断言该项目读权限 */
  projectId?: string;
  searchRunId?: string;
}

export interface SignalPageOptions extends SignalListFilter {
  take?: number;
  /** 稳定游标：上一页最后一行的 id（排序 discoveredAt desc, id desc） */
  cursor?: string | null;
}

/** S3-A：列表页大小上界（服务端有界分页，客户端不能放大） */
export const SIGNAL_PAGE_SIZE = { DEFAULT: 25, MAX: 100 } as const;

async function buildSignalWhere(
  actor: SupplierIntelActor,
  filter: SignalListFilter | undefined,
): Promise<Prisma.SupplierDiscoverySignalWhereInput> {
  // S3-A：按项目筛选前先断言该项目读权限（与 listProjectSearchRuns 同形的服务层门）。
  // 否则「筛选无权项目」只会静默返回空列表——与「该项目确实没有线索」不可区分，
  // 既不利于排障，也让越权探测变得无声无息。
  if (filter?.projectId) {
    await assertProjectAccessForActor(actor, filter.projectId, "read");
  }
  const scopeFilter = await buildSignalListScopeFilter(actor);
  const and = [...scopeFilter];
  if (filter?.projectId) and.push(buildSignalProjectFilter(filter.projectId, actor.orgId));
  return {
    orgId: actor.orgId,
    ...(filter?.status ? { status: filter.status } : {}),
    ...(filter?.platform ? { platform: filter.platform } : {}),
    ...(filter?.searchRunId ? { searchRunId: filter.searchRunId } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

export async function listSignals(
  actor: SupplierIntelActor,
  opts?: SignalListFilter & { take?: number },
) {
  return db.supplierDiscoverySignal.findMany({
    where: await buildSignalWhere(actor, opts),
    orderBy: [{ discoveredAt: "desc" }, { id: "desc" }],
    take: Math.min(opts?.take ?? 100, 200),
  });
}

/** R1：计数与列表共用同一可见性口径（避免「列表看不到但计数暴露」） */
export async function countSignals(actor: SupplierIntelActor, opts?: SignalListFilter) {
  return db.supplierDiscoverySignal.count({ where: await buildSignalWhere(actor, opts) });
}

/**
 * S3-A：收件箱分页读取——列表 + 总数 + 下一页游标，三者同一 where（同口径）。
 * 排序 (discoveredAt desc, id desc) 稳定；游标是上一页最后一行 id，避免 offset 抖动。
 * 注意：分页只影响**展示范围**，不影响身份裁决的扫描范围（B5 的穷尽扫描在 resolver 内独立进行）。
 */
export async function listSignalsPage(
  actor: SupplierIntelActor,
  opts?: SignalPageOptions,
): Promise<{
  signals: Awaited<ReturnType<typeof listSignals>>;
  total: number;
  nextCursor: string | null;
  pageSize: number;
}> {
  const where = await buildSignalWhere(actor, opts);
  const pageSize = Math.min(Math.max(opts?.take ?? SIGNAL_PAGE_SIZE.DEFAULT, 1), SIGNAL_PAGE_SIZE.MAX);
  const cursor = opts?.cursor?.trim() || null;
  const [rows, total] = await Promise.all([
    db.supplierDiscoverySignal.findMany({
      where,
      orderBy: [{ discoveredAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.supplierDiscoverySignal.count({ where }),
  ]);
  const hasMore = rows.length > pageSize;
  const signals = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    signals,
    total,
    nextCursor: hasMore ? (signals[signals.length - 1]?.id ?? null) : null,
    pageSize,
  };
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
  // R1：review / reject / link 都是业务写入——先按有效项目归属断言写权限
  await assertSignalAccess(actor, signalId, "write");
  return db.$transaction(async (tx) => {
    // S3-A §9B：锁内重读——与自动预填的追加路径互相串行，谁都不会用旧数组覆盖对方
    const signal = await lockSignalForWrite(tx, actor.orgId, signalId);
    assertSignalTransition(signal.status, to);

    const resolutionJson = resolutionEntry
      ? ([
          ...existingResolutionEntries(signal.resolutionJson),
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
  // R1：capability 挂靠 = 对该信号的业务写入，按其有效项目归属断言写权限
  await assertSignalAccess(actor, signal.id, "write");

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
