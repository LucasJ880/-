/**
 * S4-A：评估工作台的文案映射（纯函数，无 DB / 无 React，客户端与服务端共用）。
 *
 * 纪律：
 *   - 只有四种判定词：满足 / 部分满足 / 不满足 / 资料不足；
 *   - 谁判的必须可见：人工确认 / AI 辅助判断 / 规则判断——AI 辅助**不**显示成「系统已确认」；
 *   - 硬门只有三种结果外加「未计算」，原因码逐条翻译；
 *   - 页面允许出现的推荐词只有 NOT_ELIGIBLE / NEEDS_VERIFICATION 的中文，
 *     没有分数、排名、PRIMARY / BACKUP / HIGH_RISK。
 */

import { readRunMode, type MandatoryGateReasonCode } from "./constants";
import type { LabelWithTone } from "./workspace-labels";

export function isEvaluationOnlyRun(run: { sourceConfigJson: unknown }): boolean {
  return readRunMode(run.sourceConfigJson) === "EVALUATION_ONLY";
}

/** 评估运行的状态文案——不能借用搜索的「搜索已结束 / 外部来源成功」 */
export function evaluationRunOutcome(status: string): LabelWithTone {
  switch (status) {
    case "PLANNED": return { label: "评估待开始", tone: "neutral", hint: null };
    case "RUNNING": return { label: "评估进行中", tone: "info", hint: "逐条判定后计算强制项，再完成评估" };
    case "COMPLETED": return { label: "评估已完成", tone: "success", hint: "结果已冻结；改判请新建评估" };
    case "FAILED": return { label: "评估未完成", tone: "danger", hint: "评估中途失败，不显示最终结论" };
    case "CANCELLED": return { label: "评估已取消", tone: "neutral", hint: null };
    default: return { label: status, tone: "neutral", hint: null };
  }
}

export function matchVerdictDisplay(verdict: string): LabelWithTone {
  switch (verdict) {
    case "PASS": return { label: "满足", tone: "success", hint: null };
    case "PARTIAL": return { label: "部分满足", tone: "warning", hint: "有部分支持，但还不能证明完整满足" };
    case "FAIL": return { label: "不满足", tone: "danger", hint: null };
    case "UNKNOWN": return { label: "资料不足", tone: "neutral", hint: "资料待补，无法判定" };
    default: return { label: verdict, tone: "neutral", hint: null };
  }
}

export function evaluatedByLabel(v: string): string {
  switch (v) {
    case "HUMAN": return "人工确认";
    case "AI_ASSISTED": return "AI 辅助判断";
    case "DETERMINISTIC": return "规则判断";
    default: return v;
  }
}

export function gateResultDisplay(result: string): LabelWithTone {
  switch (result) {
    case "PASS": return { label: "强制项：已通过", tone: "success", hint: "所有强制要求都有可采信证据支撑" };
    case "FAIL": return { label: "强制项：不通过", tone: "danger", hint: "本供应商当前不可进入推荐候选" };
    case "INCOMPLETE": return { label: "强制项：资料不足 / 待核实", tone: "warning", hint: "有强制要求还没有可采信的判定" };
    case "PENDING": return { label: "强制项：未计算", tone: "neutral", hint: null };
    default: return { label: result, tone: "neutral", hint: null };
  }
}

export function recommendationDisplay(rec: string | null): LabelWithTone | null {
  switch (rec) {
    case "NOT_ELIGIBLE": return { label: "不可进入推荐候选", tone: "danger", hint: "强制项不通过；无论价格多低都不能推荐" };
    case "NEEDS_VERIFICATION": return { label: "待核实", tone: "warning", hint: "强制项或评分证据不完整；补齐后新建评估" };
    case "HIGH_RISK": return { label: "重大风险", tone: "danger", hint: "四维齐全但进口准备度或履约可靠性低于阈值；不进入当前推荐" };
    default: return null; // PASS 且可排名：候选自身不写 PRIMARY / BACKUP，由项目级当前推荐动态派生
  }
}

/* ───────────────── S4-B：评分 / 价格证据 / 赛马 / 当前推荐 ───────────────── */

export const SCORE_COMPONENT_LABELS: Record<"technical" | "commercial" | "reliability" | "importRisk", { label: string; weightLabel: string }> = {
  technical: { label: "技术匹配", weightLabel: "40%" },
  commercial: { label: "商务", weightLabel: "25%" },
  reliability: { label: "履约可靠性", weightLabel: "20%" },
  importRisk: { label: "进口与交付准备度", weightLabel: "15%" },
};

const SCORE_REASON_TEXT: Record<string, string> = {
  GATE_FAIL: "强制项不通过：不计算正式评分",
  GATE_INCOMPLETE: "强制项资料不足：没有正式总分",
  UNMAPPED_REQUIREMENT_CATEGORY: "有要求的类别不在技术计分词表内（未静默计分）",
  TECHNICAL_NO_SCORABLE_REQUIREMENTS: "本项目没有可计分的技术要求",
  TECHNICAL_AI_ASSISTED_UNCONFIRMED: "AI 辅助判定未经人工确认，按 0 计",
  COMMERCIAL_NO_CONFIRMED_RFQ: "本项目尚无该供应商的正式报价（待询价确认）",
  COMMERCIAL_SINGLE_QUOTE: "同一询价轮只有一家正式报价，无法比较",
  COMMERCIAL_NOT_COMPARABLE_CURRENCY: "同轮报价币种不一致，不做汇率猜测",
  COMMERCIAL_NOT_COMPARABLE_PRICE_BASIS: "同轮报价单价 / 总价口径不一致，不混比",
  COMMERCIAL_PLATFORM_LISTED_ONLY: "只有平台挂牌价，不进入正式商务评分",
  DELIVERY_UNKNOWN: "交期未知，交期竞争力按 0 计",
  RELIABILITY_HISTORY_INSUFFICIENT: "内部真实询价历史不足 2 条，履约可靠性待验证",
  EXPORT_READINESS_UNVERIFIED: "没有已核验的出口能力证据，进口准备度待核实",
  EXPORT_CLAIMED_ONLY: "出口能力只是声称 / 观察到，尚未核验",
  OFFICIAL_TOTAL_INCOMPLETE: "有维度待核实，不给正式总分",
  HIGH_RISK_IMPORT: "进口准备度低于阈值",
  HIGH_RISK_RELIABILITY: "履约可靠性低于阈值",
};
export function scoreReasonText(code: string): string {
  return SCORE_REASON_TEXT[code] ?? code;
}

export function priceEvidenceTierDisplay(tier: string | null): LabelWithTone {
  switch (tier) {
    case "RFQ_CONFIRMED": return { label: "正式报价", tone: "success", hint: "来源：本项目询价轮的正式回复；覆盖挂牌价作为评分依据" };
    case "INQUIRY_CONFIRMED": return { label: "询价确认价", tone: "info", hint: "来自询价渠道登记的报盘；项目级正式报价优先" };
    case "HUMAN_ENTERED": return { label: "人工录入价", tone: "neutral", hint: "采购人员手工登记，不进入正式商务评分" };
    case "PLATFORM_LISTED": return { label: "平台挂牌价 / 待询价确认", tone: "warning", hint: "1688 等平台页面价格，不进入正式商务评分" };
    case "ESTIMATED": return { label: "估算价", tone: "neutral", hint: "不进入正式商务评分" };
    default: return { label: "价格未知", tone: "neutral", hint: null };
  }
}

export function rankingSectionDisplay(section: string): LabelWithTone {
  switch (section) {
    case "PRIMARY": return { label: "PRIMARY · 当前首选", tone: "success", hint: "按最新完成评估动态计算，不是历史记录" };
    case "BACKUP": return { label: "BACKUP · 备选", tone: "info", hint: null };
    case "NEEDS_VERIFICATION": return { label: "待核实", tone: "warning", hint: "证据不完整，不进入排名" };
    case "HIGH_RISK": return { label: "重大风险", tone: "danger", hint: "不进入排名" };
    case "NOT_ELIGIBLE": return { label: "不可进入推荐候选", tone: "danger", hint: "强制项不通过" };
    default: return { label: section, tone: "neutral", hint: null };
  }
}

export function racingStateDisplay(state: string): LabelWithTone {
  switch (state) {
    case "FOUND": return { label: "已发现", tone: "neutral", hint: null };
    case "LINKED": return { label: "已关联", tone: "neutral", hint: null };
    case "OFFERING_READY": return { label: "已登记产品", tone: "neutral", hint: null };
    case "EVIDENCE_READY": return { label: "已有核验证据", tone: "info", hint: null };
    case "GATE_PASS": return { label: "强制项已通过", tone: "info", hint: null };
    case "RFQ_CONFIRMED": return { label: "已正式报价", tone: "info", hint: null };
    case "SCORED": return { label: "已正式评分", tone: "success", hint: null };
    case "NEEDS_VERIFICATION": return { label: "待核实", tone: "warning", hint: null };
    case "NOT_ELIGIBLE": return { label: "不可进入推荐候选", tone: "danger", hint: null };
    case "HIGH_RISK": return { label: "重大风险", tone: "danger", hint: null };
    default: return { label: state, tone: "neutral", hint: null };
  }
}

export function rfqStateLabel(rfq: string): string {
  return rfq === "CONFIRMED" ? "已报价" : rfq === "SENT" ? "已询价待回复" : "待询价";
}

const REASON_TEXT: Record<MandatoryGateReasonCode, string> = {
  OK: "已满足，证据可采信",
  MANDATORY_MATCH_FAIL: "已有证据证明不满足",
  MANDATORY_MATCH_MISSING: "尚未判定",
  MANDATORY_MATCH_UNKNOWN: "资料不足，无法判定",
  MANDATORY_MATCH_PARTIAL: "只是部分满足，不能算通过",
  MANDATORY_STATUS_UNCERTAIN: "该要求是否强制尚待澄清；在招标分析确认前按强制处理",
  EVIDENCE_NOT_VERIFIED: "证据不足以支撑硬门（社媒 / 官网 / 备注单独不算）",
  AI_ASSISTED_NOT_ADMISSIBLE: "AI 辅助判断不能独立作为硬门依据，需人工确认",
  CERT_NOT_VERIFIED: "证书只是厂家声称，未独立核验",
  CERT_EXPIRED_AT_EVALUATION: "证书在评估当时已过期",
  CERT_NOT_YET_VALID_AT_EVALUATION: "证书在评估当时尚未生效（生效日晚于评估时刻）",
  CERT_SCOPE_MISMATCH: "证书范围不覆盖候选产品",
  CERT_TYPE_MISMATCH: "证书类型与要求点名的认证不符",
  OFFERING_REQUIRED: "这是产品级要求，需要选定具体产品才能判定",
  NOT_MANDATORY: "非强制要求",
};
export function gateReasonText(code: string): string {
  return (REASON_TEXT as Record<string, string>)[code] ?? code;
}

export function mandatoryLabel(m: true | false | "uncertain"): LabelWithTone {
  if (m === true) return { label: "强制要求", tone: "danger", hint: null };
  if (m === "uncertain") return { label: "强制性待确认", tone: "warning", hint: "在招标分析确认前按强制处理" };
  return { label: "非强制要求", tone: "neutral", hint: null };
}

export function originSourceLabel(origin: string): string {
  return ({ MEMORY: "企业记忆", HISTORICAL_SUCCESS: "历史合作", SAVED: "已存供应商", EXTERNAL_SEARCH: "外部搜索", NEW_DISCOVERY: "已关联线索" } as Record<string, string>)[origin] ?? origin;
}
