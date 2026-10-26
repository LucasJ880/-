/**
 * Revenue Spine — FDE V2 启动条件就绪度（B-6，openspec change fde-v2-readiness）
 *
 * 纯函数：任务书 §B-6 的启动条件（B-2 跑满 30 天、MOQ / 生产周期可引用、至少 3 个类目）逐条给出
 * 已满足 / 未满足 / 无法度量与一句依据，外加依据计数。只读、无 DB、无 LLM；也供 /revenue 区块（客户端）引用，
 * 所以本文件不 import 任何服务端模块（字段表与固定文案在测试里对照源码）。
 *
 * 脱敏：输入只有状态、计数与是否配置；输出不含 MOQ / 周期 / 最低毛利 / 金额等任何值。
 */

const DAY_MS = 86_400_000;

export const V2_READINESS_WINDOW_DAYS = 30;
/** 任务书：B-2 跑满 30 天 */
export const V2_RUNNING_DAYS_REQUIRED = 30;
/** 任务书：至少 3 个类目 */
export const V2_MIN_CATEGORIES = 3;
/** 读取上限（读满即标记） */
export const V2_PROPOSAL_LIMIT = 2000;
export const V2_APPLIED_AUDIT_LIMIT = 2000;
export const V2_SNAPSHOT_LIMIT = 300;

/** 与 fact-extract.ts FACT_FIELDS / FACT_FIELD_LABELS 一致（测试对照） */
export const V2_FACT_FIELDS = ["moq", "sampleLeadTime", "productionLeadTime", "loadingPorts", "signature", "catalogUrl"] as const;
export type V2FactField = (typeof V2_FACT_FIELDS)[number];
export const V2_FACT_FIELD_LABELS: Record<V2FactField, string> = {
  moq: "起订量",
  sampleLeadTime: "样品时效",
  productionLeadTime: "大货周期",
  loadingPorts: "装运港",
  signature: "落款",
  catalogUrl: "目录链接",
};

/** reply-draft.ts 首封"需内部确认"的固定文案（测试对照源码） */
export const PENDING_MOQ_LABELS: readonly string[] = ["MOQ"];
export const PENDING_LEAD_TIME_LABELS: readonly string[] = ["生产周期与交期", "production lead time and delivery schedule"];

export type ConditionKey = "fact_proposals_running" | "moq_available" | "production_lead_time_available" | "category_level_facts";
export type ConditionStatus = "met" | "not_met" | "not_measurable";

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  fact_proposals_running: `事实提案已运行满 ${V2_RUNNING_DAYS_REQUIRED} 天`,
  moq_available: "MOQ 已可引用",
  production_lead_time_available: "生产周期已可引用",
  category_level_facts: `至少 ${V2_MIN_CATEGORIES} 个类目的 MOQ / 生产周期`,
};

export const CONDITION_STATUS_LABELS: Record<ConditionStatus, string> = {
  met: "已满足",
  not_met: "未满足",
  not_measurable: "无法度量",
};

export interface ReadinessCondition {
  key: ConditionKey;
  label: string;
  status: ConditionStatus;
  detail: string;
}

export type ProposalBucket = "pending" | "applied" | "rejected" | "expired" | "other";

export interface FactProvenance {
  available: boolean;
  /** commercial_fact.applied 审计里该字段的条数 */
  appliedViaProposal: number;
  /** 可引用时：经提案写入过 → proposal；从未 → manual；不可引用 → null */
  source: "proposal" | "manual" | null;
}

export interface V2ReadinessInput {
  now: Date;
  firstProposalAt: Date | null;
  /** 近 30 天新建的事实提案（只取状态、有效期与字段） */
  proposals: ReadonlyArray<{ status: string; expiresAt: Date; field: string | null }>;
  proposalsTruncated: boolean;
  /** 写入审计（commercial_fact.applied）里的字段；解析不出为 null */
  appliedFields: ReadonlyArray<string | null>;
  appliedTruncated: boolean;
  /** 近 30 天草稿快照（只取跟进序号与待确认项），最多 V2_SNAPSHOT_LIMIT 条 */
  snapshots: ReadonlyArray<{ followUpStep: number | null; pendingInternalConfirmation: readonly string[] }>;
  snapshotsTruncated: boolean;
  /** 与草稿同一口径（factory-knowledge.ts）的可用状态 */
  knowledge: { moq: boolean; productionLeadTime: boolean; certification: boolean; costBasis: boolean; samplePolicy: boolean };
  minimumMarginConfigured: boolean;
  historicalQuotes: number;
  productCategories: number;
}

export interface V2ReadinessReport {
  generatedAt: string;
  windowDays: number;
  verdict: {
    meetsSuggestedConditions: boolean;
    summary: string;
    unmet: ConditionKey[];
    needsJudgement: ConditionKey[];
  };
  conditions: ReadinessCondition[];
  facts: { moq: FactProvenance; productionLeadTime: FactProvenance };
  proposals: {
    firstCreatedAt: string | null;
    runningDays: number | null;
    window: Record<ProposalBucket, number> & { created: number };
    byField: Array<{ field: V2FactField; label: string; created: number; applied: number; rejected: number }>;
    truncated: boolean;
    appliedAuditTruncated: boolean;
  };
  drafts: {
    firstReplies: number;
    pendingMoq: number;
    pendingMoqShare: number | null;
    pendingLeadTime: number;
    pendingLeadTimeShare: number | null;
    sampled: boolean;
    sampleLimit: number;
  };
  otherSources: {
    certificationAvailable: boolean;
    costBasisAvailable: boolean;
    samplePolicyConfigured: boolean;
    minimumMarginConfigured: boolean;
    historicalQuotes: number;
    productCategories: number;
  };
}

const isFactField = (f: string | null): f is V2FactField => f !== null && (V2_FACT_FIELDS as readonly string[]).includes(f);

/** PendingAction 状态 → 计数桶：executed 已写入；pending 过有效期即已过期；approved（认领中）/ failed 记其他 */
export function proposalBucket(p: { status: string; expiresAt: Date }, now: Date): ProposalBucket {
  if (p.status === "executed") return "applied";
  if (p.status === "rejected") return "rejected";
  if (p.status === "pending") return p.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
  return "other";
}

function provenance(available: boolean, applied: number): FactProvenance {
  return { available, appliedViaProposal: applied, source: available ? (applied > 0 ? "proposal" : "manual") : null };
}

function factDetail(name: string, p: FactProvenance, notConfigured: string): string {
  if (!p.available) return `${notConfigured}，首封草稿仍写"需内部确认"`;
  return p.source === "proposal" ? `草稿已能引用${name}（经提案写入过 ${p.appliedViaProposal} 次）` : `草稿已能引用${name}（手工配置，未经提案写入）`;
}

const share = (n: number, d: number) => (d > 0 ? n / d : null);

export function computeV2Readiness(input: V2ReadinessInput): V2ReadinessReport {
  const now = input.now;

  // 条件 1：第一张事实提案距今天数
  const runningDays = input.firstProposalAt ? Math.max(0, Math.floor((now.getTime() - input.firstProposalAt.getTime()) / DAY_MS)) : null;
  const running: ReadinessCondition = {
    key: "fact_proposals_running",
    label: CONDITION_LABELS.fact_proposals_running,
    status: runningDays !== null && runningDays >= V2_RUNNING_DAYS_REQUIRED ? "met" : "not_met",
    detail:
      runningDays === null
        ? "尚无事实提案"
        : runningDays >= V2_RUNNING_DAYS_REQUIRED
          ? `第一张事实提案在 ${runningDays} 天前创建`
          : `第一张事实提案在 ${runningDays} 天前创建，还差 ${V2_RUNNING_DAYS_REQUIRED - runningDays} 天`,
  };

  // 条件 2、3：与草稿同一口径的可引用；来源只作依据
  const appliedBy = (field: V2FactField) => input.appliedFields.filter((f) => f === field).length;
  const moq = provenance(input.knowledge.moq, appliedBy("moq"));
  const lead = provenance(input.knowledge.productionLeadTime, appliedBy("productionLeadTime"));
  const moqCondition: ReadinessCondition = {
    key: "moq_available",
    label: CONDITION_LABELS.moq_available,
    status: moq.available ? "met" : "not_met",
    detail: factDetail(" MOQ", moq, "MOQ 未配置"),
  };
  const leadCondition: ReadinessCondition = {
    key: "production_lead_time_available",
    label: CONDITION_LABELS.production_lead_time_available,
    status: lead.available ? "met" : "not_met",
    detail: factDetail("大货周期", lead, "大货周期未配置（只配样品时效不算）"),
  };

  // 条件 4：商务事实是组织级，固定无法度量
  const categories: ReadinessCondition = {
    key: "category_level_facts",
    label: CONDITION_LABELS.category_level_facts,
    status: "not_measurable",
    detail: `商务事实目前是组织级、不分类目，无法按类目度量；已配置产品类目 ${input.productCategories} 个，需人工判断`,
  };

  const conditions = [running, moqCondition, leadCondition, categories];
  const unmet = conditions.filter((x) => x.status === "not_met").map((x) => x.key);
  const needsJudgement = conditions.filter((x) => x.status === "not_measurable").map((x) => x.key);
  const meets = unmet.length === 0;
  const judgementNote = needsJudgement.map((k) => `「${CONDITION_LABELS[k]}」需人工判断`).join("；");
  const summary = meets
    ? `已达到任务书建议的启动条件（组织级口径）；${judgementNote}`
    : `未达到任务书建议的启动条件：${unmet.map((k) => CONDITION_LABELS[k]).join("、")}未满足；${judgementNote}`;

  // 提案计数
  const window: Record<ProposalBucket, number> & { created: number } = { created: 0, pending: 0, applied: 0, rejected: 0, expired: 0, other: 0 };
  const byField = new Map<V2FactField, { created: number; applied: number; rejected: number }>(V2_FACT_FIELDS.map((f) => [f, { created: 0, applied: 0, rejected: 0 }]));
  for (const p of input.proposals) {
    const bucket = proposalBucket(p, now);
    window.created++;
    window[bucket]++;
    if (!isFactField(p.field)) continue;
    const row = byField.get(p.field)!;
    row.created++;
    if (bucket === "applied") row.applied++;
    if (bucket === "rejected") row.rejected++;
  }

  // 首封草稿：只看 followUpStep 为空的快照
  const firsts = input.snapshots.filter((s) => s.followUpStep === null);
  const has = (s: { pendingInternalConfirmation: readonly string[] }, labels: readonly string[]) => s.pendingInternalConfirmation.some((p) => labels.includes(p));
  const pendingMoq = firsts.filter((s) => has(s, PENDING_MOQ_LABELS)).length;
  const pendingLeadTime = firsts.filter((s) => has(s, PENDING_LEAD_TIME_LABELS)).length;

  return {
    generatedAt: now.toISOString(),
    windowDays: V2_READINESS_WINDOW_DAYS,
    verdict: { meetsSuggestedConditions: meets, summary, unmet, needsJudgement },
    conditions,
    facts: { moq, productionLeadTime: lead },
    proposals: {
      firstCreatedAt: input.firstProposalAt ? input.firstProposalAt.toISOString() : null,
      runningDays,
      window,
      byField: V2_FACT_FIELDS.map((field) => ({ field, label: V2_FACT_FIELD_LABELS[field], ...byField.get(field)! })),
      truncated: input.proposalsTruncated,
      appliedAuditTruncated: input.appliedTruncated,
    },
    drafts: {
      firstReplies: firsts.length,
      pendingMoq,
      pendingMoqShare: share(pendingMoq, firsts.length),
      pendingLeadTime,
      pendingLeadTimeShare: share(pendingLeadTime, firsts.length),
      sampled: input.snapshotsTruncated,
      sampleLimit: V2_SNAPSHOT_LIMIT,
    },
    otherSources: {
      certificationAvailable: input.knowledge.certification,
      costBasisAvailable: input.knowledge.costBasis,
      samplePolicyConfigured: input.knowledge.samplePolicy,
      minimumMarginConfigured: input.minimumMarginConfigured,
      historicalQuotes: input.historicalQuotes,
      productCategories: input.productCategories,
    },
  };
}
