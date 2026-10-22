/**
 * Runtime V2 工具适配层 — 不直连任意 service 绕过审批。
 * 写操作只 createDraft；读/分析可查库或调 Grader。
 *
 * P0 Execution Alignment（#88）：本文件的 handler map 是
 * server-authoritative 可执行工具注册表——一个工具"可执行"当且仅当
 * 它在 RUNTIME_V2_TOOL_HANDLERS 中有 handler。tool-catalog 的 planner
 * 可见投影据此过滤（PLANNER_VISIBLE_TOOLS ⊆ EXECUTABLE_TOOLS，
 * 不可能再出现 planner 可选但执行必失败的 ghost tool）。
 *
 * P0 Dynamic Aggregation（#89）：adapter 不再按黄金模板字面 stepKey
 * （s1_pipeline/s3_followup_analysis/s5_prioritize…）读取上游证据；
 * 一律按业务语义形状（grader 标记 / opportunities / prioritized 列表）
 * 在 ctx.priorEvidence 内识别。workforce 契约任务的 priorEvidence 已由
 * executor 收敛为 step.dependsOn 声明的上游（声明序）；legacy runtime_v2
 * 保持全量证据 map，语义识别对两者同样成立。
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { runCustomerFollowupGrader } from "@/lib/ai-grader/graders/customer-followup-grader";
import { runQuoteRiskGrader } from "@/lib/ai-grader/graders/quote-risk-grader";
import { isGmailDraftEnabled } from "@/lib/google-email";
import { classifyGraderError } from "./grader-errors";
import { buildRuntimeV2OperationKey } from "./idempotency";
import { prioritizeFollowups, type PrioritizeOpportunity } from "./prioritize";
import { TENDER_WORKFORCE_TOOL_HANDLERS } from "@/lib/tender-workforce/tools";
import {
  followupReminderSchedule,
  formatInTimezone,
  readFollowupRunContext,
  type FollowupRunContext,
} from "@/lib/assistant/followup-contract";
import {
  attachmentBlobPathBelongsTo,
  readStoredAttachments,
} from "@/lib/chat-attachments/core";

export type AdapterContext = {
  orgId: string;
  userId: string;
  role: string;
  runId: string;
  threadId?: string | null;
  /** 关联助手消息，供刷新后挂载 ApprovalCard */
  assistantMessageId?: string | null;
  stepKey: string;
  /** 稳定业务操作键（不含 attempt） */
  operationKey: string;
  /**
   * 前序步骤输出汇总。workforce 契约任务（spec valid）由 executor 按
   * step.dependsOn 声明收敛（scoped，声明序）；legacy runtime_v2 与
   * true-legacy workforce step 保持全量 map（行为不变，§13 兼容）。
   */
  priorEvidence: Record<string, unknown>;
  /**
   * Phase 2B-1（workforce_job 任务专属）：server 构建的 Worker 执行上下文
   * （workerKey/role/objective/validated 上游 Handoff）。仅用于任务执行
   * 上下文与审计，绝不参与鉴权——Tool 授权仍由 canInvokeTool / scope /
   * 审批链独立判定（§12/§16）。legacy runtime_v2 恒为 undefined。
   */
  workforce?: import("@/lib/workforce-runtime/handoff").WorkforceExecutionContext;
  /**
   * T5-P1 Segment 2 §7：**server-only** 写防栅栏（AgentRun 租约 fencing token）。
   *
   * 只由 Runtime executor 在服务端注入（见 executor.ts 的 executeRuntimeV2Tool
   * 调用点），供需要"长 await 后仍原子安全落库"的域工具使用（canonical V2 持久化）。
   *
   * 硬规则：这是**活对象、不是数据**——绝不进入 API body / planJson / task contract /
   * metadata / inputJson / handoff / outputJson / event payload，客户端无法构造。
   * legacy runtime_v2 与所有非 workforce 路径恒为 undefined。
   */
  runFence?: import("@/lib/agent-runtime/lease").RunFence;
  /**
   * T5-P1.1 §5：**server-only** 本次 serverless invocation 的执行预算。
   *
   * 由 cron 路由在 HTTP 请求开始时算出绝对 deadline 并逐层下传，供
   * **可续跑的长工具**判断"还能不能再发起一次模型调用"。与 runFence 同纪律：
   * 活对象/服务端事实，绝不进入 API body / planJson / task contract / metadata /
   * handoff / outputJson / event payload。legacy runtime_v2 恒为 undefined。
   */
  executionBudget?: RuntimeExecutionBudget;
};

/** 本次 serverless invocation 的执行预算（绝对时间，非相对） */
export type RuntimeExecutionBudget = {
  /** epoch ms 硬截止：超过它就不许再发起新的长调用 */
  deadlineAt: number;
  /** 本次 invocation 的完整工作预算（阶段准入判定用） */
  tickBudgetMs: number;
};

/**
 * T5-P1.1 §13 —— **正常让出**（continuation），不是失败。
 *
 * 可续跑的长工具（当前唯一使用方：tender_analyze_package_v2）在本次 serverless
 * invocation 预算耗尽时返回它：成果已 checkpoint 落盘，下次 invocation 从断点继续。
 *
 * 刻意**不**复用 ok=false / 特殊错误串 / throw / requiresApproval 来表达让出——
 * 那些都会消耗重试预算或把进展伪装成失败/审批。
 */
export type ToolContinuation = {
  /** 让出原因（当前只有时间预算） */
  reason: "TIME_BUDGET_YIELD";
  /** 让出时所处阶段（域自定义，仅可观测用） */
  phase?: string;
  /** 已推进的 tick 数（仅可观测用） */
  ticks?: number;
};

export type AdapterResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  pendingActionId?: string;
  requiresApproval?: boolean;
  /**
   * 存在即表示"本次未完成、但已安全 checkpoint"。executor 必须在
   * 失败/审批/正常完成**之前**处理它（见 executor 的 continuation 分支）。
   * 普通工具永不设置该字段，因此行为零变化。
   */
  continuation?: ToolContinuation;
};

type RuntimeV2ToolHandler = (ctx: AdapterContext) => Promise<AdapterResult>;

// ── 提醒 / 跟进时间：只来自用户明确输入或已授权业务规则 ─────────────
//
// 时区只能取可信的用户 / 组织配置（MarketingBrandProfile.timezone），
// 绝不取服务器本地时间。legacy runtime_v2 黄金模板与 LLM 规划的
// Workforce Job 的步骤都不携带用户明确时间，也不存在已授权的默认跟进
// 时间规则 → 依赖时间的写工具一律 fail-closed：不查库、不建草稿，
// 以 executor 既有的 skipped 终态返回明确原因（替代曾经凭空推算
// "下周五 15:00（服务器本地时区）"的 nextFridayIso）。

export const REMINDER_TIME_REQUIRED = "REMINDER_TIME_REQUIRED";

function reminderTimeRequired(what: string, targetCount: number): AdapterResult {
  return {
    ok: true,
    data: {
      skipped: true,
      reason: `${REMINDER_TIME_REQUIRED}: 缺少用户明确给出的${what}，系统不会自行假设时间`,
      missingInputs: ["reminder_time"],
      targetCount,
      summary: `未创建草稿：需要明确的${what}（${targetCount} 个待安排对象）`,
    },
  };
}

// ── 面向客户的跟进邮件：中性模板 ──────────────────────────────────
//
// 正文进入 Gmail 草稿（text/html）并由客户阅读：绝不拼接内部评分 /
// 风险理由（如"跟进逾期 12 天(+30)"），客户名必须 HTML 转义。

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 优先客户缺名时的内部占位（证据识别 / 排序输入），不得出现在客户邮件里 */
const UNKNOWN_CUSTOMER_PLACEHOLDER = "未知客户";

export function neutralFollowupEmailContent(customerName: string): {
  subject: string;
  body: string;
} {
  const name = customerName.trim();
  const greeting =
    name && name !== UNKNOWN_CUSTOMER_PLACEHOLDER
      ? `${escapeHtml(name)}，您好：`
      : "您好：";
  return {
    subject: "跟进我们之前的沟通",
    body: [
      `<p>${greeting}</p>`,
      "<p>想跟进一下我们之前沟通的事项，看看您目前的进展，以及是否有需要我们协助或调整的地方。</p>",
      "<p>方便的话请直接回复这封邮件，或告诉我适合沟通的时间。</p>",
      "<p>谢谢！</p>",
    ].join(""),
  };
}

function draftActionId(draft: { success: boolean; data: unknown }): string | null {
  if (!draft.success || !draft.data || typeof draft.data !== "object") return null;
  const id = (draft.data as { actionId?: string }).actionId;
  return typeof id === "string" ? id : null;
}

function truncateText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── 语义证据识别（#89：业务语义来自内容形状，不来自 stepKey 字面量）──

type EvidenceRecord = Record<string, unknown>;

/** priorEvidence 中的对象型条目（保持 map 插入序 = 依赖声明序/步骤序） */
function evidenceRecords(prior: Record<string, unknown>): EvidenceRecord[] {
  return Object.values(prior).filter(
    (v): v is EvidenceRecord =>
      !!v && typeof v === "object" && !Array.isArray(v),
  );
}

/** 跟进分析证据：CustomerFollowupGrader 输出（含 fallback 降级形态） */
export function findFollowupAnalysisEvidence(
  prior: Record<string, unknown>,
): EvidenceRecord | null {
  for (const v of evidenceRecords(prior)) {
    if (typeof v.grader === "string" && v.grader.startsWith("customer_followup")) {
      return v;
    }
  }
  return null;
}

/** 报价风险证据：QuoteRiskGrader 输出（含 fallback 降级形态） */
export function findQuoteRiskEvidence(
  prior: Record<string, unknown>,
): EvidenceRecord | null {
  for (const v of evidenceRecords(prior)) {
    if (typeof v.grader === "string" && v.grader.startsWith("quote_risk")) {
      return v;
    }
  }
  return null;
}

/** 商机列表证据：opportunities 数组（列表工具）或 pipeline sample */
export function findOpportunityListEvidence(
  prior: Record<string, unknown>,
): Array<Record<string, unknown>> {
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.opportunities)) {
      return v.opportunities as Array<Record<string, unknown>>;
    }
  }
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.sample) && v.byStage && typeof v.byStage === "object") {
      return v.sample as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export type PrioritizedEvidenceEntry = {
  customerId: string;
  customerName: string;
  email?: string | null;
  opportunityId?: string;
  reasons?: string[];
};

/** 优先客户证据：prioritized 数组（sales_prioritize_followups 输出形状） */
export function findPrioritizedEvidence(
  prior: Record<string, unknown>,
): PrioritizedEvidenceEntry[] {
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.prioritized)) {
      return (v.prioritized as Array<Record<string, unknown>>)
        .filter(
          (p): p is Record<string, unknown> =>
            !!p && typeof p === "object" && typeof p.customerId === "string",
        )
        .map((p) => ({
          customerId: p.customerId as string,
          customerName:
            typeof p.customerName === "string"
              ? p.customerName
              : UNKNOWN_CUSTOMER_PLACEHOLDER,
          email: typeof p.email === "string" ? p.email : null,
          opportunityId:
            typeof p.opportunityId === "string" ? p.opportunityId : undefined,
          reasons: Array.isArray(p.reasons)
            ? (p.reasons as unknown[]).filter(
                (r): r is string => typeof r === "string",
              )
            : undefined,
        }));
    }
  }
  return [];
}

const MAX_CUSTOMER_TARGETS = 5;

/**
 * 从声明依赖证据推导客户目标（#88 读 adapter 的目标定位）：
 * prioritized → customers 列表 → 标量 customerId → Handoff businessRefs。
 * 结果仅作查询候选——所有查询仍强制 orgId scope，跨 org id 自然查不到。
 */
export function deriveCustomerTargetIds(
  prior: Record<string, unknown>,
): string[] {
  const seen = new Set<string>();
  const push = (id: unknown) => {
    if (
      typeof id === "string" &&
      id.length > 0 &&
      !seen.has(id) &&
      seen.size < MAX_CUSTOMER_TARGETS
    ) {
      seen.add(id);
    }
  };
  for (const p of findPrioritizedEvidence(prior)) push(p.customerId);
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.customers)) {
      for (const c of v.customers as Array<Record<string, unknown>>) {
        if (c && typeof c === "object") push(c.id);
      }
    }
  }
  for (const v of evidenceRecords(prior)) push(v.customerId);
  for (const v of evidenceRecords(prior)) {
    const handoff = v.workforceHandoff;
    if (handoff && typeof handoff === "object" && !Array.isArray(handoff)) {
      const refs = (handoff as Record<string, unknown>).businessRefs;
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (typeof ref === "string" && ref.startsWith("customer:")) {
            push(ref.slice("customer:".length));
          }
        }
      }
    }
  }
  return [...seen];
}

// ── DURABLE_FOLLOWUP_M1：客户跟进持久任务（服务端计划专用工具的共享上下文）──
//
// 任务上下文只从 AgentRun.metadata（createWorkforceJob 经 extraMetadata 写入，
// 客户端无写入通道）读取；非本契约的 run 一律 null → 工具 fail-closed。

const NOT_FOLLOWUP_TASK =
  "NOT_A_FOLLOWUP_TASK: 该工具只服务于客户跟进持久任务（服务端计划）";

async function loadFollowupRun(ctx: AdapterContext): Promise<{
  status: string;
  userMessageId: string | null;
  followup: FollowupRunContext;
} | null> {
  const run = await db.agentRun.findFirst({
    where: { id: ctx.runId, orgId: ctx.orgId },
    select: { status: true, metadata: true, userMessageId: true },
  });
  if (!run) return null;
  const followup = readFollowupRunContext(run.metadata);
  if (!followup) return null;
  return { status: run.status, userMessageId: run.userMessageId, followup };
}

/** 附件证据（sales_followup_attachment_evidence 输出形状） */
export function findAttachmentEvidence(
  prior: Record<string, unknown>,
): { customerIds: string[]; refs: string[] } | null {
  for (const v of evidenceRecords(prior)) {
    if (v.attachmentEvidence !== true) continue;
    const customerIds = (Array.isArray(v.customerMatches) ? v.customerMatches : [])
      .map((c) =>
        c && typeof c === "object" ? (c as Record<string, unknown>).customerId : null,
      )
      .filter((id): id is string => typeof id === "string");
    const refs = (Array.isArray(v.attachments) ? v.attachments : [])
      .map((a) =>
        a && typeof a === "object" ? (a as Record<string, unknown>).ref : null,
      )
      .filter((r): r is string => typeof r === "string");
    return { customerIds, refs };
  }
  return null;
}

/** 同一客户多个商机只保留得分最高者（列表已按分数降序） */
function uniqueByCustomer<T extends { customerId: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    if (seen.has(p.customerId)) return false;
    seen.add(p.customerId);
    return true;
  });
}

/** 面向客户的跟进邮件：不含任何内部评分 / 风险措辞；用户在 Gmail 中审阅后自行发送 */
function followupEmailContent(customerName: string): {
  subject: string;
  body: string;
} {
  const name =
    customerName
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;") || "您好";
  return {
    subject: "跟进我们之前沟通的方案",
    body: [
      `<p>${name}，您好：</p>`,
      "<p>想跟进一下我们之前沟通的方案和报价，看看您是否还有疑问，或需要我们调整的地方。</p>",
      "<p>方便的话请直接回复这封邮件，或告诉我适合沟通的时间。</p>",
      "<p>谢谢！</p>",
    ].join(""),
  };
}

async function runGraderWithGuardedFallback(
  name: "customer_followup" | "quote_risk",
  ctx: AdapterContext,
  run: () => Promise<unknown>,
  fallback: () => Promise<Record<string, unknown>>,
): Promise<AdapterResult> {
  const label = name === "customer_followup" ? "跟进优先级分析" : "报价风险分析";
  try {
    const result = await run();
    const issues = (result as { issues?: unknown[] } | null)?.issues;
    const issueCount = Array.isArray(issues) ? issues.length : undefined;
    return {
      ok: true,
      data: {
        grader: name,
        result: result as Record<string, unknown>,
        degraded: false,
        evidenceQuality: "FULL",
        summary:
          issueCount !== undefined
            ? `${label}完成：发现 ${issueCount} 项需关注问题`
            : `${label}完成（完整证据）`,
      },
    };
  } catch (err) {
    const classified = classifyGraderError(err);
    if (!classified.degradable) {
      return {
        ok: false,
        error: `${classified.code}: ${classified.message}`,
        data: {
          grader: name,
          errorCode: classified.code,
          degraded: false,
          evidenceQuality: "NONE",
        },
      };
    }
    const fb = await fallback();
    return {
      ok: true,
      data: {
        grader: `${name}_fallback`,
        ...fb,
        degraded: true,
        degradationReason: `${classified.code}: ${classified.message}`,
        evidenceQuality: "PARTIAL",
        summary: `${label}降级完成（Grader 不可用，使用数据库兜底证据）`,
      },
    };
  }
}

// ── Executable Tool Registry（#88 单一事实源）─────────────────────
//
// 一个工具在此 map 中有 handler ⇔ server 可执行。executeRuntimeV2Tool
// 从本 map 分发；tool-catalog 的 planner 投影按本 map 过滤。允许
// EXECUTABLE ⊋ PLANNER_VISIBLE（internal-only 工具），绝不允许反向。

const RUNTIME_V2_TOOL_HANDLERS: Record<string, RuntimeV2ToolHandler> = {
  sales_get_pipeline: async (ctx) => {
    const opps = await db.salesOpportunity.findMany({
      where: {
        orgId: ctx.orgId,
        stage: { notIn: ["signed", "completed", "lost"] },
      },
      select: {
        id: true,
        stage: true,
        estimatedValue: true,
        nextFollowupAt: true,
        updatedAt: true,
        installDate: true,
        measureDate: true,
        customerId: true,
        customer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    const byStage: Record<string, number> = {};
    for (const o of opps) {
      byStage[o.stage] = (byStage[o.stage] ?? 0) + 1;
    }
    const stageBrief = Object.entries(byStage)
      .map(([s, n]) => `${s}=${n}`)
      .join("，");
    return {
      ok: true,
      data: {
        opportunityCount: opps.length,
        byStage,
        sample: opps.slice(0, 15),
        summary: truncateText(
          `Pipeline 共 ${opps.length} 个活跃商机；阶段分布：${stageBrief || "无"}`,
          300,
        ),
      },
    };
  },

  sales_list_opportunities: async (ctx) => {
    const opps = await db.salesOpportunity.findMany({
      where: {
        orgId: ctx.orgId,
        stage: { notIn: ["signed", "completed", "lost"] },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        quotes: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true, updatedAt: true, status: true, sentAt: true },
        },
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    const top = opps
      .slice(0, 3)
      .map((o) => o.customer?.name ?? o.title)
      .join("、");
    return {
      ok: true,
      data: {
        opportunities: opps,
        summary: truncateText(
          `读取 ${opps.length} 条活跃商机${top ? `（近期更新：${top}）` : ""}`,
          300,
        ),
      },
    };
  },

  // ── #88 新增：客户读工具（曾为 ghost tool）。全部 org-scoped、有界、
  // 只读；目标客户优先从声明依赖证据推导，无线索时回退组织内近期记录。──

  sales_search_customers: async (ctx) => {
    const customers = await db.salesCustomer.findMany({
      where: { orgId: ctx.orgId, archivedAt: null, status: { not: "dormant" } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        tags: true,
        source: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return {
      ok: true,
      data: {
        customers,
        count: customers.length,
        summary: truncateText(
          `检索到 ${customers.length} 个活跃客户（按最近更新排序，最多 20 条）`,
          300,
        ),
      },
    };
  },

  sales_get_customer: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const customers = await db.salesCustomer.findMany({
      where: {
        orgId: ctx.orgId,
        archivedAt: null,
        ...(targets.length > 0 ? { id: { in: targets } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        status: true,
        tags: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        opportunities: {
          select: {
            id: true,
            title: true,
            stage: true,
            estimatedValue: true,
            nextFollowupAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: targets.length > 0 ? MAX_CUSTOMER_TARGETS : 5,
    });
    const names = customers.map((c) => c.name).join("、");
    return {
      ok: true,
      data: {
        customers,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          targets.length > 0
            ? `读取 ${customers.length} 个上游证据定位客户的详情：${names}`
            : `上游证据未定位到具体客户，读取组织内近期 ${customers.length} 个客户详情：${names}`,
          300,
        ),
      },
    };
  },

  sales_get_customer_interactions: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const interactions = await db.customerInteraction.findMany({
      where: {
        orgId: ctx.orgId,
        ...(targets.length > 0 ? { customerId: { in: targets } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        type: true,
        direction: true,
        channel: true,
        outcome: true,
        summary: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const bounded = interactions.map((ix) => ({
      ...ix,
      summary: truncateText(ix.summary ?? "", 300),
    }));
    return {
      ok: true,
      data: {
        interactions: bounded,
        count: bounded.length,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          `读取 ${bounded.length} 条客户互动记录${
            targets.length > 0 ? "（上游证据定位客户）" : "（组织内近期）"
          }`,
          300,
        ),
      },
    };
  },

  sales_get_customer_quotes: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const quotes = await db.salesQuote.findMany({
      where: {
        orgId: ctx.orgId,
        ...(targets.length > 0 ? { customerId: { in: targets } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        version: true,
        status: true,
        grandTotal: true,
        currency: true,
        sentAt: true,
        viewedAt: true,
        signedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const byStatus: Record<string, number> = {};
    for (const q of quotes) {
      byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
    }
    const statusBrief = Object.entries(byStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join("，");
    return {
      ok: true,
      data: {
        quotes,
        count: quotes.length,
        byStatus,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          `读取 ${quotes.length} 份报价${
            targets.length > 0 ? "（上游证据定位客户）" : "（组织内近期）"
          }；状态分布：${statusBrief || "无"}`,
          300,
        ),
      },
    };
  },

  sales_customer_followup_analysis: async (ctx) => {
    return runGraderWithGuardedFallback(
      "customer_followup",
      ctx,
      () =>
        runCustomerFollowupGrader({
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          mode: "GLOBAL",
        }),
      async () => {
        const stale = await db.salesOpportunity.findMany({
          where: {
            orgId: ctx.orgId,
            stage: { notIn: ["signed", "completed", "lost"] },
            OR: [
              { nextFollowupAt: { lte: new Date() } },
              {
                nextFollowupAt: null,
                updatedAt: { lte: new Date(Date.now() - 14 * 86400000) },
              },
            ],
          },
          include: {
            customer: { select: { id: true, name: true, email: true } },
          },
          take: 20,
        });
        return { staleOpportunities: stale };
      },
    );
  },

  sales_quote_risk_analysis: async (ctx) => {
    return runGraderWithGuardedFallback(
      "quote_risk",
      ctx,
      () =>
        runQuoteRiskGrader({
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          mode: "GLOBAL",
        }),
      async () => {
        const quotes = await db.salesQuote.findMany({
          where: { orgId: ctx.orgId },
          orderBy: { updatedAt: "desc" },
          take: 15,
          include: { customer: { select: { id: true, name: true } } },
        });
        return { recentQuotes: quotes };
      },
    );
  },

  sales_prioritize_followups: async (ctx) => {
    // #89：证据按业务语义识别（依赖声明是消费权威；不查字面 stepKey）
    const prior = ctx.priorEvidence;
    const followupAnalysis = findFollowupAnalysisEvidence(prior);
    const quoteRiskAnalysis = findQuoteRiskEvidence(prior);
    if (!followupAnalysis || !quoteRiskAnalysis) {
      return {
        ok: false,
        error:
          "MISSING_GRADER_EVIDENCE: 声明依赖中缺少跟进分析或报价风险分析证据（该任务必须依赖已完成的两类分析任务）",
      };
    }
    const rawOpps = findOpportunityListEvidence(prior);
    const opportunities: PrioritizeOpportunity[] = (
      rawOpps as Array<{
        id?: string;
        customerId?: string;
        customer?: { id?: string; name?: string; email?: string | null };
        nextFollowupAt?: string | Date | null;
        updatedAt?: string | Date;
        stage?: string;
        estimatedValue?: number | null;
        installDate?: string | Date | null;
        measureDate?: string | Date | null;
        quotes?: Array<{
          updatedAt?: string | Date;
          sentAt?: string | Date | null;
          status?: string;
        }>;
        interactions?: Array<{ createdAt?: string | Date }>;
      }>
    )
      .filter((o) => o.id && (o.customerId || o.customer?.id))
      .map((o) => {
        const lastQuote = o.quotes?.[0];
        const lastIx = o.interactions?.[0]?.createdAt;
        return {
          id: o.id!,
          customerId: (o.customerId ?? o.customer?.id)!,
          customerName: o.customer?.name ?? UNKNOWN_CUSTOMER_PLACEHOLDER,
          email: o.customer?.email ?? null,
          stage: o.stage,
          estimatedValue: o.estimatedValue,
          nextFollowupAt: o.nextFollowupAt,
          updatedAt: o.updatedAt,
          expectedCloseDate: o.installDate ?? o.measureDate ?? null,
          lastInteractionAt: lastIx ?? null,
          quoteSentAt: lastQuote?.sentAt ?? lastQuote?.updatedAt ?? null,
        };
      });

    // DURABLE_FOLLOWUP_M1：客户跟进持久任务按用户要求的数量取不同客户，
    // 并对用户附件中提及的客户做可解释加权；legacy run 行为不变（limit 3）
    const followupRun = await loadFollowupRun(ctx);
    const attachment = followupRun ? findAttachmentEvidence(prior) : null;
    const rankedRaw = prioritizeFollowups({
      opportunities,
      followupAnalysis,
      quoteRiskAnalysis,
      limit: followupRun ? 15 : 3,
      ...(attachment && attachment.customerIds.length > 0
        ? {
            focus: {
              customerIds: attachment.customerIds,
              ref: attachment.refs[0] ?? "attachment",
            },
          }
        : {}),
    });
    const ranked = followupRun
      ? (() => {
          const prioritized = uniqueByCustomer(rankedRaw.prioritized).slice(
            0,
            followupRun.followup.topN,
          );
          return { ...rankedRaw, prioritized, selectedCount: prioritized.length };
        })()
      : rankedRaw;
    const names = ranked.prioritized
      .map((p) => `${p.customerName}(${p.score})`)
      .join("、");
    return {
      ok: true,
      data: {
        ...ranked,
        operationKey: ctx.operationKey,
        summary: truncateText(
          ranked.prioritized.length > 0
            ? `选出 ${ranked.prioritized.length} 个优先跟进客户：${names}`
            : "无需要优先跟进的客户",
          300,
        ),
      },
    };
  },

  grader_create_followup_task: async (ctx) => {
    // #89：优先客户按语义形状识别（不再读字面 s5_prioritize）
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    if (prioritized.length === 0) {
      return { ok: true, data: { skipped: true, reason: "无优先客户" } };
    }
    return reminderTimeRequired("跟进提醒时间", Math.min(prioritized.length, 3));
  },

  sales_update_followup: async (ctx) => {
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const withOpp = prioritized.filter((t) => t.opportunityId).slice(0, 2);
    if (withOpp.length === 0) {
      return { ok: true, data: { skipped: true, reason: "无可改期商机" } };
    }
    return reminderTimeRequired("下次跟进时间", withOpp.length);
  },

  gmail_create_draft: async (ctx) => {
    if (!isGmailDraftEnabled()) {
      return {
        ok: false,
        error: "FEATURE_NOT_CONFIGURED: GMAIL_DRAFT_DISABLED",
      };
    }
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const withEmail = prioritized.filter((t) => t.email).slice(0, 3);
    if (withEmail.length === 0) {
      return { ok: true, data: { skipped: true, reason: "优先客户无邮箱" } };
    }
    const actionIds: string[] = [];
    for (const t of withEmail) {
      const { subject, body } = neutralFollowupEmailContent(t.customerName);
      const idempotencyKey = buildRuntimeV2OperationKey({
        runId: ctx.runId,
        stepKey: ctx.stepKey,
        actionType: "grader.email_draft",
        targetId: t.customerId,
      });
      const draft = await createDraft({
        type: "grader.email_draft",
        title: `邮件草稿：${t.email}`,
        preview: subject,
        payload: {
          to: t.email,
          subject,
          body,
          targetType: "CUSTOMER",
          targetId: t.customerId,
          source: "GRADER",
          metadata: {
            orgId: ctx.orgId,
            customerId: t.customerId,
            source: "agent_runtime_v2",
            stepKey: ctx.stepKey,
            idempotencyKey,
          },
        },
        userId: ctx.userId,
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        threadId: ctx.threadId ?? undefined,
        messageId: ctx.assistantMessageId ?? undefined,
        idempotencyKey,
      });
      const id = draftActionId(draft);
      if (id) actionIds.push(id);
    }
    if (actionIds.length === 0) {
      return { ok: false, error: "创建 Gmail 草稿 PendingAction 失败" };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: {
        pendingActionIds: actionIds,
        count: actionIds.length,
        summary: `已创建 ${actionIds.length} 封邮件草稿，等待审批`,
      },
    };
  },

  // #88 新增（曾为 ghost tool）：日历提醒草稿。计划步骤不携带用户明确
  // 时间 → 恒 fail-closed 跳过（REMINDER_TIME_REQUIRED）；本 adapter
  // 本身零外部副作用（绝不直连 Google Calendar）。
  calendar_create_event_draft: async (ctx) => {
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const targets = prioritized.slice(0, 3);
    if (targets.length === 0) {
      return {
        ok: true,
        data: { skipped: true, reason: "无可安排日历提醒的优先客户" },
      };
    }
    return reminderTimeRequired("日历提醒时间", targets.length);
  },

  // ── DURABLE_FOLLOWUP_M1：客户跟进持久任务专用（catalog serverPlanOnly，
  // LLM Planner 不可见）。全部 org-scoped；非本契约 run 调用一律 fail-closed。──

  sales_followup_attachment_evidence: async (ctx) => {
    const fr = await loadFollowupRun(ctx);
    if (!fr) return { ok: false, error: NOT_FOLLOWUP_TASK };
    const f = fr.followup;
    // 附件只对发起人本人可见：执行主体必须是发起人
    if (!f.initiatedByUserId || f.initiatedByUserId !== ctx.userId) {
      return {
        ok: false,
        error: "ATTACHMENT_ACCESS_DENIED: 执行主体不是任务发起人",
      };
    }
    if (!fr.userMessageId) {
      return {
        ok: true,
        data: {
          attachmentEvidence: true,
          attachments: [],
          customerMatches: [],
          summary: "本任务没有附带资料",
        },
      };
    }
    const msg = await db.aiMessage.findFirst({
      where: { id: fr.userMessageId, role: "user" },
      select: {
        id: true,
        attachments: true,
        thread: { select: { id: true, orgId: true, userId: true } },
      },
    });
    // 归属三重校验：组织 + 发起人 + 对话（绝不凭客户端路径或 orgId 放行）
    if (
      !msg ||
      msg.thread.orgId !== ctx.orgId ||
      msg.thread.userId !== f.initiatedByUserId ||
      (f.threadId !== null && msg.thread.id !== f.threadId)
    ) {
      return {
        ok: false,
        error:
          "ATTACHMENT_ACCESS_DENIED: 附件所在消息不属于本任务的组织 / 发起人 / 对话",
      };
    }
    const stored = readStoredAttachments(msg.attachments);
    const usable = stored
      .map((a, i) => ({ a, i }))
      .filter(
        ({ a }) => !a.blobPath || attachmentBlobPathBelongsTo(a.blobPath, ctx.orgId),
      );
    // 附件正文是不可信业务资料：只做字符串匹配，不进入任何提示词 / 指令
    const corpus = usable
      .map(({ a }) => `${a.name}\n${a.text}`)
      .join("\n")
      .slice(0, 200_000);
    const emails = Array.from(
      new Set(
        (corpus.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map(
          (e) => e.toLowerCase(),
        ),
      ),
    ).slice(0, 30);
    const byEmail =
      emails.length > 0
        ? await db.salesCustomer.findMany({
            where: {
              orgId: ctx.orgId,
              archivedAt: null,
              OR: emails.map((e) => ({
                email: { equals: e, mode: "insensitive" as const },
              })),
            },
            select: { id: true, name: true },
            take: 20,
          })
        : [];
    const recent = await db.salesCustomer.findMany({
      where: { orgId: ctx.orgId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    const matches: Array<{
      customerId: string;
      customerName: string;
      matchedBy: "email" | "name";
    }> = [];
    for (const c of byEmail) {
      matches.push({ customerId: c.id, customerName: c.name, matchedBy: "email" });
    }
    for (const c of recent) {
      const name = (c.name ?? "").trim();
      if (name.length < 2 || !corpus.includes(name)) continue;
      if (matches.some((m) => m.customerId === c.id)) continue;
      matches.push({ customerId: c.id, customerName: c.name, matchedBy: "name" });
    }
    const bounded = matches.slice(0, 10);
    const attachments = usable.map(({ a, i }) => ({
      ref: `ai_message:${msg.id}#attachment:${i}`,
      name: a.name.slice(0, 200),
      kind: a.kind ?? "document",
      chars: a.text.length,
    }));
    return {
      ok: true,
      data: {
        attachmentEvidence: true,
        untrusted: true,
        attachments,
        excludedForeignAttachments: stored.length - usable.length,
        customerMatches: bounded,
        summary: truncateText(
          `读取 ${attachments.length} 份资料；匹配到组织内客户 ${bounded.length} 个${
            bounded.length > 0 ? `：${bounded.map((m) => m.customerName).join("、")}` : ""
          }`,
          300,
        ),
      },
    };
  },

  sales_followup_carry_targets: async (ctx) => {
    const fr = await loadFollowupRun(ctx);
    if (!fr) return { ok: false, error: NOT_FOLLOWUP_TASK };
    const f = fr.followup;
    if (!f.parentRunId) {
      return { ok: false, error: "CARRY_PARENT_MISSING: 续接任务缺少父任务" };
    }
    if (!f.initiatedByUserId || f.initiatedByUserId !== ctx.userId) {
      return { ok: false, error: "CARRY_PARENT_DENIED: 执行主体不是任务发起人" };
    }
    const parent = await db.agentRun.findFirst({
      where: { id: f.parentRunId, orgId: ctx.orgId, runType: "workforce_job" },
      select: {
        id: true,
        metadata: true,
        steps: {
          where: {
            preferredTool: "sales_prioritize_followups",
            status: "completed",
          },
          select: { outputJson: true },
          take: 1,
        },
      },
    });
    const pf = parent ? readFollowupRunContext(parent.metadata) : null;
    if (
      !parent ||
      !pf ||
      pf.initiatedByUserId !== f.initiatedByUserId ||
      pf.threadId !== f.threadId
    ) {
      return {
        ok: false,
        error: "CARRY_PARENT_DENIED: 父任务不属于同一组织 / 发起人 / 对话",
      };
    }
    const out = parent.steps[0]?.outputJson as
      | { prioritized?: unknown }
      | null
      | undefined;
    if (!out || !Array.isArray(out.prioritized)) {
      return {
        ok: false,
        error: "CARRY_PARENT_NOT_READY: 父任务尚未完成客户排序",
      };
    }
    let carried = uniqueByCustomer(
      (out.prioritized as Array<Record<string, unknown>>).filter(
        (p): p is Record<string, unknown> & { customerId: string } =>
          !!p && typeof p.customerId === "string",
      ),
    ).slice(0, pf.topN);
    if (f.targetCustomerIds.length > 0) {
      carried = carried.filter((p) => f.targetCustomerIds.includes(p.customerId));
    }
    // 现查：客户仍属本组织且未归档；姓名/邮箱以当前记录为准
    const live = await db.salesCustomer.findMany({
      where: {
        orgId: ctx.orgId,
        archivedAt: null,
        id: { in: carried.map((p) => p.customerId) },
      },
      select: { id: true, name: true, email: true },
    });
    const liveById = new Map(live.map((c) => [c.id, c]));
    const prioritized = carried
      .filter((p) => liveById.has(p.customerId))
      .map((p) => {
        const c = liveById.get(p.customerId)!;
        return { ...p, customerName: c.name, email: c.email ?? null };
      });
    return {
      ok: true,
      data: {
        prioritized,
        carriedFromRunId: parent.id,
        droppedCount: carried.length - prioritized.length,
        summary: truncateText(
          `沿用上次任务选出的 ${prioritized.length} 个客户：${prioritized
            .map((p) => p.customerName)
            .join("、")}`,
          300,
        ),
      },
    };
  },

  sales_prepare_followup_actions: async (ctx) => {
    const fr = await loadFollowupRun(ctx);
    if (!fr) return { ok: false, error: NOT_FOLLOWUP_TASK };
    if (fr.status === "cancelled") {
      return { ok: false, error: "RUN_CANCELLED: 任务已取消，不再生成待确认动作" };
    }
    const f = fr.followup;
    // 恢复执行始终以发起人当前有效身份进行（审批人不扩大权限）
    if (!f.initiatedByUserId || f.initiatedByUserId !== ctx.userId) {
      return { ok: false, error: "PRINCIPAL_MISMATCH: 只能以任务发起人身份准备动作" };
    }
    let targets = uniqueByCustomer(findPrioritizedEvidence(ctx.priorEvidence)).slice(
      0,
      f.topN,
    );
    if (f.targetCustomerIds.length > 0) {
      targets = targets.filter((t) => f.targetCustomerIds.includes(t.customerId));
    }
    const wantsEmail =
      f.deliverables.includes("email_drafts") && !f.emailUnavailable && !f.parentRunId;
    const schedule = followupReminderSchedule(f);
    if (targets.length === 0 || (!wantsEmail && !schedule)) {
      return {
        ok: true,
        data: {
          skipped: true,
          items: [],
          reason: targets.length === 0 ? "无优先客户" : "没有需要准备的动作",
          summary: targets.length === 0 ? "没有需要准备动作的客户" : "没有需要准备的动作",
        },
      };
    }

    const gmailOn = isGmailDraftEnabled();
    const items: Array<{
      kind: "email_draft" | "reminder";
      customerId: string;
      customerName: string;
      pendingActionId: string | null;
      skippedReason?: string;
    }> = [];
    const actionIds: string[] = [];
    let creationFailed = false;

    for (const t of targets) {
      if (wantsEmail) {
        if (!gmailOn) {
          items.push({
            kind: "email_draft",
            customerId: t.customerId,
            customerName: t.customerName,
            pendingActionId: null,
            skippedReason: "Gmail 草稿功能未开启",
          });
        } else if (!t.email) {
          items.push({
            kind: "email_draft",
            customerId: t.customerId,
            customerName: t.customerName,
            pendingActionId: null,
            skippedReason: "客户缺少邮箱",
          });
        } else {
          const { subject, body } = followupEmailContent(t.customerName);
          const idempotencyKey = buildRuntimeV2OperationKey({
            runId: ctx.runId,
            stepKey: ctx.stepKey,
            actionType: "grader.email_draft",
            targetId: t.customerId,
          });
          const draft = await createDraft({
            type: "grader.email_draft",
            title: `邮件草稿：${t.customerName}`,
            preview: `收件人 ${t.email} · ${subject}（确认后只在 Gmail 创建草稿，不发送）`,
            payload: {
              to: t.email,
              subject,
              body,
              targetType: "CUSTOMER",
              targetId: t.customerId,
              source: "GRADER",
              metadata: {
                orgId: ctx.orgId,
                customerId: t.customerId,
                source: "assistant_followup_m1",
                stepKey: ctx.stepKey,
                idempotencyKey,
                // 治理命名空间：组织停用 gmail_create_draft 时执行期同样被阻止
                toolName: "gmail_create_draft",
              },
            },
            userId: ctx.userId,
            orgId: ctx.orgId,
            agentRunId: ctx.runId,
            threadId: ctx.threadId ?? undefined,
            messageId: ctx.assistantMessageId ?? undefined,
            idempotencyKey,
          });
          const id = draftActionId(draft);
          if (!id) creationFailed = true;
          else actionIds.push(id);
          items.push({
            kind: "email_draft",
            customerId: t.customerId,
            customerName: t.customerName,
            pendingActionId: id,
          });
        }
      }
      if (schedule) {
        const startTime = schedule.startAt;
        const endTime = new Date(
          new Date(startTime).getTime() + 30 * 60_000,
        ).toISOString();
        const local = formatInTimezone(startTime, schedule.timezone);
        const idempotencyKey = buildRuntimeV2OperationKey({
          runId: ctx.runId,
          stepKey: ctx.stepKey,
          actionType: "calendar.create_event",
          targetId: t.customerId,
        });
        const draft = await createDraft({
          type: "calendar.create_event",
          title: `跟进提醒：${t.customerName}`,
          preview: `${local}（${schedule.timezone}）跟进 ${t.customerName}`,
          payload: {
            title: `跟进提醒：${t.customerName}`,
            description: (t.reasons ?? []).slice(0, 3).join("；") || "客户跟进提醒",
            startTime,
            endTime,
            metadata: {
              orgId: ctx.orgId,
              customerId: t.customerId,
              opportunityId: t.opportunityId,
              source: "assistant_followup_m1",
              stepKey: ctx.stepKey,
              idempotencyKey,
              timezone: schedule.timezone,
              toolName: "calendar_create_event_draft",
            },
          },
          userId: ctx.userId,
          orgId: ctx.orgId,
          agentRunId: ctx.runId,
          threadId: ctx.threadId ?? undefined,
          messageId: ctx.assistantMessageId ?? undefined,
          idempotencyKey,
        });
        const id = draftActionId(draft);
        if (!id) creationFailed = true;
        else actionIds.push(id);
        items.push({
          kind: "reminder",
          customerId: t.customerId,
          customerName: t.customerName,
          pendingActionId: id,
        });
      }
    }

    // 取消竞态：落库后复查；任务已取消则立即撤回本次生成的待确认动作
    const after = await db.agentRun.findFirst({
      where: { id: ctx.runId, orgId: ctx.orgId },
      select: { status: true },
    });
    if (after?.status === "cancelled") {
      const { rejectPendingActionsForAgentRun } = await import(
        "@/lib/agent-runtime/pending-link"
      );
      await rejectPendingActionsForAgentRun({
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        reason: "关联任务已取消，待确认动作已拒绝",
      });
      return { ok: false, error: "RUN_CANCELLED: 任务已取消，已撤回待确认动作" };
    }
    // 任一创建失败 → 可重试失败；幂等键保证重试不会重复创建已成功的动作
    if (creationFailed) {
      return { ok: false, error: "DRAFT_CREATION_FAILED: 部分待确认动作创建失败，将重试" };
    }
    const emailCount = items.filter((i) => i.kind === "email_draft" && i.pendingActionId).length;
    const reminderCount = items.filter((i) => i.kind === "reminder" && i.pendingActionId).length;
    const summary = `已准备 ${emailCount} 个邮件草稿、${reminderCount} 个提醒，等待逐项确认`;
    if (actionIds.length === 0) {
      return { ok: true, data: { skipped: true, items, summary: "没有可生成的待确认动作" } };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: { pendingActionIds: actionIds, items, count: actionIds.length, summary },
    };
  },

  // ── Tender T1B（internal-only 工具组）：可执行但不入
  // RUNTIME_V2_TOOL_CATALOG（EXECUTABLE ⊋ PLANNER_VISIBLE 方向，上方
  // 注释明确允许）。仅 tender workforce job 经 workforce-runtime/scope
  // 的域白名单在规划期可见；handler 执行期自证 workDomain=tender，
  // 非 tender run 调用 fail-closed。业务写入全走 canonical tender service。
  ...TENDER_WORKFORCE_TOOL_HANDLERS,
};

/** server-authoritative 可执行判定（#88 §6）：有 handler ⇔ 可执行 */
export function isRuntimeV2ToolExecutable(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    RUNTIME_V2_TOOL_HANDLERS,
    toolName,
  );
}

/** 可执行工具全集（含未来 internal-only 工具；允许 ⊋ planner 可见集） */
export function listExecutableRuntimeV2ToolNames(): string[] {
  return Object.keys(RUNTIME_V2_TOOL_HANDLERS);
}

export async function executeRuntimeV2Tool(
  toolName: string,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const handler = RUNTIME_V2_TOOL_HANDLERS[toolName];
  if (!handler) {
    return { ok: false, error: `Unsupported tool: ${toolName}` };
  }
  return handler(ctx);
}
