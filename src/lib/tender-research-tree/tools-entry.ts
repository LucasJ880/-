/**
 * 情报调研树的两个工具（登记进 tender-workforce/tools.ts 的执行集合；不进全局目录、不进 LLM 规划面、
 * 不进一键分析的确定性面）。开关判断在处理函数里（tools.ts 不读开关）。
 */

import type { ToolDescriptor } from "@/lib/agent-runtime-v2/schemas";
import { handleResearchBranch } from "./branch-run";
import { handleResearchTrunk } from "./trunk";
import { RESEARCH_BRANCH_TOOL, RESEARCH_TRUNK_TOOL } from "./graph";

export const researchToolNames = [RESEARCH_BRANCH_TOOL, RESEARCH_TRUNK_TOOL] as const;

export const researchBranchDescriptor: ToolDescriptor = {
  name: RESEARCH_BRANCH_TOOL,
  description:
    "情报调研树的一支：在额度内由模型决定下一步搜索、读公开网页或结束，代码执行并扣额度，交一张 research-handoff/v1 交接单（事实带网址与逐字核对过的摘录）。只在调研 Job 里执行；不发邮件、不建待批卡、不写报价与供应商库",
  riskLevel: "MEDIUM",
  readOnly: false,
  requiresApproval: false,
  supportedChannels: ["web"],
};

export const researchTrunkDescriptor: ToolDescriptor = {
  name: RESEARCH_TRUNK_TOOL,
  description:
    "情报调研树的树干：确定性汇总各支交接单（不调模型），把每支状态、条数、未查到原因与用量写进情报室摘要 summaryJson.researchTree（不含金额与摘录）。只在调研 Job 里执行",
  riskLevel: "MEDIUM",
  readOnly: false,
  requiresApproval: false,
  supportedChannels: ["web"],
};

export const researchBranchHandler = handleResearchBranch;
export const researchTrunkHandler = handleResearchTrunk;
