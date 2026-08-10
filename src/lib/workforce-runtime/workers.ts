/**
 * Workforce Worker Registry（Phase 2B-1 §9）
 *
 * server-owned execution/profile registry：Worker 只是"身份 + 角色 + 可承担的
 * taskKind"，不是授权对象。刻意不包含 userId/orgId/scope/permissions/
 * authorized/approval 等任何权限语义字段——Tool 执行的鉴权完整走
 * principal → membership → capability → scopeGuard → tool policy → approval，
 * 与 Worker 身份无关（§12）。
 *
 * Planner 只能从本名单**选择** workerKey（LLM 提议 → 服务端校验，
 * 见 task-contract.ts）；禁止 LLM 创建 worker/role/prompt（§10/§14/§39）。
 *
 * 与 agent-supervisor/worker-registry.ts 的关系：那是 Supervisor 技能线的
 * skill 白名单 registry（runSkill 执行域）；本 registry 服务 Runtime V2
 * workforce_job 的 Task 路由与 prompt 上下文，两者语义不同、互不复用实现，
 * 但沿用同一"配置对象 + 白名单校验"模式。
 */

export type WorkforceTaskKind = "work" | "synthesis";

export const WORKFORCE_TASK_KINDS: readonly WorkforceTaskKind[] = [
  "work",
  "synthesis",
] as const;

export type WorkforceWorkerDefinition = {
  workerKey: string;
  displayName: string;
  role: string;
  description?: string;
  /** 该 Worker 可承担的 taskKind（server 校验：spec.taskKind 必须命中） */
  taskKinds: WorkforceTaskKind[];
};

/**
 * V1 bounded registry（§39：bounded registry only，禁止动态创建）。
 * 当前 Runtime V2 工具目录为销售线，因此 work 默认指派 sales_worker；
 * tender_worker 为投标线预留（registry 项存在不代表有可用工具）。
 */
export const WORKFORCE_WORKER_REGISTRY: Record<
  string,
  WorkforceWorkerDefinition
> = {
  sales_worker: {
    workerKey: "sales_worker",
    displayName: "销售执行数字员工",
    role: "sales_specialist",
    description: "销售管道/客户/报价读取与分析，跟进动作草稿准备（写经审批）",
    taskKinds: ["work"],
  },
  tender_worker: {
    workerKey: "tender_worker",
    displayName: "投标执行数字员工",
    role: "tender_specialist",
    description: "投标要求提取、合规与废标风险分析",
    taskKinds: ["work"],
  },
  synthesis_worker: {
    workerKey: "synthesis_worker",
    displayName: "汇总数字员工",
    role: "synthesis_lead",
    description: "合并多个上游 Task 的结构化 Handoff，产出综合结论",
    taskKinds: ["synthesis"],
  },
};

export function listWorkforceWorkers(): WorkforceWorkerDefinition[] {
  return Object.values(WORKFORCE_WORKER_REGISTRY);
}

export function getWorkforceWorker(
  workerKey: string,
): WorkforceWorkerDefinition | null {
  return WORKFORCE_WORKER_REGISTRY[workerKey] ?? null;
}

export function isKnownWorkforceWorker(workerKey: string): boolean {
  return getWorkforceWorker(workerKey) !== null;
}

/** server 默认指派（planner 未提议时）：deterministic，按 taskKind */
export function defaultWorkerKeyForTaskKind(kind: WorkforceTaskKind): string {
  return kind === "synthesis" ? "synthesis_worker" : "sales_worker";
}

/**
 * Worker 能否承担该 taskKind（unknown worker → false，fail-closed）。
 */
export function workerSupportsTaskKind(
  workerKey: string,
  kind: WorkforceTaskKind,
): boolean {
  const def = getWorkforceWorker(workerKey);
  return def !== null && def.taskKinds.includes(kind);
}

/** Planner prompt 用最小投影（不暴露完整对象结构） */
export function workforceWorkerRosterForPlanner(): Array<{
  workerKey: string;
  role: string;
  description?: string;
  taskKinds: WorkforceTaskKind[];
}> {
  return listWorkforceWorkers().map((w) => ({
    workerKey: w.workerKey,
    role: w.role,
    description: w.description,
    taskKinds: w.taskKinds,
  }));
}
