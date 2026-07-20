/**
 * AgentPlan — 一次结构化规划（快模型）+ 规则 fallback
 *
 * 安全：
 * - 不信任模型给出的 orgId / userId / 权限
 * - 实体 ID 必须与 Session 或本 org 数据校验后才采纳
 * - 模型不得直接决定发邮件 / 绕过 PendingAction
 * - plan.tools 仅作提示，不在此阶段直接执行
 */

import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { routeMarketingSkillIntent } from "@/lib/marketing/skill-router";

export type AgentPlanComplexity = "simple" | "normal" | "complex";
export type AgentPlanSource = "llm" | "rules" | "fallback";

export interface AgentPlan {
  intent: string;
  confidence: number;
  entities: {
    projectId?: string;
    customerId?: string;
    opportunityId?: string;
    quoteId?: string;
  };
  skills: string[];
  tools: Array<{ name: string; arguments: Record<string, unknown> }>;
  needsTools: boolean;
  canAnswerDirectly: boolean;
  requiresBackgroundRun: boolean;
  requiresApproval: boolean;
  complexity: AgentPlanComplexity;
  /** 给用户的首段有效回复（简单问题可直接用，跳过主 Agent） */
  initialResponse?: string;
  source: AgentPlanSource;
  /** 规划用的模型（仅观测） */
  plannerModel?: string;
}

const ALLOWED_INTENTS = new Set([
  "chat",
  "email",
  "project",
  "customer",
  "quote",
  "status",
  "marketing",
  "other",
]);

/** 禁止在 Plan 里暗示「可直接执行」的高风险工具名 */
const FORBIDDEN_TOOL_HINTS = [
  "sales.send_quote_email",
  "send_email",
  "send_quote_email",
  "gmail.send",
];

const PLAN_TIMEOUT_MS = 4_500;

export function createAgentPlanFromRules(input: {
  content: string;
  session?: {
    currentProjectId?: string | null;
    currentCustomerId?: string | null;
    currentOpportunityId?: string | null;
    currentQuoteId?: string | null;
  };
}): AgentPlan {
  const text = input.content || "";
  let intent = "chat";
  let confidence = 0.5;
  let skills: string[] = [];

  // 营销数字员工：规则路由优先（结合语义模式，非单纯关键词）
  const mkt = routeMarketingSkillIntent(text);
  if (mkt.slug && mkt.confidence >= 0.7) {
    intent = "marketing";
    confidence = mkt.confidence;
    skills = [mkt.slug];
  }

  if (intent === "chat") {
    if (/邮件|gmail|发信/.test(text)) {
      intent = "email";
      confidence = 0.7;
    } else if (/项目|任务|进度/.test(text)) {
      intent = "project";
      confidence = 0.7;
    } else if (/报价/.test(text)) {
      intent = "quote";
      confidence = 0.7;
    } else if (/客户|跟进/.test(text)) {
      intent = "customer";
      confidence = 0.65;
    }
  }

  const needsTools =
    skills.length > 0 ||
    (/查|搜|列|统计|报价|邮件|项目|客户|跟进|任务|deadline/.test(text) &&
      text.length > 4);
  const requiresApproval =
    /发送邮件|发邮件|正式报价|删除|批量|直接投放|直接上线|改预算/.test(text);
  const requiresBackgroundRun =
    skills.length > 0 ||
    text.length > 200 ||
    /分析|整理|总结|对比|报告/.test(text);
  const complexity: AgentPlanComplexity = requiresBackgroundRun
    ? "complex"
    : needsTools
      ? "normal"
      : "simple";

  return {
    intent,
    confidence,
    entities: {
      projectId: input.session?.currentProjectId || undefined,
      customerId: input.session?.currentCustomerId || undefined,
      opportunityId: input.session?.currentOpportunityId || undefined,
      quoteId: input.session?.currentQuoteId || undefined,
    },
    skills,
    tools: [],
    needsTools,
    canAnswerDirectly:
      skills.length === 0 &&
      !needsTools &&
      !requiresApproval &&
      complexity === "simple",
    requiresBackgroundRun,
    requiresApproval,
    complexity,
    source: "rules",
  };
}

/** 从模型文本中抽出 JSON 对象 */
export function extractPlanJson(raw: string): unknown | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function asComplexity(v: unknown): AgentPlanComplexity {
  if (v === "simple" || v === "normal" || v === "complex") return v;
  return "normal";
}

/**
 * 校验并规范化模型输出。失败返回 null（由调用方 fallback）。
 * 注意：此处不做 DB 校验，仅做结构与安全清洗。
 */
export function parseAndSanitizeAgentPlan(
  raw: unknown,
  fallbackEntities: AgentPlan["entities"],
): AgentPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // 明确拒绝模型注入租户字段
  if ("orgId" in o || "userId" in o) {
    delete o.orgId;
    delete o.userId;
  }

  const intentRaw = asString(o.intent)?.toLowerCase() || "chat";
  const intent = ALLOWED_INTENTS.has(intentRaw) ? intentRaw : "chat";

  const entIn =
    o.entities && typeof o.entities === "object"
      ? (o.entities as Record<string, unknown>)
      : {};

  // 只保留 ID 形态字段；丢弃名称类猜测中的伪造权限字段
  const entities: AgentPlan["entities"] = {
    projectId: asString(entIn.projectId) || fallbackEntities.projectId,
    customerId: asString(entIn.customerId) || fallbackEntities.customerId,
    opportunityId:
      asString(entIn.opportunityId) || fallbackEntities.opportunityId,
    quoteId: asString(entIn.quoteId) || fallbackEntities.quoteId,
  };

  const skills = Array.isArray(o.skills)
    ? o.skills
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const tools: AgentPlan["tools"] = [];
  if (Array.isArray(o.tools)) {
    for (const t of o.tools.slice(0, 5)) {
      if (!t || typeof t !== "object") continue;
      const name = asString((t as { name?: unknown }).name);
      if (!name) continue;
      if (FORBIDDEN_TOOL_HINTS.some((f) => name.includes(f) || name === f)) {
        continue;
      }
      const args = (t as { arguments?: unknown }).arguments;
      tools.push({
        name,
        arguments:
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {},
      });
    }
  }

  const needsTools = asBool(o.needsTools, tools.length > 0);
  const requiresApproval = asBool(o.requiresApproval, false);
  const requiresBackgroundRun = asBool(o.requiresBackgroundRun, false);
  const complexity = asComplexity(o.complexity);
  const initialResponse = asString(o.initialResponse)?.slice(0, 800);

  // 高风险或需要工具时，禁止「直接终答」
  let canAnswerDirectly = asBool(o.canAnswerDirectly, Boolean(initialResponse));
  if (needsTools || requiresApproval || requiresBackgroundRun) {
    canAnswerDirectly = false;
  }
  if (canAnswerDirectly && !initialResponse) {
    canAnswerDirectly = false;
  }

  // 「发送」类意图强制审批标记，不允许直接答完了事
  if (
    requiresApproval ||
    /发送邮件|发邮件|正式报价|删除/.test(String(o.initialResponse || ""))
  ) {
    canAnswerDirectly = false;
  }

  return {
    intent,
    confidence: clampConfidence(o.confidence),
    entities,
    skills,
    tools,
    needsTools,
    canAnswerDirectly,
    requiresBackgroundRun,
    requiresApproval,
    complexity,
    initialResponse,
    source: "llm",
  };
}

/** 用本 org 数据校验实体 ID；非法 ID 丢弃，回退 Session */
export async function validatePlanEntities(input: {
  orgId: string;
  session?: {
    currentProjectId?: string | null;
    currentCustomerId?: string | null;
    currentOpportunityId?: string | null;
    currentQuoteId?: string | null;
  };
  entities: AgentPlan["entities"];
}): Promise<AgentPlan["entities"]> {
  const orgId = input.orgId;
  const out: AgentPlan["entities"] = {};

  const projectId =
    input.entities.projectId || input.session?.currentProjectId || undefined;
  if (projectId) {
    const p = await db.project.findFirst({
      where: { id: projectId, orgId },
      select: { id: true },
    });
    if (p) out.projectId = p.id;
  }

  const customerId =
    input.entities.customerId || input.session?.currentCustomerId || undefined;
  if (customerId) {
    const c = await db.salesCustomer.findFirst({
      where: { id: customerId, orgId, archivedAt: null },
      select: { id: true },
    });
    if (c) out.customerId = c.id;
  }

  const opportunityId =
    input.entities.opportunityId ||
    input.session?.currentOpportunityId ||
    undefined;
  if (opportunityId) {
    const o = await db.salesOpportunity.findFirst({
      where: { id: opportunityId, orgId },
      select: { id: true },
    });
    if (o) out.opportunityId = o.id;
  }

  const quoteId =
    input.entities.quoteId || input.session?.currentQuoteId || undefined;
  if (quoteId) {
    const q = await db.salesQuote.findFirst({
      where: { id: quoteId, orgId },
      select: { id: true },
    });
    if (q) out.quoteId = q.id;
  }

  return out;
}

function buildPlannerPrompts(input: {
  content: string;
  sessionSummary?: string | null;
  session?: {
    currentProjectId?: string | null;
    currentCustomerId?: string | null;
    currentOpportunityId?: string | null;
    currentQuoteId?: string | null;
  };
}): { systemPrompt: string; userPrompt: string } {
  const sessionHint = [
    input.session?.currentProjectId
      ? `currentProjectId=${input.session.currentProjectId}`
      : null,
    input.session?.currentCustomerId
      ? `currentCustomerId=${input.session.currentCustomerId}`
      : null,
    input.session?.currentQuoteId
      ? `currentQuoteId=${input.session.currentQuoteId}`
      : null,
    input.sessionSummary
      ? `summary=${input.sessionSummary.slice(0, 400)}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  const systemPrompt = `你是青砚的对话规划器。只输出一个 JSON 对象，不要 Markdown，不要解释。
字段：
{
  "intent": "chat|email|project|customer|quote|status|marketing|other",
  "confidence": 0-1,
  "entities": { "projectId?:", "customerId?:", "opportunityId?:", "quoteId?:" },
  "skills": string[],
  "tools": [{ "name": string, "arguments": object }],
  "needsTools": boolean,
  "canAnswerDirectly": boolean,
  "requiresBackgroundRun": boolean,
  "requiresApproval": boolean,
  "complexity": "simple|normal|complex",
  "initialResponse": string
}
规则：
1. 不要输出 orgId、userId 或任何权限字段
2. 实体 ID 仅在会话上下文已给出时填写，不要编造 ID
3. 问候/闲聊/简单确认：needsTools=false, canAnswerDirectly=true, 并给出 initialResponse
4. 需要查数据/写操作：needsTools=true, canAnswerDirectly=false
5. 发送邮件、改正式报价、删除、批量改客户、直接投放/改预算：requiresApproval=true, canAnswerDirectly=false
6. tools 只是建议，不要假设已经执行；禁止建议直接发送邮件的工具
7. 营销相关（产品档案/客户研究/竞品/获客/文案/邮件活动/广告规划/实验/销售赋能/GEO/CRO）时 intent=marketing，并在 skills 填入对应 slug（如 marketing-product-context、marketing-competitor-profile），不得建议直接发送/发布/投放工具
8. initialResponse 用简洁中文，适合手机阅读`;

  const userPrompt = `会话上下文：${sessionHint || "无"}
用户消息：${input.content.slice(0, 1200)}`;

  return { systemPrompt, userPrompt };
}

/**
 * 快模型生成结构化 Plan；失败则规则 fallback。
 */
export async function createAgentPlan(input: {
  orgId: string;
  content: string;
  sessionSummary?: string | null;
  session?: {
    currentProjectId?: string | null;
    currentCustomerId?: string | null;
    currentOpportunityId?: string | null;
    currentQuoteId?: string | null;
  };
}): Promise<AgentPlan> {
  const rules = createAgentPlanFromRules({
    content: input.content,
    session: input.session,
  });

  if (!isAIConfigured()) {
    return { ...rules, source: "fallback" };
  }

  // 极短 deterministic 问候：不必打模型
  const trimmed = input.content.trim();
  if (/^(你好|您好|在吗|嗨|hi|hello)[！!。.~～]?$/i.test(trimmed)) {
    return {
      ...rules,
      intent: "chat",
      confidence: 1,
      needsTools: false,
      canAnswerDirectly: true,
      complexity: "simple",
      initialResponse: "在的，我是青砚。直接说你要处理的事就行。",
      source: "rules",
    };
  }

  try {
    const { systemPrompt, userPrompt } = buildPlannerPrompts(input);
    const raw = await createCompletion({
      systemPrompt,
      userPrompt,
      mode: "fast",
      maxTokens: 800,
      timeoutMs: PLAN_TIMEOUT_MS,
      temperature: 0.2,
      reasoningEffort: "low",
    });

    const parsed = extractPlanJson(raw);
    const sanitized = parseAndSanitizeAgentPlan(parsed, rules.entities);
    if (!sanitized) {
      return { ...rules, source: "fallback" };
    }

    sanitized.entities = await validatePlanEntities({
      orgId: input.orgId,
      session: input.session,
      entities: sanitized.entities,
    });
    // LLM 未点名营销技能时，用规则路由补齐（不覆盖已有 skills）
    if (sanitized.skills.length === 0 && rules.skills.length > 0) {
      sanitized.skills = rules.skills;
      sanitized.intent = "marketing";
      sanitized.needsTools = true;
      sanitized.canAnswerDirectly = false;
      if (rules.requiresBackgroundRun) sanitized.requiresBackgroundRun = true;
      if (rules.requiresApproval) sanitized.requiresApproval = true;
    }
    sanitized.plannerModel = "fast";
    sanitized.source = "llm";
    return sanitized;
  } catch {
    return { ...rules, source: "fallback" };
  }
}

/** 根据 Plan 决定主 Agent 模式与工具轮次 */
export function routeFromPlan(plan: AgentPlan): {
  mode: "fast" | "chat" | "deep";
  maxToolRounds: number;
  useDirectAnswer: boolean;
} {
  const useDirectAnswer = Boolean(
    plan.canAnswerDirectly &&
      plan.initialResponse &&
      !plan.needsTools &&
      !plan.requiresApproval,
  );

  if (useDirectAnswer) {
    return { mode: "fast", maxToolRounds: 0, useDirectAnswer: true };
  }

  if (plan.complexity === "complex" || plan.requiresBackgroundRun) {
    return { mode: "chat", maxToolRounds: 2, useDirectAnswer: false };
  }

  if (plan.needsTools) {
    return { mode: "chat", maxToolRounds: 2, useDirectAnswer: false };
  }

  // 不需要工具但仍要主模型润色（如 Plan 未给 initialResponse）
  // maxToolRounds=1：允许一轮生成终答，不进入「超轮总结」旁路
  return { mode: "fast", maxToolRounds: 1, useDirectAnswer: false };
}
