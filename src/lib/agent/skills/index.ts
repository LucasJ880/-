/**
 * 技能加载入口 — import 即触发注册
 */

import "./project-understanding";
import "./quote";
import "./progress-summary";
import "./risk-scan";
import "./intelligence-report";
import "./document-summary";
import "./email-draft";
import "./supply-chain-analysis";
import "./tender-analysis";
import "./sales-followup";

export {
  registerSkill,
  getSkill,
  listSkills,
  getSkillsForOrchestrator,
  getSkillCount,
} from "./registry";
