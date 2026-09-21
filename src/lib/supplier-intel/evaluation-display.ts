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
    case "NEEDS_VERIFICATION": return { label: "待核实", tone: "warning", hint: "强制项资料不足；补齐证据后新建评估" };
    default: return null; // PASS 时本轮不给最终推荐（S4-B 评分阶段的事）
  }
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
