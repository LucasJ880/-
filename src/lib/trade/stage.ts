/**
 * TradeProspect.stage — 标准业务生命周期（与 researchStatus 分离）
 *
 * 写入后端时仅允许 TRADE_PROSPECT_STAGES；历史旧值通过 normalizeTradeProspectStage 兼容展示。
 */

export const TRADE_PROSPECT_STAGES = [
  "new",
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "replied",
  "quoted",
  "follow_up",
  "converted",
  "lost",
  "archived",
] as const;

export type TradeProspectStage = (typeof TRADE_PROSPECT_STAGES)[number];

/** 旧 CRM / 历史 stage → 标准值 */
const LEGACY_TO_STANDARD: Record<string, TradeProspectStage> = {
  new: "new",
  discovered: "discovered",
  researched: "researched",
  research_pending: "discovered",
  researching: "discovered",
  qualified: "qualified",
  unqualified: "lost",
  outreach_draft: "qualified",
  outreach_ready: "qualified",
  outreach_sent: "contacted",
  email_sent: "contacted",
  contacted: "contacted",
  replied: "replied",
  reply_received: "replied",
  interested: "follow_up",
  negotiating: "follow_up",
  no_response: "follow_up",
  follow_up: "follow_up",
  "follow-up": "follow_up",
  quoted: "quoted",
  quote_created: "quoted",
  quote_sent: "quoted",
  won: "converted",
  converted: "converted",
  lost: "lost",
  archived: "archived",
  unknown: "new",
};

/** 审计/迁移：已知可映射的旧 stage 键 */
export function tradeProspectLegacyStageKeys(): string[] {
  return Object.keys(LEGACY_TO_STANDARD);
}

const RANK: Record<TradeProspectStage, number> = {
  new: 0,
  discovered: 1,
  researched: 2,
  qualified: 3,
  contacted: 4,
  replied: 5,
  quoted: 6,
  follow_up: 7,
  converted: 8,
  lost: 8,
  archived: 9,
};

export const TRADE_PROSPECT_STAGE_LABELS: Record<TradeProspectStage, string> = {
  new: "新线索",
  discovered: "已发现",
  researched: "已研究",
  qualified: "合格",
  contacted: "已触达",
  replied: "已回复",
  quoted: "已报价",
  follow_up: "待跟进",
  converted: "已转化",
  lost: "已失效",
  archived: "已归档",
};

/** 驾驶舱 / 漏斗展示顺序（子集） */
export const TRADE_COCKPIT_FUNNEL_STAGES: TradeProspectStage[] = [
  "new",
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "replied",
  "quoted",
  "follow_up",
  "converted",
];

export const TRADE_PROSPECT_STAGE_COLORS: Record<TradeProspectStage, string> = {
  new: "bg-zinc-500/15 text-zinc-400",
  discovered: "bg-slate-500/15 text-slate-300",
  researched: "bg-blue-500/15 text-blue-400",
  qualified: "bg-emerald-500/15 text-emerald-400",
  contacted: "bg-violet-500/15 text-violet-400",
  replied: "bg-cyan-500/15 text-cyan-400",
  quoted: "bg-amber-500/15 text-amber-400",
  follow_up: "bg-orange-500/15 text-orange-400",
  converted: "bg-emerald-600/20 text-emerald-300",
  lost: "bg-red-500/15 text-red-400",
  archived: "bg-zinc-600/20 text-zinc-500",
};

export function normalizeTradeProspectStage(raw: string | null | undefined): TradeProspectStage {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "new";
  if ((TRADE_PROSPECT_STAGES as readonly string[]).includes(s)) return s as TradeProspectStage;
  return LEGACY_TO_STANDARD[s] ?? "new";
}

/** 库中存在但映射表未覆盖（应 backfill 或人工处理） */
export function isUnrecognizedTradeProspectStage(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if ((TRADE_PROSPECT_STAGES as readonly string[]).includes(low)) return false;
  return LEGACY_TO_STANDARD[low] === undefined;
}

export function isTradeProspectStage(s: string): s is TradeProspectStage {
  return (TRADE_PROSPECT_STAGES as readonly string[]).includes(s);
}

export function getTradeProspectStageLabel(raw: string | null | undefined): string {
  if (isUnrecognizedTradeProspectStage(raw)) return "Unknown";
  return TRADE_PROSPECT_STAGE_LABELS[normalizeTradeProspectStage(raw)];
}

export function getTradeProspectStageTone(raw: string | null | undefined): string {
  if (isUnrecognizedTradeProspectStage(raw)) return TRADE_PROSPECT_STAGE_COLORS.new;
  return TRADE_PROSPECT_STAGE_COLORS[normalizeTradeProspectStage(raw)];
}

export const TRADE_PROSPECT_STAGE_OPTIONS: { value: TradeProspectStage; label: string }[] =
  TRADE_PROSPECT_STAGES.map((value) => ({ value, label: TRADE_PROSPECT_STAGE_LABELS[value] }));

/** PATCH / 表单：仅接受标准字符串 */
export function parseStrictTradeProspectStage(raw: unknown):
  | { ok: true; stage: TradeProspectStage }
  | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "stage 必须为字符串" };
  }
  const t = raw.trim();
  if (!isTradeProspectStage(t)) {
    return { ok: false, error: `无效 stage「${t}」，请使用标准阶段值` };
  }
  return { ok: true, stage: t };
}

function rankOf(s: TradeProspectStage): number {
  return RANK[s] ?? 0;
}

/**
 * 研究打分结束后推进 stage（不覆盖已触达及之后阶段；不因重研究把 researched+ 打回 lost）
 * 成功：new/discovered → researched；已 researched/qualified 保持；已 contacted+ 不倒退。
 * 未通过：仅 new/discovered 记为 lost；researched+ 且未触达保持原阶段。
 */
export function stageAfterResearchScore(current: string, passed: boolean): TradeProspectStage {
  const cur = normalizeTradeProspectStage(current);
  if (cur === "lost" || cur === "archived") return cur;
  if (rankOf(cur) >= rankOf("contacted")) return cur;
  if (!passed) {
    if (cur === "new" || cur === "discovered") return "lost";
    return cur;
  }
  if (rankOf(cur) >= rankOf("qualified")) return cur;
  return "researched";
}

export function stageAfterQuoteCreated(current: string): TradeProspectStage {
  const cur = normalizeTradeProspectStage(current);
  if (cur === "lost" || cur === "archived") return cur;
  if (rankOf(cur) >= rankOf("quoted")) return cur;
  return "quoted";
}

/** 首次外联发送后至少为 contacted，不降级更高阶段 */
export function stageAtLeastContacted(current: string): TradeProspectStage {
  const cur = normalizeTradeProspectStage(current);
  if (rankOf(cur) >= rankOf("contacted")) return cur;
  return "contacted";
}

/** groupBy 结果合并为按标准 stage 计数 */
export function mergeNormalizedProspectStageCounts(
  rows: { stage: string; _count: number | { id?: number; _all?: number } }[],
): Record<TradeProspectStage, number> {
  const out = Object.fromEntries(TRADE_PROSPECT_STAGES.map((s) => [s, 0])) as Record<TradeProspectStage, number>;
  for (const r of rows) {
    const c =
      typeof r._count === "number"
        ? r._count
        : (r._count as { id?: number; _all?: number }).id ??
          (r._count as { id?: number; _all?: number })._all ??
          0;
    const n = normalizeTradeProspectStage(r.stage);
    out[n] += c;
  }
  return out;
}

/** 跟进日程等：排除未启动与终态 */
export const TRADE_PROSPECT_SCHEDULABLE_NOT_IN: TradeProspectStage[] = ["new", "discovered", "lost", "archived"];

/** Prisma where：秘书「已排期跟进」排除（标准终态 + 历史 stage 字符串） */
export const TRADE_DB_STAGES_SCHEDULED_FOLLOWUP_EXCLUDE = [
  "new",
  "discovered",
  "lost",
  "archived",
  "converted",
  "unqualified",
  "won",
  "no_response",
] as const;

/** 已触达（发信后），含历史 DB 值 */
export const TRADE_DB_STAGES_CONTACTED_OR_LATER = [
  "contacted",
  "replied",
  "quoted",
  "follow_up",
  "converted",
  "lost",
  "archived",
  "outreach_sent",
  "email_sent",
  "interested",
  "negotiating",
  "no_response",
  "won",
] as const;

/** 视为已产生回复兴趣类 stage（含历史） */
export const TRADE_DB_STAGES_REPLIED_LIKE = [
  "replied",
  "quoted",
  "follow_up",
  "converted",
  "interested",
  "negotiating",
  "won",
] as const;

/** 已成交类（标准 + 历史 won） */
export const TRADE_DB_STAGES_WON_LIKE = ["converted", "won"] as const;

/** 发信后长期无回复类（用于二次触达提示） */
export const TRADE_DB_STAGES_NO_REPLY_TOUCH = ["contacted", "outreach_sent", "follow_up", "no_response"] as const;
