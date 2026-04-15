/**
 * project_progress_summary — 独立 doc_type 生成器
 *
 * 生成面向项目负责人 / 管理层 / 演示场景的简版管理摘要。
 * 不是聊天回复，不是流水账，而是一份可直接阅读、可审核的决策支持文档。
 */

export type { ProgressSummaryOutput } from "./summary-prompt";
export {
  type ProgressSummaryMeta,
  type ProgressSummaryResult,
  type TriggerType,
  generateProgressSummary,
  getLatestSummary,
  getSummaryHistory,
  updateSummaryReview,
} from "./summary-builder";
