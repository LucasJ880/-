/**
 * Muse Bridge — 事件信封构造（纯函数，零 DB），供 events.ts / hooks.ts 与测试共用。
 *
 * P1-8：事件摘要 = 结论 + 1 条理由（eventSummary），action = 下一步。
 */

import { MUSE_BRIDGE_CONTRACT_VERSION, museEventEnvelopeSchema, type MuseEventEnvelope, type MuseSuggestedAction } from "./contract";
import { eventSummary, sanitizeOutbound } from "./advisory";

export type EmitMuseEventInput = Omit<MuseEventEnvelope, "contractVersion" | "occurredAt"> & {
  occurredAt?: string;
};

/** 纯函数：构造并校验信封（测试用；不落库）。 */
export function buildMuseEvent(input: EmitMuseEventInput): MuseEventEnvelope | null {
  const candidate = {
    ...input,
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    summary: sanitizeOutbound(input.summary).slice(0, 300),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  const r = museEventEnvelopeSchema.safeParse(candidate);
  return r.success ? r.data : null;
}

const short = (s: string, n = 20) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nextStepAction = (projectId: string): MuseSuggestedAction => ({ label: "这个标下一步做什么", command: { intent: "next_step", projectId } });

/* ---------------------------------- analysis.ready ---------------------------------- */

export type AnalysisReadyFacts = {
  projectName: string;
  analyzedFiles: number | null;
  uploadedFiles: number | null;
  keyRequirements: number | null;
  risks: number | null;
  clarifications: number | null;
  needsHumanReview: boolean;
};

export function analysisReadyEventInput(input: {
  runId: string;
  orgId: string;
  recipientUserId: string;
  projectId: string;
  facts: AnalysisReadyFacts;
}): EmitMuseEventInput {
  const f = input.facts;
  const counts: string[] = [];
  if (f.keyRequirements != null) counts.push(`关键要求 ${f.keyRequirements} 条`);
  if (f.risks != null) counts.push(`风险 ${f.risks} 项`);
  if (f.clarifications != null) counts.push(`待澄清 ${f.clarifications} 条`);
  if (f.analyzedFiles != null && f.uploadedFiles != null) counts.push(`已分析 ${f.analyzedFiles}/${f.uploadedFiles} 个文件`);
  return {
    eventId: `analysis.ready:${input.runId}`,
    type: "analysis.ready",
    orgId: input.orgId,
    userId: input.recipientUserId,
    projectId: input.projectId,
    projectName: f.projectName,
    summary: eventSummary(
      `「${short(f.projectName)}」分析完成${f.needsHumanReview ? "，有地方要你复核" : ""}`,
      counts.length ? counts.join("、") : null,
    ),
    action: nextStepAction(input.projectId),
  };
}

/* ---------------------------------- quote.parsed / missing_fields ---------------------------------- */

export function quoteRecordedEventInput(input: {
  itemId: string;
  orgId: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  supplierName: string;
  type: "quote.parsed" | "missing_fields";
  missing: string[];
  quote: { unitPrice?: unknown; totalPrice?: unknown; currency?: string | null; deliveryDays?: number | null };
  now: Date;
}): EmitMuseEventInput {
  const q = input.quote;
  const cur = q.currency ? ` ${q.currency}` : "";
  const price = q.totalPrice != null ? `总价 ${String(q.totalPrice)}${cur}` : q.unitPrice != null ? `单价 ${String(q.unitPrice)}${cur}` : "价格未填";
  const lead = q.deliveryDays != null ? `交期 ${q.deliveryDays} 天` : "交期未填";
  const supplier = short(input.supplierName, 16);
  return {
    eventId: `quote.parsed:${input.itemId}:${input.now.getTime()}`,
    type: input.type,
    orgId: input.orgId,
    userId: input.ownerId,
    projectId: input.projectId,
    projectName: input.projectName,
    summary: eventSummary(
      input.missing.length ? `${supplier} 报价已入表，缺：${input.missing.join("、")}` : `${supplier} 报价已入表，字段齐全`,
      `${price}，${lead}`,
    ),
    action: input.missing.length
      ? nextStepAction(input.projectId)
      : { label: "比价", command: { intent: "compare", projectId: input.projectId } },
  };
}
