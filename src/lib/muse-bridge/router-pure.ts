/**
 * Muse Bridge — 纯路由逻辑（零 DB / 零 LLM / 零出站）
 *
 * 所有"把青砚内部状态翻译成 Muse 能转述的一句话"的逻辑都在这里，便于离线测试。
 * router.ts 只负责取数和调用现有服务，然后交给本文件格式化。
 */

import {
  MUSE_BRIDGE_CONTRACT_VERSION,
  MUSE_INTENT_PHASE,
  containsOutboundSensitive,
  type MuseCommandArgs,
  type MuseCommandResponse,
  type MuseErrorCode,
  type MuseIntent,
  type MuseSuggestedAction,
} from "./contract";
import { getProjectStage, resolveCloseDate } from "@/lib/tender/stage";
import type { CompareMatrix, MusePricingView } from "@/lib/tender-rfq/compare";
import type { TenderProject } from "@/lib/tender/types";

// ── 响应构造 ────────────────────────────────────────────────────

export function okResponse(
  requestId: string,
  message: string,
  extra?: { data?: unknown; suggestedActions?: MuseSuggestedAction[] },
): MuseCommandResponse {
  return {
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    requestId,
    ok: true,
    message: sanitizeOutbound(message),
    data: extra?.data,
    suggestedActions: (extra?.suggestedActions ?? []).slice(0, 4),
  };
}

export function errResponse(
  requestId: string,
  errorCode: MuseErrorCode,
  message: string,
  extra?: { availableInPhase?: number; suggestedActions?: MuseSuggestedAction[] },
): MuseCommandResponse {
  return {
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    requestId,
    ok: false,
    message: sanitizeOutbound(message),
    suggestedActions: (extra?.suggestedActions ?? []).slice(0, 4),
    errorCode,
    availableInPhase: extra?.availableInPhase,
  };
}

/** 出站脱敏：命中敏感字段 → 整段替换，而不是尝试"抠掉一部分"。 */
export const OUTBOUND_REDACTED = "（该内容包含内部财务信息，不通过 Muse 通道输出，请在青砚内查看。）";

/** 出站脱敏：命中敏感词整段替换。strict 用于 compare / price_scenario（另拦"成本 / 利润"）。 */
export function sanitizeOutbound(text: string, opts: { strict?: boolean } = {}): string {
  const t = text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
  return containsOutboundSensitive(t, opts) ? OUTBOUND_REDACTED : t;
}

/** 未启用意图的统一回复（诚实告知阶段）。 */
export function notEnabledResponse(requestId: string, intent: MuseIntent): MuseCommandResponse {
  const phase = MUSE_INTENT_PHASE[intent];
  const label: Record<MuseIntent, string> = {
    status: "查看状态",
    ask: "基于证据问答",
    approve: "批准",
    reject: "驳回",
    follow_tender: "跟进新标（标讯雷达）",
    rfq: "生成并发送询价",
    chase: "催单",
    compare: "比价",
    price_scenario: "定价情景",
  };
  return errResponse(
    requestId,
    "INTENT_NOT_ENABLED",
    `「${label[intent]}」这个动作当前还没在 Muse 通道开放（属于 Phase ${phase}），请先在青砚里操作。`,
    { availableInPhase: phase },
  );
}

// ── status ──────────────────────────────────────────────────────

export type StatusProjectRow = TenderProject & {
  id: string;
  name: string;
  /** 最新分析状态（TenderAnalysisRun.status），无则 null */
  analysisStatus: string | null;
  /** 待办审批数（该用户可见） */
  pendingApprovals: number;
};

const STAGE_LABEL: Record<string, string> = {
  initiation: "立项",
  distribution: "分发",
  interpretation: "解读",
  supplier_inquiry: "询价",
  supplier_quote: "报价",
  submission: "提交",
};

const ANALYSIS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  EXTRACTING: "解析中",
  ANALYZING: "分析中",
  REVIEW_REQUIRED: "待人工审阅",
  APPROVED: "分析已确认",
  FAILED: "分析失败",
  SUPERSEDED: "已被新版本覆盖",
};

function daysUntil(d: Date | null, now: Date): number | null {
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/** 单项目一行摘要。 */
export function formatProjectLine(p: StatusProjectRow, now: Date): string {
  const stage = STAGE_LABEL[getProjectStage(p)] ?? "未知阶段";
  const left = daysUntil(resolveCloseDate(p), now);
  const deadline = left === null ? "无截标日" : left < 0 ? `已过截标 ${-left} 天` : `截标还有 ${left} 天`;
  const analysis = p.analysisStatus ? ANALYSIS_LABEL[p.analysisStatus] ?? p.analysisStatus : "未分析";
  const approvals = p.pendingApprovals > 0 ? `，${p.pendingApprovals} 条待你批` : "";
  return `${p.name}：${stage} · ${deadline} · ${analysis}${approvals}`;
}

/** 排序：有待批的优先，其次截标最近。 */
export function sortStatusRows(rows: StatusProjectRow[], now: Date): StatusProjectRow[] {
  return [...rows].sort((a, b) => {
    if ((b.pendingApprovals > 0 ? 1 : 0) !== (a.pendingApprovals > 0 ? 1 : 0)) {
      return b.pendingApprovals > 0 ? 1 : -1;
    }
    const da = daysUntil(resolveCloseDate(a), now) ?? Number.POSITIVE_INFINITY;
    const db_ = daysUntil(resolveCloseDate(b), now) ?? Number.POSITIVE_INFINITY;
    return da - db_;
  });
}

export function formatStatusMessage(rows: StatusProjectRow[], now: Date): { message: string; suggestedActions: MuseSuggestedAction[] } {
  if (rows.length === 0) {
    return { message: "当前没有在跟的投标项目。", suggestedActions: [] };
  }
  const sorted = sortStatusRows(rows, now);
  const top = sorted.slice(0, 8);
  const lines = top.map((p, i) => `${i + 1}. ${formatProjectLine(p, now)}`);
  const more = sorted.length > top.length ? `\n（还有 ${sorted.length - top.length} 个，问我具体项目名可查看）` : "";
  const suggestedActions: MuseSuggestedAction[] = top.slice(0, 3).map((p) => ({
    label: `问「${p.name.slice(0, 20)}」`,
    command: { intent: "ask", projectId: p.id, question: "这个标现在最需要我做什么？" },
  }));
  return { message: `在跟 ${sorted.length} 个标：\n${lines.join("\n")}${more}`, suggestedActions };
}

// ── approvals ───────────────────────────────────────────────────

export type ApprovalDecisionOutcome = {
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
  duplicate?: boolean;
};

export function formatApprovalOutcome(
  requestId: string,
  decision: "approve" | "reject",
  outcome: ApprovalDecisionOutcome,
): MuseCommandResponse {
  if (!outcome.ok) {
    return errResponse(requestId, "APPROVAL_FAILED", outcome.error ?? "审批失败，请在青砚审批中心查看。");
  }
  const verb = decision === "approve" ? "已批准" : "已驳回";
  const dup = outcome.duplicate ? "（这条之前已经处理过，本次未重复执行）" : "";
  const tail = outcome.message ? `，${outcome.message}` : "";
  return okResponse(requestId, `${verb}${dup}${tail}`, {
    data: { status: outcome.status ?? null },
    suggestedActions: [{ label: "看看还有什么要批", command: { intent: "status" } }],
  });
}

// ── 意图门 ──────────────────────────────────────────────────────

export function gateIntent(
  requestId: string,
  command: MuseCommandArgs,
  enabled: ReadonlySet<MuseIntent>,
): MuseCommandResponse | null {
  return enabled.has(command.intent) ? null : notEnabledResponse(requestId, command.intent);
}

// ── compare / price_scenario（P1-6）────────────────────────────

const shortName = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** compare：结论（代码拼的 summaryZh，strict 脱敏）+ 矩阵；每家能算出落地价的供应商给一个「按它算情景」 */
export function formatCompareResponse(
  requestId: string,
  input: { projectId: string; inquiryId: string; roundNumber: number; matrix: CompareMatrix },
): MuseCommandResponse {
  const { matrix } = input;
  const actions: MuseSuggestedAction[] = matrix.rows
    .filter((r) => r.landedCad.total != null)
    .slice(0, 4)
    .map((r) => ({
      label: `按 ${shortName(r.supplierName)} 的落地价算情景`,
      command: { intent: "price_scenario" as const, projectId: input.projectId, supplierItemId: r.itemId },
    }));
  return okResponse(requestId, sanitizeOutbound(`第 ${input.roundNumber} 轮比价：${matrix.summaryZh}`, { strict: true }), {
    data: { inquiryId: input.inquiryId, roundNumber: input.roundNumber, matrix },
    suggestedActions: actions,
  });
}

/** 轮次里 0 家 quoted：如实说"还没有报价入表"，不回空矩阵 */
export function formatNoQuotesResponse(requestId: string, message: string, projectId: string): MuseCommandResponse {
  return okResponse(requestId, message, {
    suggestedActions: [{ label: "看这个标的状态", command: { intent: "status", projectId } }],
  });
}

/**
 * price_scenario：只出价格分、总分差、打平价（view 已由 projectScenariosForMuse 投影，不含 marginPct / ourCostCad）。
 * 落地价（我方成本）只用于后台计算，消息与 data 都不出。
 */
export function formatPriceScenarioResponse(
  requestId: string,
  input: {
    projectId: string;
    supplierItemId: string;
    supplierName: string;
    competitorPriceCad: number | null;
    competitorSourceZh: string | null;
    view: MusePricingView;
  },
): MuseCommandResponse {
  const { view } = input;
  const delta = (d: number) => `${d > 0 ? "+" : ""}${d}`;
  const lines: string[] = [];
  if (input.competitorPriceCad == null) {
    lines.push(`按「${shortName(input.supplierName, 20)}」的报价算情景：还没有对手/现任价格参考，算不出价格分。请在青砚报价表助手填一个对手价假设。`);
  } else {
    lines.push(`按「${shortName(input.supplierName, 20)}」的报价算情景（对手参考价 ${money(input.competitorPriceCad)}${input.competitorSourceZh ? `，${input.competitorSourceZh}` : ""}）：`);
    for (const s of view.scenarios) lines.push(`· ${s.labelZh} ${money(s.priceCad)} → 价格分 ${s.ourPriceScore}，总分差 ${delta(s.deltaPts)}`);
    if (view.candidate) lines.push(`· 你给的价 ${money(view.candidate.priceCad)} → 价格分 ${view.candidate.ourPriceScore}，总分差 ${delta(view.candidate.deltaPts)}`);
    lines.push(view.breakEvenPriceCad != null ? `打平价 ${money(view.breakEvenPriceCad)}：${view.breakEvenNoteZh}` : `打平价：${view.breakEvenNoteZh}`);
  }
  return okResponse(requestId, sanitizeOutbound(lines.join("\n"), { strict: true }), {
    data: {
      supplierItemId: input.supplierItemId,
      supplierName: input.supplierName,
      competitorPriceCad: input.competitorPriceCad,
      scenarios: view.scenarios,
      candidate: view.candidate,
      breakEvenPriceCad: view.breakEvenPriceCad,
    },
    suggestedActions: [{ label: "看比价", command: { intent: "compare", projectId: input.projectId } }],
  });
}
