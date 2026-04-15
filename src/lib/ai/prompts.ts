/**
 * 青砚 AI 系统提示词 — 集中管理
 *
 * 所有 developer / system prompt 在此维护。
 * 按场景拆分，chat route 取 getChatSystemPrompt()，
 * 后续 analysis / report 场景各取各的。
 *
 * 实际实现已拆分到 ./prompts/ 目录，此文件为向后兼容的 barrel。
 */

export * from "./prompts/types";
export * from "./prompts/common";
export * from "./prompts/sales";
export * from "./prompts/trade";
export * from "./prompts/agent";
export * from "./prompts/project";
