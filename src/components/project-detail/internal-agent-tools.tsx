"use client";

/**
 * INTERNAL_ONLY（T1A）：旧 AgentTask 运行时面板与「AI 一键投标方案」
 * 从业务一级 UX 摘除，仅平台管理员可见（运行时内幕：步骤原始 JSON、execute/cancel 等）。
 * Backend 能力保持不变；页面挂载点由 page.tsx 以 isPlatformAdmin 门控。
 */

import { ProjectAgentTasks } from "@/components/agent-tasks/project-agent-tasks";
import { AiBidPackageSection } from "@/components/agent-tasks/ai-bid-package";

export function InternalAgentToolsSection({
  projectId,
  onLegacyTabSwitch,
}: {
  projectId: string;
  /** 旧组件回跳使用 overview/files/quotes 旧值；由 page 统一经别名解析 */
  onLegacyTabSwitch: (legacyTab: string) => void;
}) {
  return (
    <details
      className="rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-3"
      data-testid="internal-agent-tools"
    >
      <summary className="cursor-pointer text-xs font-medium text-muted">
        内部 · AI 任务运行时（仅平台管理员可见）
      </summary>
      <div className="mt-3 space-y-4">
        <AiBidPackageSection projectId={projectId} onTabSwitch={onLegacyTabSwitch} />
        <ProjectAgentTasks projectId={projectId} />
      </div>
    </details>
  );
}
