/**
 * Workforce Job 规划期工具白名单解析（Tender T1B §12 / §15 "tool scope"）
 *
 * server-owned、声明式：按 Job metadata.workDomain 返回该域的 planner
 * 可见工具子集（PlannerInput.availableTools 既有参数）。这是规划输入
 * 选择，不是执行语义——executor / CAS / fencing / verifier / approval
 * 全部不感知本模块。
 *
 * fail-safe：无 workDomain / 未注册的域 → undefined → planner 走既有
 * 默认投影（plannerVisibleRuntimeV2Tools），对既有 Job 行为逐字节不变。
 *
 * 域注册表刻意用 dynamic import：域模块（tender-workforce）依赖
 * workforce-runtime（job 创建），静态反向导入会成环。
 */

import type { ToolDescriptor } from "@/lib/agent-runtime-v2/schemas";

export const WORKFORCE_PLANNER_SCOPED_DOMAINS = ["tender"] as const;

export async function resolveWorkforcePlannerToolsForJob(
  metadata: Record<string, unknown> | null | undefined,
): Promise<ToolDescriptor[] | undefined> {
  const workDomain =
    metadata && typeof metadata.workDomain === "string"
      ? metadata.workDomain
      : null;
  if (workDomain === "tender") {
    const { tenderWorkforcePlannerTools } = await import(
      "@/lib/tender-workforce/tools"
    );
    return tenderWorkforcePlannerTools();
  }
  return undefined;
}
