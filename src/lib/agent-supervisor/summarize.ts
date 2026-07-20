/**
 * 最终管理摘要 — 业务主管语言 + 确定性校验/模板兜底
 */

import { callSupervisorCompletion } from "./model-resolve";
import {
  ManagementSummarySchema,
  type KnowledgeRetrievalStatus,
  type ManagementSummary,
} from "./summary-schema";
import { validateSupervisorSummary } from "./summary-validator";
import type { SupervisorFinalSummary, SupervisorState } from "./types";
import { isAIConfigured } from "@/lib/ai/config";
import { logger } from "@/lib/common/logger";

const SUMMARY_SYSTEM = `你是青砚主管AI的管理摘要编辑。把多步技能结果整理成业务主管可读摘要。
硬性规则：
- 只输出 JSON，符合给定字段；
- 不要粘贴完整技能 JSON；
- 不要出现技能 slug（如 sales-pipeline-forecast）；
- 事实、推断、建议分开；缺数据用不确定语气；
- PendingAction 仍为 pending 时不得写已完成/已发送；
- 已拒绝动作必须写「已拒绝，未执行」；
- 知识检索降级时必须写入 limitations。`;

function humanizeSkillTitle(slug: string): string {
  const map: Record<string, string> = {
    "sales-pipeline-forecast": "销售管道预测",
    "sales-next-best-action": "下一步销售行动",
    "sales-account-research": "客户研究",
    "tender-bid-no-bid": "投标去留判断",
    "tender-mandatory-compliance-matrix": "强制条件矩阵",
    "marketing-product-context": "产品营销上下文",
    "marketing-prospecting-campaign": "获客活动策划",
    "marketing-copywriting": "营销文案",
  };
  return map[slug] || "专项分析";
}

function extractReadableSnippet(raw: string, max = 220): string {
  const t = (raw || "").trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const keys = [
        "summary",
        "conclusion",
        "decision",
        "recommendation",
        "managementSummary",
        "nextAction",
      ];
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) return v.trim().slice(0, max);
        if (v && typeof v === "object") {
          const s = JSON.stringify(v);
          if (s.length < max) return s;
        }
      }
      const missing = obj.missingData || obj.missingInformation;
      if (Array.isArray(missing) && missing.length) {
        return `缺失信息 ${missing.length} 项，需补充后才能给出确定建议`;
      }
      return "已完成结构化分析（细节见内部记录，不在此展开原始 JSON）";
    } catch {
      return t.slice(0, max);
    }
  }
  return t.slice(0, max);
}

function buildDeterministicSummary(state: SupervisorState): ManagementSummary {
  const completed = state.plan.filter((s) => s.status === "completed");
  const skippedFailed = state.plan.filter(
    (s) =>
      s.status === "failed" ||
      s.status === "skipped" ||
      s.error === "pending_action_rejected",
  );
  const findings = state.observations
    .flatMap((o) => o.factsLearned)
    .map((f) => extractReadableSnippet(f, 180))
    .filter(Boolean)
    .slice(0, 6);

  const uniqueFindings = Array.from(new Set(findings));
  const knowledge = state.knowledgeRetrieval || {
    status: "available" as const,
    reason: "",
    sourcesUsed: ["CRM/项目结构化数据"],
  };

  const limitations: string[] = [];
  if (state.fallbackUsed) {
    limitations.push("本次规划使用了规则降级（模型规划不可用或校验失败）。");
  }
  if (state.modelTelemetry?.some((m) => m.fallbackUsed)) {
    limitations.push("部分模型调用已切换到备用模型。");
  }
  if (knowledge.status !== "available") {
    limitations.push(
      "本次结论基于 CRM、项目和结构化业务数据；企业知识库检索暂不可用。",
    );
    if (knowledge.reason) limitations.push(`知识检索：${knowledge.reason}`);
  }
  for (const s of skippedFailed) {
    if (s.error === "pending_action_rejected") {
      limitations.push(`已拒绝，未执行：${s.objective}`);
    } else {
      limitations.push(
        `${s.status === "skipped" ? "已跳过" : "失败"}：${s.objective}${s.error ? `（${s.error}）` : ""}`,
      );
    }
  }

  const actions = completed.slice(0, 5).map((s, i) => ({
    priority: i + 1,
    action: `复核「${humanizeSkillTitle(s.skillSlug)}」结论并确认下一步`,
    reason: extractReadableSnippet(s.resultSummary || "", 160) || s.objective,
    ownerSuggestion: "负责人",
    suggestedDueAt: "",
    approvalRequired: state.pendingActionIds.length > 0 && i === completed.length - 1,
    pendingActionId:
      state.pendingActionIds.length && i === Math.min(completed.length - 1, 0)
        ? state.pendingActionIds[0]
        : null,
  }));

  if (state.pendingActionIds.length) {
    actions.push({
      priority: Math.min(actions.length + 1, 7),
      action: "审批待处理草稿（批准前不会对外执行）",
      reason: "存在待审批动作",
      ownerSuggestion: "管理员",
      suggestedDueAt: "",
      approvalRequired: true,
      pendingActionId: state.pendingActionIds[0] || null,
    });
  }

  const conclusionParts = [
    `关于「${state.objective}」：`,
    completed.length
      ? `已完成 ${completed.length} 项分析（${completed.map((s) => humanizeSkillTitle(s.skillSlug)).join("、")}）。`
      : "尚未完成有效分析步骤。",
    state.pendingActionIds.length
      ? `另有 ${state.pendingActionIds.length} 项待你审批，批准前不会自动执行。`
      : "",
    uniqueFindings[0] ? `要点：${uniqueFindings[0]}` : "当前数据有限，建议先补齐关键信息再决策。",
  ];

  return ManagementSummarySchema.parse({
    executiveConclusion: conclusionParts.filter(Boolean).join(""),
    keyFindings: uniqueFindings.length
      ? uniqueFindings.map((f) => ({
          finding: f,
          evidence: ["技能结果摘要"],
          confidence: knowledge.status === "available" ? "medium" : "low",
        }))
      : [
          {
            finding: "本轮未提取到足够结构化发现，请补充业务数据后重试",
            evidence: [],
            confidence: "low",
          },
        ],
    recommendedActions: actions.slice(0, 7),
    preparedItems: state.artifacts
      .filter((a) => a.kind === "draft" || a.kind === "skill_result")
      .map((a) => humanizeSkillTitle(a.title) || a.title)
      .slice(0, 8),
    pendingApprovals: [...state.pendingActionIds],
    missingInformation: [
      ...(state.resolvedContext.missingContext || []),
      ...state.plan
        .filter((s) => s.status === "pending")
        .map((s) => `未完成：${s.objective}`),
    ].slice(0, 8),
    risks: skippedFailed
      .filter((s) => s.error === "pending_action_rejected")
      .map((s) => `动作已拒绝未执行：${s.objective}`),
    completedSteps: completed.map(
      (s) => `${humanizeSkillTitle(s.skillSlug)}：${extractReadableSnippet(s.resultSummary || s.objective, 100)}`,
    ),
    skippedOrFailedSteps: skippedFailed.map((s) => {
      if (s.error === "pending_action_rejected") {
        return `已拒绝，未执行：${s.objective}`;
      }
      return `${s.status}：${s.objective}${s.error ? ` — ${s.error}` : ""}`;
    }),
    nextReviewSuggestion: state.pendingActionIds.length
      ? "审批完成后可继续本任务"
      : "建议 1–2 个工作日内复查进展",
    limitations,
    knowledgeRetrieval: knowledge,
    debugSkillSnippets: state.artifacts
      .map((a) => extractReadableSnippet(a.content, 120))
      .filter(Boolean)
      .slice(0, 6),
  });
}

function toLegacySummary(
  m: ManagementSummary,
  state: SupervisorState,
): SupervisorFinalSummary {
  return {
    managementSummary: m.executiveConclusion,
    executiveConclusion: m.executiveConclusion,
    keyFindings: m.keyFindings.map(
      (f) =>
        `${f.finding}${f.confidence !== "high" ? `（置信度：${f.confidence}）` : ""}`,
    ),
    recommendedActions: m.recommendedActions.map(
      (a) =>
        `P${a.priority} ${a.action}${a.approvalRequired ? "（需审批）" : ""}${a.reason ? ` — ${a.reason}` : ""}`,
    ),
    preparedDrafts: m.preparedItems,
    pendingApprovals: m.pendingApprovals,
    incompleteAndMissing: [
      ...m.missingInformation,
      ...m.skippedOrFailedSteps,
      ...m.risks,
    ],
    nextCheckSuggestion: m.nextReviewSuggestion,
    fallbackUsed: state.fallbackUsed,
    limitations: m.limitations,
    knowledgeRetrieval: m.knowledgeRetrieval,
    structured: m,
  };
}

async function tryLlmSummary(
  state: SupervisorState,
): Promise<{ summary: ManagementSummary; modelMeta?: { requestedModel: string; actualModel: string; fallbackUsed: boolean; fallbackReason?: string } } | null> {
  if (!isAIConfigured()) return null;
  const deterministic = buildDeterministicSummary(state);
  const userPrompt = [
    `目标：${state.objective}`,
    `模式：${state.mode}`,
    `知识检索：${JSON.stringify(state.knowledgeRetrieval || {})}`,
    `计划步骤：${JSON.stringify(
      state.plan.map((s) => ({
        title: humanizeSkillTitle(s.skillSlug),
        status: s.status,
        error: s.error,
        summary: extractReadableSnippet(s.resultSummary || "", 200),
      })),
    )}`,
    `观察：${JSON.stringify(
      state.observations.map((o) => ({
        decision: o.decision,
        summary: extractReadableSnippet(o.summary, 160),
        facts: o.factsLearned.map((f) => extractReadableSnippet(f, 120)),
      })),
    )}`,
    `待审批ID：${JSON.stringify(state.pendingActionIds)}`,
    `请基于以上信息输出管理摘要 JSON（字段：executiveConclusion, keyFindings[{finding,evidence,confidence}], recommendedActions[{priority,action,reason,ownerSuggestion,suggestedDueAt,approvalRequired,pendingActionId}], preparedItems, pendingApprovals, missingInformation, risks, completedSteps, skippedOrFailedSteps, nextReviewSuggestion, limitations）。`,
    `参考骨架（可改写，不要照搬 JSON 技能原文）：${JSON.stringify({
      executiveConclusion: deterministic.executiveConclusion,
      limitations: deterministic.limitations,
      pendingApprovals: deterministic.pendingApprovals,
    })}`,
  ].join("\n");

  try {
    const result = await callSupervisorCompletion("summary", {
      systemPrompt: SUMMARY_SYSTEM,
      userPrompt,
      orgId: state.orgId,
      userId: state.userId,
      maxTokens: 1800,
      temperature: 0.2,
      timeoutMs: 25_000,
    });
    const cleaned = result.content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const merged = {
      ...deterministic,
      ...parsed,
      pendingApprovals: state.pendingActionIds,
      knowledgeRetrieval: state.knowledgeRetrieval || deterministic.knowledgeRetrieval,
      limitations: Array.from(
        new Set([
          ...(Array.isArray(parsed.limitations) ? parsed.limitations : []),
          ...deterministic.limitations,
        ]),
      ),
    };
    return {
      summary: ManagementSummarySchema.parse(merged),
      modelMeta: {
        requestedModel: result.requestedModel,
        actualModel: result.actualModel,
        fallbackUsed: result.fallbackUsed,
        fallbackReason: result.fallbackReason,
      },
    };
  } catch (err) {
    logger.warn("supervisor.summary.llm_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 构建并通过校验的最终摘要（供 engine 调用） */
export async function buildValidatedFinalSummary(
  state: SupervisorState,
): Promise<SupervisorFinalSummary> {
  let candidate = buildDeterministicSummary(state);
  let usedLlm = false;

  const llm = await tryLlmSummary(state);
  if (llm) {
    candidate = llm.summary;
    usedLlm = true;
    if (llm.modelMeta) {
      state.modelTelemetry = [
        ...(state.modelTelemetry || []),
        { purpose: "summary", ...llm.modelMeta },
      ];
    }
  }

  let validated = validateSupervisorSummary(candidate, state);
  if (!validated.ok || !validated.summary) {
    // 最多修复一次：用确定性模板重写
    logger.warn("supervisor.summary.validate_failed", {
      issues: validated.issues,
      usedLlm,
    });
    candidate = buildDeterministicSummary(state);
    validated = validateSupervisorSummary(candidate, state);
  }

  const finalSummary = validated.summary || candidate;
  // 二次保证：绝不把原始技能 JSON 塞进结论
  if (/^\s*[\{\[]/.test(finalSummary.executiveConclusion)) {
    return toLegacySummary(buildDeterministicSummary(state), state);
  }
  return toLegacySummary(finalSummary, state);
}

/** 同步确定性摘要（测试/降级） */
export function buildFinalSummary(state: SupervisorState): SupervisorFinalSummary {
  return toLegacySummary(buildDeterministicSummary(state), state);
}

export function formatSummaryForUser(state: SupervisorState): string {
  const s = state.finalSummary || buildFinalSummary(state);
  const structured = s.structured;
  const lines: string[] = ["【主管AI · 管理摘要】", ""];

  lines.push("## 结论", s.executiveConclusion || s.managementSummary, "");

  lines.push("## 关键发现");
  for (const f of s.keyFindings) lines.push(`- ${f}`);
  lines.push("");

  lines.push("## 今天/本周应做的动作");
  for (const a of s.recommendedActions) lines.push(`- ${a}`);
  lines.push("");

  if (s.preparedDrafts?.length) {
    lines.push("## 已准备的草稿或任务");
    for (const p of s.preparedDrafts) lines.push(`- ${p}`);
    lines.push("");
  }

  if (s.pendingApprovals?.length) {
    lines.push("## 待审批事项（批准前不会生效）");
    for (const id of s.pendingApprovals) lines.push(`- ${id}`);
    lines.push("");
  }

  const incomplete = s.incompleteAndMissing || [];
  if (incomplete.length) {
    lines.push("## 缺失信息 / 未完成");
    for (const x of incomplete) lines.push(`- ${x}`);
    lines.push("");
  }

  const limitations = s.limitations || structured?.limitations || [];
  if (limitations.length || s.fallbackUsed) {
    lines.push("## 风险与限制");
    if (s.fallbackUsed) lines.push("- 本次规划使用规则降级。");
    for (const x of limitations) lines.push(`- ${x}`);
    const kr = s.knowledgeRetrieval || structured?.knowledgeRetrieval;
    if (kr && kr.status !== "available") {
      lines.push(
        "- 本次结论基于 CRM、项目和结构化业务数据；企业知识库检索暂不可用。",
      );
    }
    lines.push("");
  }

  if (s.nextCheckSuggestion) {
    lines.push("## 下一次建议检查", s.nextCheckSuggestion);
  }

  return lines.join("\n");
}

export function defaultKnowledgeRetrieval(
  sources: string[] = ["CRM", "项目", "结构化业务数据"],
): KnowledgeRetrievalStatus {
  return {
    status: "available",
    reason: "",
    sourcesUsed: sources,
  };
}
