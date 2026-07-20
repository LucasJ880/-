/**
 * 动态技能系统 — 统一入口
 */

export { runSkill, recordFeedback, listOrgSkills } from "./runtime";
export { optimizeSkill, getSkillStats } from "./learner";
export { seedBuiltinSkills } from "./seed";
export {
  proposeSkillFromPatterns,
  proposeSkillFromDescription,
  createSkillFromProposal,
} from "./auto-creator";
export { ENTERPRISE_SKILLS } from "./enterprise-index";
export { DIGITAL_EMPLOYEE_ROLES } from "./digital-employee-roles";
export {
  materializeSkillPendingActions,
  collectPendingProposals,
  buildSkillPendingIdempotencyKey,
  buildAgentSkillActionSource,
  SKILL_PENDING_ACTION_ALLOWLIST,
} from "./pending-action-bridge";
export type { AgentSkillActionSource } from "./pending-action-bridge";
export type {
  DynamicSkillDef,
  SkillRunInput,
  SkillRunOutput,
  SkillFeedback,
  SkillOptimizationResult,
} from "./types";
export type { EnterpriseSkillSeed } from "./enterprise-types";
