/**
 * B5（安全修复）— Supervisor cancel 端点门：租户 + run 类型 + actor + 状态。
 *
 * 修复前 /api/agent-supervisor/runs/[id] 的 cancel 分支直接
 * `cancelAgentRun(orgId, id)`：AgentRun 是多 runtime 共享表，任意活跃
 * org 成员可经该 legacy 端点取消本 org 任何 run——包括 runtime_v2、
 * workforce_job（生产在跑的 Tender 流水线）与其他成员的会话 run，并连带
 * 自动拒绝该 run 的 PendingAction。
 *
 * 不变量（B5 任务书 PART 6）：
 *   cancelTarget ⊆ authorizedRunsFor(principal, org) ∩ supervisorOwnedRuns
 *
 * 门序：租户 scoped 读取 → Supervisor 属主判别 → actor 授权 →
 * 交给既有 canonical 变更原语 cancelAgentRun（终态幂等 + 锁内复核，
 * 单一合法迁移）。本模块不引入新状态机/新事件词表，也绝不 import
 * 冻结的 agent-supervisor 模块（判别只依赖 AgentRun 持久化字段）。
 */

import { db } from "@/lib/db";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { cancelAgentRun } from "./run";
import { AGENT_RUN_TERMINAL_STATUSES } from "./types";

/** 创建路由（POST /api/agent-supervisor/runs）写入的 canonical 判别值 */
export const SUPERVISOR_RUN_TYPE = "supervisor";

/**
 * 其他执行栈的 runType：共享表防护——即使行上意外带了 supervisorState
 * 也一律拒绝，Supervisor 端点绝不触碰别的 runtime 的 run。
 */
export const FOREIGN_RUNTIME_RUN_TYPES: readonly string[] = [
  "runtime_v2",
  "workforce_job",
];

export type SupervisorCancelDecision =
  /** 不存在 / 跨 org / 非 Supervisor run：统一 not_found，不泄漏存在性 */
  | { decision: "not_found" }
  /** 同 org 的 Supervisor run，但 actor 非发起人且非管理员 */
  | { decision: "forbidden" }
  /** 本次调用完成了 running→cancelled 的合法迁移 */
  | { decision: "cancelled"; status: string }
  /** run 已处终态（或与完成竞态由对方胜出）：幂等返回，零变更 */
  | { decision: "already_terminal"; status: string };

/**
 * Supervisor 属主判别（canonical 持久化字段，不凭路由名推断）：
 * - runType === "supervisor"（创建时写入）；或
 * - 历史兼容：supervisorState 非空（仅 agent-supervisor persist 写入），
 *   且 runType 不属于其他执行栈。
 */
export function isSupervisorOwnedRun(run: {
  runType: string;
  supervisorState: unknown;
}): boolean {
  if (FOREIGN_RUNTIME_RUN_TYPES.includes(run.runType)) return false;
  return run.runType === SUPERVISOR_RUN_TYPE || run.supervisorState != null;
}

export async function cancelSupervisorRunGated(input: {
  orgId: string;
  runId: string;
  actor: { userId: string; role?: string | null };
}): Promise<SupervisorCancelDecision> {
  const { orgId, runId, actor } = input;
  if (!orgId?.trim() || !runId?.trim() || !actor?.userId?.trim()) {
    return { decision: "not_found" };
  }

  // 租户 scoped 读取（where 带 orgId，绝不全局查再比对）
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
    select: {
      id: true,
      status: true,
      runType: true,
      supervisorState: true,
      session: { select: { userId: true } },
    },
  });
  if (!run) return { decision: "not_found" };
  if (!isSupervisorOwnedRun(run)) return { decision: "not_found" };

  // actor 授权：run 发起人（session.userId）/ 平台管理员 / 本 org 管理员。
  // orgId 来自服务端解析的活跃组织；这里再以成员资格复核 org 管理员身份。
  let authorized =
    (run.session?.userId != null && run.session.userId === actor.userId) ||
    isSuperAdmin(actor.role);
  if (!authorized) {
    const membership = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: actor.userId } },
      select: { role: true, status: true },
    });
    authorized =
      !!membership &&
      membership.status === "active" &&
      hasOrgRole(membership.role, "org_admin");
  }
  if (!authorized) return { decision: "forbidden" };

  const before = run.status;
  // canonical 变更原语：终态短路幂等 + 锁内复核（与完成竞态时仅一方胜出）
  const after = await cancelAgentRun(orgId, runId);
  const cancelledByThisCall =
    after.status === "cancelled" &&
    !(AGENT_RUN_TERMINAL_STATUSES as readonly string[]).includes(before);
  return cancelledByThisCall
    ? { decision: "cancelled", status: after.status }
    : { decision: "already_terminal", status: after.status };
}
