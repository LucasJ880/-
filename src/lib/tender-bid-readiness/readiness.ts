/**
 * TI-3b 可投标判定（纯函数，只读）
 *
 * 把截标窗口、价格表结构、逐行成本、关税依据、尺寸对照、强制认证、补遗失效汇成一份阻断项清单。
 * 两个结果：不可投标 / 可提交 Owner 决定。后者不是批准，也不代表可以直接投标——
 * 本模块不记录批准、不触发提交、不做任何对外动作。可投标是推导出的判定，不是新的流程状态。
 */
import { deriveTenderWindowState, parseClosingTime, type SubmissionRecord } from "@/lib/tender-price-schedule/closing-time";
import { validatePriceSchedule, type PriceScheduleLine } from "@/lib/tender-price-schedule/contract";
import type { DimensionVerdict } from "@/lib/tender-price-schedule/dimension-match";
import { evaluateCertificationGate, type CertificateEvidence, type ProposedProduct } from "./certification-gate";
import { findStaleConclusions, type Addendum, type DependentConclusion } from "./staleness";

export type ReadinessBlockerCode =
  | "CLOSING_TIME_INVALID" | "WINDOW_EXPIRED" | "SCHEDULE_INVALID" | "COST_MISSING" | "COST_INCOMPLETE"
  | "DUTY_UNVERIFIED" | "DIMENSION_MISMATCH" | "DIMENSION_UNKNOWN" | "CERTIFICATION_BLOCKED" | "STALE_AFTER_ADDENDUM";
export type ReadinessBlocker = { code: ReadinessBlockerCode; lineNo: number | null; messageZh: string };
export type ReadinessWarning = { code: "INDICATIVE_PRICE" | "ALREADY_SUBMITTED"; messageZh: string };

/** 成本情景里判定要用到的部分（与 TI-2 的 ScenarioResult 结构兼容）。 */
export type CostReadinessInput = {
  lines: ReadonlyArray<{ lineNo: number; complete: boolean; blockers?: ReadonlyArray<{ messageZh: string }> }>;
  flags: { incomplete: boolean; hasSensitivityDuty: boolean; hasIndicativePrice: boolean };
};

export type ReadinessInput = {
  now: Date;
  closingAt: string | null;
  submission?: SubmissionRecord | null;
  lines: readonly PriceScheduleLine[];
  cost?: CostReadinessInput | null;
  dimensionChecks?: ReadonlyArray<{ lineNo: number; verdict: DimensionVerdict; reasonZh?: string }>;
  products?: Readonly<Record<number, ProposedProduct | undefined>>;
  certificates?: Readonly<Record<number, readonly CertificateEvidence[] | undefined>>;
  addenda?: readonly Addendum[];
  conclusions?: readonly DependentConclusion[];
};

export const READINESS_STATES = ["NOT_READY", "READY_FOR_OWNER_DECISION"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export type ReadinessAssessment = {
  state: ReadinessState;
  stateZh: string;
  blockers: ReadinessBlocker[];
  warnings: ReadinessWarning[];
  summaryZh: string;
};

export function assessBidReadiness(input: ReadinessInput): ReadinessAssessment {
  const blockers: ReadinessBlocker[] = [];
  const warnings: ReadinessWarning[] = [];
  const add = (code: ReadinessBlockerCode, lineNo: number | null, messageZh: string) => blockers.push({ code, lineNo, messageZh });

  // 1. 截标窗口
  const closing = parseClosingTime(input.closingAt);
  if (!closing.ok) add("CLOSING_TIME_INVALID", null, `截标时间不可用：${closing.messageZh}`);
  else {
    const window = deriveTenderWindowState({ closingAt: closing.closingAt, now: input.now, submission: input.submission });
    if (window === "EXPIRED") add("WINDOW_EXPIRED", null, "已过截标，且没有带回执的提交记录");
    if (window === "SUBMITTED") warnings.push({ code: "ALREADY_SUBMITTED", messageZh: "已有带回执的提交记录；本判定仅供复盘" });
  }

  // 2. 价格表结构
  const schedule = validatePriceSchedule(input.lines);
  if (!schedule.valid) add("SCHEDULE_INVALID", null, `价格表行项结构有 ${schedule.issues.length} 处问题：${schedule.issues.slice(0, 3).map((i) => i.messageZh).join("；")}`);

  // 3. 逐行成本
  if (!input.cost) add("COST_MISSING", null, "还没有成本核算");
  else {
    for (const line of input.lines) {
      const c = input.cost.lines.find((l) => l.lineNo === line.lineNo);
      if (!c) add("COST_INCOMPLETE", line.lineNo, `第 ${line.lineNo} 行没有成本`);
      else if (!c.complete) add("COST_INCOMPLETE", line.lineNo, `第 ${line.lineNo} 行成本为空：${(c.blockers ?? []).map((b) => b.messageZh).join("、") || "缺参数"}`);
    }
    if (input.cost.flags.hasSensitivityDuty) add("DUTY_UNVERIFIED", null, "成本含未核实的关税假设：HS 编码、原产地、来源、日期未齐");
    if (input.cost.flags.hasIndicativePrice) warnings.push({ code: "INDICATIVE_PRICE", messageZh: "成本含指示性价格（平台标价、零售价或估计），不是已签报价" });
  }

  // 4. 尺寸对照：有尺寸要求的行必须核对过且相符；无法判断不算相符
  for (const line of input.lines) {
    if (!line.dimensions && !line.minimumDimensions) continue;
    const check = (input.dimensionChecks ?? []).find((d) => d.lineNo === line.lineNo);
    if (!check) add("DIMENSION_UNKNOWN", line.lineNo, `第 ${line.lineNo} 行尺寸尚未核对`);
    else if (check.verdict === "MISMATCH") add("DIMENSION_MISMATCH", line.lineNo, `第 ${line.lineNo} 行尺寸不符${check.reasonZh ? `：${check.reasonZh}` : ""}`);
    else if (check.verdict === "UNKNOWN") add("DIMENSION_UNKNOWN", line.lineNo, `第 ${line.lineNo} 行尺寸无法判断${check.reasonZh ? `：${check.reasonZh}` : ""}`);
  }

  // 5. 强制认证闸
  for (const line of input.lines) {
    const gate = evaluateCertificationGate({
      lineNo: line.lineNo, certificationGate: line.certificationGate, product: input.products?.[line.lineNo],
      certificates: input.certificates?.[line.lineNo], now: input.now,
    });
    if (gate.verdict === "BLOCKED") add("CERTIFICATION_BLOCKED", line.lineNo, `第 ${line.lineNo} 行强制认证未过：${gate.reasons.map((r) => r.messageZh).join("；")}`);
  }

  // 6. 补遗后待复核的结论
  for (const s of findStaleConclusions(input.addenda ?? [], input.conclusions ?? []).stale) add("STALE_AFTER_ADDENDUM", s.lineNo, s.reasonZh);

  const ready = blockers.length === 0;
  return {
    state: ready ? "READY_FOR_OWNER_DECISION" : "NOT_READY",
    stateZh: ready ? "可提交 Owner 决定" : "不可投标",
    blockers,
    warnings,
    summaryZh: ready
      ? "没有阻断项，可提交 Owner 决定。这不是批准，也不代表可以直接投标。"
      : `不可投标：${blockers.length} 个阻断项。`,
  };
}
