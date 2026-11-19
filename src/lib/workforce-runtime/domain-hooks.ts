/**
 * CHAIN-0c — Job 停下（failed / needs_human）之后的域收尾钩子
 *
 * 处理器在「状态写入成功」之后调用。按 Job metadata.workDomain 动态加载域模块
 * （与 scope.ts 同一做法：域模块依赖 workforce-runtime，静态反向导入会成环）。
 *
 * 纪律：只做收尾，不改 Job 状态、不重试、不排队；任何错误只记日志、不向上抛，
 * 处理器的返回值与不调用本钩子时相同。没有开关（修「失败不提示」不应该能关掉）。
 */

import { db } from "@/lib/db";

export async function onWorkforceJobStopped(input: { runId: string }): Promise<void> {
  try {
    const run = await db.agentRun.findUnique({ where: { id: input.runId }, select: { metadata: true } });
    const meta = (run?.metadata && typeof run.metadata === "object" ? run.metadata : {}) as Record<string, unknown>;
    if (meta.workDomain === "tender") {
      const { surfaceTenderJobStopped } = await import("@/lib/tender-workforce/job-failure-surfacing");
      await surfaceTenderJobStopped(input.runId);
    }
  } catch (err) {
    console.warn("[workforce] job stopped hook failed (job state unaffected):", err instanceof Error ? err.message : String(err));
  }
}
