/**
 * Revenue Spine — canonical opportunity lifecycle（Mengxin FDE V1）
 *
 * SalesOpportunity.stage 的唯一合法词表（OEM 商业主干）。
 * - 业务代码禁止散写任意字符串；写入必须经 transitionOpportunity()（transition.ts）。
 * - Sunny 窗饰车道的历史 stage（new_lead…completed）仍被允许存在，通过 LEGACY_STAGE_MAP
 *   投影到本词表做报表；本轮不迁移 Sunny 数据。
 */

export const OPPORTUNITY_STAGES = [
  "new_inquiry",
  "enriching",
  "needs_info",
  "qualified",
  "rfq_ready",
  "quoting",
  "quoted",
  "follow_up",
  "sample",
  "negotiation",
  "won",
  "lost",
  "nurture",
  "stale",
  "disqualified",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** 常量对象：业务代码用 OpportunityStage.WON 而非字符串字面量 */
export const OpportunityStage = {
  NEW_INQUIRY: "new_inquiry",
  ENRICHING: "enriching",
  NEEDS_INFO: "needs_info",
  QUALIFIED: "qualified",
  RFQ_READY: "rfq_ready",
  QUOTING: "quoting",
  QUOTED: "quoted",
  FOLLOW_UP: "follow_up",
  SAMPLE: "sample",
  NEGOTIATION: "negotiation",
  WON: "won",
  LOST: "lost",
  NURTURE: "nurture",
  STALE: "stale",
  DISQUALIFIED: "disqualified",
} as const satisfies Record<string, OpportunityStage>;

/** 终态：不可再推进（won/lost/disqualified）；lost 允许进入 nurture 复活 */
export const TERMINAL_STAGES: readonly OpportunityStage[] = ["won", "lost", "disqualified"];
/** 停放态：暂不推进但可复活 */
export const PARKED_STAGES: readonly OpportunityStage[] = ["nurture", "stale"];
/** 开放态：进入日常收入队列与 pipeline 统计 */
export const OPEN_STAGES: readonly OpportunityStage[] = [
  "new_inquiry",
  "enriching",
  "needs_info",
  "qualified",
  "rfq_ready",
  "quoting",
  "quoted",
  "follow_up",
  "sample",
  "negotiation",
];
/** 报价前阶段（新询盘再次来信视为补充信息而非新商机） */
export const PRE_QUOTE_STAGES: readonly OpportunityStage[] = [
  "new_inquiry",
  "enriching",
  "needs_info",
  "qualified",
  "rfq_ready",
  "quoting",
];
/** 合格 pipeline（Qualified Pipeline 指标口径） */
export const QUALIFIED_PIPELINE_STAGES: readonly OpportunityStage[] = [
  "qualified",
  "rfq_ready",
  "quoting",
  "quoted",
  "follow_up",
  "sample",
  "negotiation",
];

/** 任何开放态都可走的旁路（丢单 / 培育 / 搁置 / 不合格） */
const EXIT_STAGES: readonly OpportunityStage[] = ["lost", "nurture", "stale", "disqualified"];

export const ALLOWED_TRANSITIONS: Record<OpportunityStage, readonly OpportunityStage[]> = {
  new_inquiry: ["enriching", ...EXIT_STAGES],
  enriching: ["needs_info", "qualified", "disqualified", "lost", "nurture", "stale"],
  needs_info: ["qualified", "rfq_ready", ...EXIT_STAGES],
  qualified: ["rfq_ready", "needs_info", ...EXIT_STAGES],
  rfq_ready: ["quoting", "needs_info", ...EXIT_STAGES],
  quoting: ["quoted", "needs_info", ...EXIT_STAGES],
  quoted: ["follow_up", "sample", "negotiation", "lost", "nurture", "stale"],
  follow_up: ["sample", "negotiation", "quoted", "won", "lost", "nurture", "stale"],
  sample: ["negotiation", "follow_up", "quoted", "won", "lost", "nurture", "stale"],
  negotiation: ["won", "lost", "sample", "follow_up", "nurture", "stale"],
  won: [],
  lost: ["nurture"],
  nurture: ["qualified", "rfq_ready", "follow_up", "negotiation", "lost", "stale"],
  stale: ["qualified", "follow_up", "negotiation", "nurture", "lost", "disqualified"],
  disqualified: ["nurture"],
};

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

export function isOpenStage(stage: string): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

export function isTerminalStage(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function canTransition(from: OpportunityStage, to: OpportunityStage): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class OpportunityTransitionError extends Error {
  readonly code = "INVALID_STAGE_TRANSITION";
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`不允许的阶段流转：${from} → ${to}`);
    this.name = "OpportunityTransitionError";
  }
}

export function assertTransition(from: OpportunityStage, to: OpportunityStage): void {
  if (!canTransition(from, to)) throw new OpportunityTransitionError(from, to);
}

/** Sunny 窗饰车道历史 stage → canonical 投影（仅报表/兼容，不回写） */
export const LEGACY_STAGE_MAP: Record<string, OpportunityStage> = {
  new_lead: "new_inquiry",
  needs_confirmed: "qualified",
  measure_booked: "rfq_ready",
  quoted: "quoted",
  negotiation: "negotiation",
  signed: "won",
  producing: "won",
  installing: "won",
  completed: "won",
  lost: "lost",
  on_hold: "nurture",
};

/** canonical → 自身；legacy → 投影；未知 → null */
export function toCanonicalStage(raw: string | null | undefined): OpportunityStage | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (isOpportunityStage(s)) return s;
  return LEGACY_STAGE_MAP[s] ?? null;
}

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, { zh: string; en: string }> = {
  new_inquiry: { zh: "新询盘", en: "New inquiry" },
  enriching: { zh: "补全中", en: "Enriching" },
  needs_info: { zh: "待补信息", en: "Needs info" },
  qualified: { zh: "已合格", en: "Qualified" },
  rfq_ready: { zh: "RFQ 就绪", en: "RFQ ready" },
  quoting: { zh: "报价中", en: "Quoting" },
  quoted: { zh: "已报价", en: "Quoted" },
  follow_up: { zh: "跟进中", en: "Follow-up" },
  sample: { zh: "打样", en: "Sample" },
  negotiation: { zh: "谈判", en: "Negotiation" },
  won: { zh: "成交", en: "Won" },
  lost: { zh: "丢单", en: "Lost" },
  nurture: { zh: "培育", en: "Nurture" },
  stale: { zh: "搁置", en: "Stale" },
  disqualified: { zh: "不合格", en: "Disqualified" },
};

export function getOpportunityStageLabel(stage: string, lang: "zh" | "en" = "zh"): string {
  const c = toCanonicalStage(stage);
  if (!c) return stage;
  return OPPORTUNITY_STAGE_LABELS[c][lang];
}
