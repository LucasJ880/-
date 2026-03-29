/**
 * 技能加载入口 — import 即触发注册
 */

import "./project-understanding";
import "./quote-recommend";
import "./quote-draft";
import "./quote-review";
import "./progress-summary";
import "./risk-scan";

export {
  registerSkill,
  getSkill,
  listSkills,
  getSkillsForOrchestrator,
  getSkillCount,
} from "./registry";
