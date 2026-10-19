/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 跟进任务成果投影（纯函数，客户端可安全导入）
 *
 * 输入只来自数据库事实：AgentRun（状态/metadata）、AgentRunStep（工具输出）、
 * PendingAction（状态 / resultRef / failureReason）。模型自述永远不是输入。
 *
 * 必须区分（任务书 §七）：已生成建议 / 已准备预览且等待批准 / 已批准但尚未执行 /
 * 已创建外部草稿 / 已建立提醒 / 部分完成 / 执行失败 / 已取消。
 *   - approved ≠ executed；executed 但缺少回执（resultRef）≠ 已创建；
 *   - 降级（PARTIAL）分析证据不能算"已完成"；
 *   - 有任何未完成 / 未执行 / 超出边界的请求时，总状态绝不是 completed。
 */

import {
  FOLLOWUP_STEP,
  FOLLOWUP_TOOL,
  FOLLOWUP_UNSUPPORTED_LABEL,
  readFollowupRunContext,
  type FollowupMissingInput,
  type FollowupRunContext,
} from "./followup-contract";

export type FollowupOverallState =
  | "in_progress"
  | "waiting_for_confirmation"
  | "needs_input"
  | "partially_completed"
  | "completed"
  | "failed"
  | "cancelled";

export type FollowupItemState =
  | "awaiting_approval"
  | "approved_not_executed"
  | "draft_created"
  | "reminder_created"
  | "executed_without_receipt"
  | "rejected"
  | "expired"
  | "failed"
  | "cancelled"
  | "skipped";

export type FollowupActionItem = {
  kind: "email_draft" | "reminder";
  customerId: string;
  customerName: string;
  pendingActionId: string | null;
  state: FollowupItemState;
  /** 外部 / 业务回执：Gmail draftId 或 CalendarEvent.id（仅 executed 时） */
  resultRef: string | null;
  reason: string | null;
};

export type FollowupCustomer = {
  customerId: string;
  customerName: string;
  score: number | null;
  reasons: string[];
  evidenceRefs: string[];
  hasEmail: boolean;
};

export type FollowupOutcome = {
  contract: string;
  overall: FollowupOverallState;
  overallLabel: string;
  headline: string;
  analysis: {
    state: "pending" | "running" | "completed" | "degraded" | "failed" | "carried";
    customers: FollowupCustomer[];
    opportunityCount: number | null;
    carriedFromRunId: string | null;
  };
  quoteRisk: {
    state: "pending" | "completed" | "degraded" | "failed" | "not_applicable";
    summary: string | null;
    issues: Array<{ title: string; severity: string | null }>;
    refs: string[];
  };
  attachments: null | {
    state: "pending" | "completed" | "failed";
    items: Array<{ ref: string; name: string; kind: string; chars: number }>;
    matchedCustomers: Array<{ customerId: string; customerName: string }>;
  };
  emailDrafts: {
    requested: boolean;
    state: "not_requested" | "unavailable" | "pending" | "prepared";
    unavailableReason: string | null;
    items: FollowupActionItem[];
  };
  reminders: {
    requested: boolean;
    state: "not_requested" | "needs_input" | "continued" | "pending" | "prepared";
    missing: FollowupMissingInput[];
    scheduledAt: string | null;
    timezone: string | null;
    continuedByRunId: string | null;
    items: FollowupActionItem[];
  };
  notPerformed: Array<{ code: string; label: string }>;
  nextActions: string[];
  parentRunId: string | null;
};

export type FollowupOutcomeInput = {
  run: {
    id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    metadata: unknown;
  };
  steps: Array<{
    stepKey: string;
    preferredTool: string | null;
    status: string;
    outputJson: unknown;
    errorMessage: string | null;
  }>;
  pendingActions: Array<{
    id: string;
    type: string;
    status: string;
    resultRef: string | null;
    failureReason: string | null;
    expiresAt: Date | string | null;
  }>;
  /** 本任务的提醒已由同一对话中的续接任务承接（只读引用） */
  continuedByRunId?: string | null;
  now?: Date;
};

export const FOLLOWUP_OVERALL_LABEL: Record<FollowupOverallState, string> = {
  in_progress: "进行中",
  waiting_for_confirmation: "等待你确认",
  needs_input: "需要你补充信息",
  partially_completed: "部分完成",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export const FOLLOWUP_ITEM_LABEL: Record<FollowupItemState, string> = {
  awaiting_approval: "已准备预览，等待你确认",
  approved_not_executed: "已批准，尚未执行完成",
  draft_created: "已在 Gmail 创建草稿（未发送）",
  reminder_created: "已建立提醒",
  executed_without_receipt: "执行结果缺少回执，未计为完成",
  rejected: "你已拒绝",
  expired: "确认已过期，未执行",
  failed: "执行失败",
  cancelled: "任务已取消，未执行",
  skipped: "未生成",
};

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "acknowledged",
  "planning",
  "planned",
  "running",
  "executing",
  "verifying",
  "repairing",
]);

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function findStep(
  steps: FollowupOutcomeInput["steps"],
  tool: string,
  key: string,
) {
  return steps.find((s) => s.preferredTool === tool) ?? steps.find((s) => s.stepKey === key);
}

function isDegraded(out: unknown): boolean {
  const o = rec(out);
  return !!o && (o.degraded === true || o.evidenceQuality === "PARTIAL");
}

function itemStateFor(
  kind: FollowupActionItem["kind"],
  pa: FollowupOutcomeInput["pendingActions"][number] | undefined,
  now: Date,
): { state: FollowupItemState; reason: string | null; resultRef: string | null } {
  if (!pa) return { state: "failed", reason: "找不到对应的待确认动作记录", resultRef: null };
  switch (pa.status) {
    case "pending": {
      const exp = pa.expiresAt ? new Date(pa.expiresAt) : null;
      if (exp && exp.getTime() < now.getTime()) {
        return { state: "expired", reason: "已超过确认期限", resultRef: null };
      }
      return { state: "awaiting_approval", reason: null, resultRef: null };
    }
    case "approved":
      return { state: "approved_not_executed", reason: null, resultRef: null };
    case "executed":
      if (!pa.resultRef) {
        return {
          state: "executed_without_receipt",
          reason: "执行记录缺少外部回执",
          resultRef: null,
        };
      }
      return {
        state: kind === "email_draft" ? "draft_created" : "reminder_created",
        reason: null,
        resultRef: pa.resultRef,
      };
    case "rejected":
      return /取消/.test(pa.failureReason ?? "")
        ? { state: "cancelled", reason: pa.failureReason, resultRef: null }
        : { state: "rejected", reason: pa.failureReason, resultRef: null };
    case "failed":
      return /过期/.test(pa.failureReason ?? "")
        ? { state: "expired", reason: pa.failureReason, resultRef: null }
        : { state: "failed", reason: pa.failureReason, resultRef: null };
    default:
      return { state: "failed", reason: `未知状态：${pa.status}`, resultRef: null };
  }
}

const SUCCESS_ITEM_STATES: ReadonlySet<FollowupItemState> = new Set([
  "draft_created",
  "reminder_created",
]);
const OPEN_ITEM_STATES: ReadonlySet<FollowupItemState> = new Set([
  "awaiting_approval",
  "approved_not_executed",
]);

function readCustomers(out: unknown): FollowupCustomer[] {
  return arr(rec(out)?.prioritized)
    .map((p) => rec(p))
    .filter((p): p is Record<string, unknown> => !!p && typeof p.customerId === "string")
    .map((p) => ({
      customerId: p.customerId as string,
      customerName: strOrNull(p.customerName) ?? "未知客户",
      score: typeof p.score === "number" ? p.score : null,
      reasons: arr(p.reasons).filter((r): r is string => typeof r === "string").slice(0, 6),
      evidenceRefs: arr(p.evidenceRefs)
        .filter((r): r is string => typeof r === "string")
        .slice(0, 10),
      hasEmail: typeof p.email === "string" && p.email.length > 0,
    }));
}

export function projectFollowupOutcome(
  input: FollowupOutcomeInput,
): FollowupOutcome | null {
  const ctx: FollowupRunContext | null = readFollowupRunContext(input.run.metadata);
  if (!ctx) return null;
  const now = input.now ?? new Date();
  const runStatus = input.run.status;
  const runActive = ACTIVE_RUN_STATUSES.has(runStatus);
  const isContinuation = !!ctx.parentRunId;

  // ── 分析 ──
  const prioritizeStep = isContinuation
    ? findStep(input.steps, FOLLOWUP_TOOL.carryTargets, FOLLOWUP_STEP.carryTargets)
    : findStep(input.steps, FOLLOWUP_TOOL.prioritize, FOLLOWUP_STEP.prioritize);
  const followupStep = findStep(
    input.steps,
    FOLLOWUP_TOOL.followupAnalysis,
    FOLLOWUP_STEP.followupAnalysis,
  );
  const quoteStep = findStep(input.steps, FOLLOWUP_TOOL.quoteRisk, FOLLOWUP_STEP.quoteRisk);
  const oppStep = findStep(
    input.steps,
    FOLLOWUP_TOOL.opportunities,
    FOLLOWUP_STEP.opportunities,
  );
  const customers =
    prioritizeStep && ["completed", "partially_executed"].includes(prioritizeStep.status)
      ? readCustomers(prioritizeStep.outputJson)
      : [];
  let analysisState: FollowupOutcome["analysis"]["state"];
  if (!prioritizeStep) analysisState = runActive ? "pending" : "failed";
  else if (prioritizeStep.status === "completed") {
    analysisState = isContinuation
      ? "carried"
      : isDegraded(followupStep?.outputJson) || isDegraded(quoteStep?.outputJson)
        ? "degraded"
        : "completed";
  } else if (["failed", "blocked", "skipped"].includes(prioritizeStep.status)) {
    analysisState = "failed";
  } else if (prioritizeStep.status === "running") analysisState = "running";
  else analysisState = runActive ? "running" : "failed";
  if (analysisState === "pending" && runStatus === "cancelled") analysisState = "failed";

  const oppOut = rec(oppStep?.outputJson);
  const opportunityCount = Array.isArray(oppOut?.opportunities)
    ? (oppOut!.opportunities as unknown[]).length
    : null;

  // ── 报价风险 ──
  let quoteRisk: FollowupOutcome["quoteRisk"];
  if (isContinuation) {
    quoteRisk = { state: "not_applicable", summary: null, issues: [], refs: [] };
  } else if (!quoteStep || !["completed", "failed", "blocked"].includes(quoteStep.status)) {
    quoteRisk = { state: "pending", summary: null, issues: [], refs: [] };
  } else if (quoteStep.status !== "completed") {
    quoteRisk = {
      state: "failed",
      summary: quoteStep.errorMessage ?? null,
      issues: [],
      refs: [],
    };
  } else {
    const out = rec(quoteStep.outputJson) ?? {};
    const result = rec(out.result);
    const issues = arr(result?.issues)
      .map((i) => rec(i))
      .filter((i): i is Record<string, unknown> => !!i)
      .slice(0, 5)
      .map((i) => ({
        title: strOrNull(i.title) ?? "报价风险",
        severity: strOrNull(i.severity) ?? strOrNull(i.riskLevel),
      }));
    const refs = arr(result?.evidence)
      .map((e) => rec(e))
      .filter((e): e is Record<string, unknown> => !!e && typeof e.sourceId === "string")
      .slice(0, 10)
      .map((e) => `${String(e.sourceType ?? "source").toLowerCase()}:${String(e.sourceId)}`);
    quoteRisk = {
      state: isDegraded(out) ? "degraded" : "completed",
      summary: strOrNull(result?.summary) ?? strOrNull(out.summary),
      issues,
      refs,
    };
  }

  // ── 附件 ──
  const attStep = findStep(
    input.steps,
    FOLLOWUP_TOOL.attachmentEvidence,
    FOLLOWUP_STEP.attachmentEvidence,
  );
  let attachments: FollowupOutcome["attachments"] = null;
  if (ctx.attachmentCount > 0 || attStep) {
    const out = rec(attStep?.outputJson);
    attachments = {
      state:
        attStep?.status === "completed"
          ? "completed"
          : attStep && ["failed", "blocked"].includes(attStep.status)
            ? "failed"
            : "pending",
      items: arr(out?.attachments)
        .map((a) => rec(a))
        .filter((a): a is Record<string, unknown> => !!a && typeof a.ref === "string")
        .map((a) => ({
          ref: a.ref as string,
          name: strOrNull(a.name) ?? "附件",
          kind: strOrNull(a.kind) ?? "document",
          chars: typeof a.chars === "number" ? a.chars : 0,
        })),
      matchedCustomers: arr(out?.customerMatches)
        .map((c) => rec(c))
        .filter((c): c is Record<string, unknown> => !!c && typeof c.customerId === "string")
        .map((c) => ({
          customerId: c.customerId as string,
          customerName: strOrNull(c.customerName) ?? "客户",
        })),
    };
  }

  // ── 写准备（逐客户逐项） ──
  const prepStep = findStep(
    input.steps,
    FOLLOWUP_TOOL.prepareActions,
    FOLLOWUP_STEP.prepareActions,
  );
  const paById = new Map(input.pendingActions.map((p) => [p.id, p]));
  const rawItems = arr(rec(prepStep?.outputJson)?.items)
    .map((i) => rec(i))
    .filter(
      (i): i is Record<string, unknown> =>
        !!i &&
        (i.kind === "email_draft" || i.kind === "reminder") &&
        typeof i.customerId === "string",
    );
  const items: FollowupActionItem[] = rawItems.map((i) => {
    const kind = i.kind as FollowupActionItem["kind"];
    const paId = strOrNull(i.pendingActionId);
    const base = {
      kind,
      customerId: i.customerId as string,
      customerName: strOrNull(i.customerName) ?? "客户",
      pendingActionId: paId,
    };
    if (!paId) {
      return {
        ...base,
        state: "skipped" as const,
        resultRef: null,
        reason: strOrNull(i.skippedReason) ?? "未生成",
      };
    }
    const s = itemStateFor(kind, paById.get(paId), now);
    return { ...base, state: s.state, resultRef: s.resultRef, reason: s.reason };
  });
  const emailItems = items.filter((i) => i.kind === "email_draft");
  const reminderItems = items.filter((i) => i.kind === "reminder");
  const prepDone = !!prepStep && !["pending", "ready", "running"].includes(prepStep.status);

  const emailRequested = ctx.deliverables.includes("email_drafts");
  const emailDrafts: FollowupOutcome["emailDrafts"] = {
    requested: emailRequested,
    state: !emailRequested
      ? "not_requested"
      : ctx.emailUnavailable
        ? "unavailable"
        : prepDone || emailItems.length > 0
          ? "prepared"
          : "pending",
    unavailableReason:
      ctx.emailUnavailable === "gmail_disabled"
        ? "Gmail 草稿功能未开启"
        : ctx.emailUnavailable === "tool_denied"
          ? "当前账号无权使用邮件草稿工具"
          : null,
    items: emailItems,
  };

  const remindersRequested = ctx.deliverables.includes("reminders");
  const reminderNeedsInput = remindersRequested && !ctx.reminderAt && ctx.missing.length > 0;
  const reminders: FollowupOutcome["reminders"] = {
    requested: remindersRequested,
    state: !remindersRequested
      ? "not_requested"
      : reminderNeedsInput
        ? input.continuedByRunId
          ? "continued"
          : "needs_input"
        : prepDone || reminderItems.length > 0
          ? "prepared"
          : "pending",
    missing: reminderNeedsInput ? ctx.missing : [],
    scheduledAt: ctx.reminderAt,
    timezone: ctx.reminderTimezone,
    continuedByRunId: input.continuedByRunId ?? null,
    items: reminderItems,
  };

  const notPerformed = ctx.unsupported.map((code) => ({
    code,
    label: FOLLOWUP_UNSUPPORTED_LABEL[code],
  }));

  // ── 总状态 ──
  let overall: FollowupOverallState;
  const anyOpen = items.some((i) => OPEN_ITEM_STATES.has(i.state));
  const created = items.filter((i) => SUCCESS_ITEM_STATES.has(i.state));
  if (runStatus === "cancelled") overall = "cancelled";
  else if (runStatus === "failed") overall = created.length > 0 ? "partially_completed" : "failed";
  else if (anyOpen) overall = "waiting_for_confirmation";
  else if (runActive) overall = "in_progress";
  else if (analysisState === "failed" && created.length === 0) overall = "failed";
  else {
    const writesOk = items.every((i) => SUCCESS_ITEM_STATES.has(i.state));
    const emailOk = !emailRequested || (emailDrafts.state === "prepared" && emailItems.length > 0);
    const remindersOk =
      !remindersRequested ||
      (reminders.state === "prepared" && reminderItems.length > 0);
    const analysisOk = analysisState === "completed" || analysisState === "carried";
    const runOk = runStatus === "completed";
    if (analysisOk && runOk && customers.length === 0 && notPerformed.length === 0) {
      // 分析完成且确实没有需要优先跟进的客户：这是真实结论，不是缺失成果
      overall = "completed";
    } else if (
      analysisOk &&
      runOk &&
      writesOk &&
      emailOk &&
      remindersOk &&
      notPerformed.length === 0
    ) {
      overall = "completed";
    } else if (
      reminderNeedsInput &&
      !input.continuedByRunId &&
      analysisOk &&
      items.every((i) => !["failed", "executed_without_receipt"].includes(i.state))
    ) {
      overall = "needs_input";
    } else {
      overall = "partially_completed";
    }
  }

  // ── 文案 ──
  const draftsCreated = emailItems.filter((i) => i.state === "draft_created").length;
  const remindersCreated = reminderItems.filter((i) => i.state === "reminder_created").length;
  const openCount = items.filter((i) => OPEN_ITEM_STATES.has(i.state)).length;
  const deliveredBits: string[] = [];
  if (customers.length > 0) {
    deliveredBits.push(
      isContinuation
        ? `沿用上次选出的 ${customers.length} 个客户`
        : `已选出 ${customers.length} 个优先客户`,
    );
  }
  if (draftsCreated > 0) deliveredBits.push(`已创建 ${draftsCreated} 个 Gmail 草稿（未发送）`);
  if (remindersCreated > 0) deliveredBits.push(`已建立 ${remindersCreated} 个提醒`);
  // 未完成项按原因分开说（"你拒绝的"与"执行失败的"不是一回事）
  const countOf = (states: FollowupItemState[]) =>
    items.filter((i) => states.includes(i.state)).length;
  const unfinishedBits = [
    [countOf(["failed", "executed_without_receipt"]), "执行失败"],
    [countOf(["rejected"]), "你已拒绝"],
    [countOf(["expired"]), "确认已过期"],
    [countOf(["cancelled"]), "随任务取消"],
    [countOf(["skipped"]), "未生成（缺少条件）"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${label} ${n} 项`);

  let headline: string;
  switch (overall) {
    case "in_progress":
      headline = "任务在后台进行中，可以离开页面，稍后回来查看";
      break;
    case "waiting_for_confirmation":
      headline = `等待你确认 ${openCount} 项动作${deliveredBits.length ? `；${deliveredBits.join("，")}` : ""}`;
      break;
    case "needs_input":
      headline = `${deliveredBits.join("，") || "分析已完成"}；提醒需要你补充${
        reminders.missing.includes("timezone") ? "时间与时区" : "具体时间"
      }`;
      break;
    case "completed":
      headline =
        customers.length === 0
          ? "已完成：当前没有需要优先跟进的客户"
          : `已完成：${deliveredBits.join("，")}`;
      break;
    case "partially_completed":
      headline = `部分完成：${deliveredBits.join("，") || "未产生可用成果"}${
        unfinishedBits.length > 0 ? `；${unfinishedBits.join("、")}` : ""
      }${analysisState === "degraded" ? "；分析使用了降级证据" : ""}${
        notPerformed.length > 0 ? `；${notPerformed.length} 项超出本轮边界未执行` : ""
      }`;
      break;
    case "failed":
      headline = `执行失败：${input.run.errorMessage ?? "分析未能完成"}`;
      break;
    case "cancelled":
      headline = `已取消${deliveredBits.length ? `（取消前已发生：${deliveredBits.join("，")}）` : ""}`;
      break;
  }

  const nextActions: string[] = [];
  if (openCount > 0) nextActions.push(`在下方逐项确认或拒绝 ${openCount} 项待确认动作`);
  if (reminders.state === "needs_input") {
    nextActions.push(
      reminders.missing.includes("timezone")
        ? "回复提醒的日期、时间和时区（如「10月20日下午3点 多伦多时间」），可点名客户"
        : "回复提醒的日期和时间（如「10月20日下午3点」），可点名客户",
    );
  }
  if (emailItems.some((i) => i.state === "skipped")) {
    nextActions.push("部分客户缺少邮箱，补充邮箱后可重新发起");
  }
  if (items.some((i) => i.state === "failed")) {
    nextActions.push("查看失败原因（如 Gmail 未连接）处理后重新发起");
  }

  return {
    contract: ctx.contract,
    overall,
    overallLabel: FOLLOWUP_OVERALL_LABEL[overall],
    headline,
    analysis: {
      state: analysisState,
      customers,
      opportunityCount,
      carriedFromRunId: isContinuation ? ctx.parentRunId : null,
    },
    quoteRisk,
    attachments,
    emailDrafts,
    reminders,
    notPerformed,
    nextActions,
    parentRunId: ctx.parentRunId,
  };
}
