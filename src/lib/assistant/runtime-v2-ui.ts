/**
 * Runtime V2 Workbench 展示纯函数（可单测，无 React/DOM）
 */

export const RUNTIME_V2_STEP_STATUS_LABEL: Record<string, string> = {
  pending: "等待前序步骤",
  ready: "准备执行",
  running: "正在执行",
  awaiting_approval: "等待确认",
  completed: "已完成",
  partially_executed: "部分完成",
  skipped: "已跳过",
  failed: "执行失败",
  blocked: "无法继续",
};

export type RuntimeV2PrioritizedCustomer = {
  customerName: string;
  score: number;
  reasons: string[];
  evidenceRefs: string[];
};

export type RuntimeV2StepView = {
  title: string;
  status: string;
  preferredTool?: string | null;
  toolName?: string | null;
  attemptCount?: number;
  errorMessage?: string | null;
  requiresApproval?: boolean;
  stepKey?: string | null;
};

export function runtimeV2StepStatusLabel(status: string): string {
  return RUNTIME_V2_STEP_STATUS_LABEL[status] ?? status;
}

export function topReasons(reasons: string[] | null | undefined, n = 3): string[] {
  if (!reasons?.length) return [];
  return reasons.filter((r) => typeof r === "string" && r.trim()).slice(0, n);
}

/** 是否应优先展示 Runtime V2 steps，而非 Legacy AgentTask / agentSteps */
export function preferRuntimeV2Steps(input: {
  runtimeVersion?: string | null;
  runtimeSteps?: unknown[] | null;
}): boolean {
  return (
    input.runtimeVersion === "v2" &&
    Array.isArray(input.runtimeSteps) &&
    input.runtimeSteps.length > 0
  );
}

export function countAwaitingApprovalSteps(
  steps: Array<{ status: string }> | null | undefined,
): number {
  if (!steps?.length) return 0;
  return steps.filter((s) => s.status === "awaiting_approval").length;
}

export function formatRuntimeV2ActionCounts(input: {
  awaitingApprovalSteps: number;
  pendingActions: number;
  executedActions: number;
  rejectedActions: number;
  failedActions: number;
}): string {
  // 与 inline-approval-model.formatAwaitingCopy 对齐
  const parts: string[] = [];
  if (input.awaitingApprovalSteps > 0 || input.pendingActions > 0) {
    parts.push(
      `${input.awaitingApprovalSteps} 个步骤等待确认，共 ${input.pendingActions} 个动作`,
    );
  }
  if (input.executedActions > 0) parts.push(`已执行 ${input.executedActions}`);
  if (input.rejectedActions > 0) parts.push(`已拒绝 ${input.rejectedActions}`);
  if (input.failedActions > 0) parts.push(`失败 ${input.failedActions}`);
  return parts.length ? `${parts.join("，")}。` : "";
}

/** 正文去重：V2 有结构化卡时，去掉与卡片重复的等待确认提示行 */
export function trimDuplicatedRuntimeV2Body(
  content: string,
  opts: { hasRuntimeCard: boolean; hasApprovalCards: boolean },
): string {
  if (!opts.hasRuntimeCard || !content) return content;
  const dropPatterns = [
    /^写操作：等待确认.*$/m,
    /^上述动作正在等待确认.*$/m,
    /^请在下方确认卡中操作.*$/m,
    /^优先客户分析：.*$/m,
    /^已选出 .* 个高优先级客户.*$/m,
  ];
  let next = content;
  for (const re of dropPatterns) {
    next = next.replace(re, "");
  }
  if (opts.hasApprovalCards) {
    next = next.replace(/需要你确认后才会写入[。.]?/g, "");
  }
  next = next
    .split("\n")
    .filter((line) => !/评分\s*\d+/.test(line))
    .filter((line) => !/^\s*[·•]\s+/.test(line))
    .join("\n");
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

/** V2 正文只保留短总结 */
export function shortBodyForV2(content: string, maxLen = 160): string {
  const cleaned = trimDuplicatedRuntimeV2Body(content, {
    hasRuntimeCard: true,
    hasApprovalCards: true,
  });
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}…`;
}

export function extractPrioritizedCustomers(
  output: unknown,
): RuntimeV2PrioritizedCustomer[] {
  if (!output || typeof output !== "object") return [];
  const list = (output as { prioritized?: unknown }).prioritized;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const o = raw as Record<string, unknown>;
      const customerName =
        typeof o.customerName === "string" ? o.customerName : null;
      if (!customerName) return null;
      const score = typeof o.score === "number" ? o.score : Number(o.score ?? 0);
      const reasons = Array.isArray(o.reasons)
        ? o.reasons.filter((r): r is string => typeof r === "string")
        : typeof o.reason === "string"
          ? [o.reason]
          : [];
      const evidenceRefs = Array.isArray(o.evidenceRefs)
        ? o.evidenceRefs.filter((r): r is string => typeof r === "string")
        : [];
      return {
        customerName,
        score: Number.isFinite(score) ? score : 0,
        reasons,
        evidenceRefs,
      };
    })
    .filter((x): x is RuntimeV2PrioritizedCustomer => x != null)
    .slice(0, 3);
}
