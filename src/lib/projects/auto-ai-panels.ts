/**
 * 项目进展摘要 + 投标准备清单一并自动生成（前端触发用事件名常量）
 */

export const AUTO_AI_PANELS_EVENT = "qingyan:auto-generate-ai-panels";

export function requestAutoAiPanels(projectId: string, reason?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTO_AI_PANELS_EVENT, {
      detail: { projectId, reason: reason || "auto" },
    }),
  );
}
