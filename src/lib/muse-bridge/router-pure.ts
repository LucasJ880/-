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
export function sanitizeOutbound(text: string): string {
  const t = text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
  return containsOutboundSensitive(t) ? "（该内容包含内部财务信息，不通过 Muse 通道输出，请在青砚内查看。）" : t;
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
