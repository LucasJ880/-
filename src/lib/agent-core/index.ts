/**
 * Agent Core — 统一 AI Agent 引擎
 *
 * 使用方式：
 *   import { runAgent, registry } from "@/lib/agent-core";
 *
 * 工具注册在 import 时自动完成（side-effect imports in tools/index.ts）。
 */

export { runAgent, runSimple, runAgentStream } from "./engine";
export { registry } from "./tool-registry";
export { toolLabel, needsTools } from "./streaming";
export type { AgentStreamEvent } from "./streaming";
export type {
  ToolDefinition,
  ToolDomain,
  ToolParameterSchema,
  ToolExecutionContext,
  ToolExecutionResult,
  OpenAIToolSpec,
  CoreMessage,
  CoreToolCall,
  AgentRunOptions,
  AgentRunResult,
} from "./types";

// 动态技能系统
export {
  runSkill,
  recordFeedback,
  listOrgSkills,
  optimizeSkill,
  getSkillStats,
  seedBuiltinSkills,
  proposeSkillFromDescription,
  createSkillFromProposal,
} from "./skills";
