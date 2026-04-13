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
export type {
  DynamicSkillDef,
  SkillRunInput,
  SkillRunOutput,
  SkillFeedback,
  SkillOptimizationResult,
} from "./types";
