/**
 * 情报调研树的计划（服务端写死，模型不参与编图；纯函数）。
 *
 * 六步：第一波 ① 条款、② 往期同标、③ 同类项目（限量）；第二波甲（全量）、乙（放宽）由各自的工具按分叉规则
 * 决定跑不跑（运行时不能中途加步骤，所以预先声明）；最后是树干汇总。每步显式 workerKey，都不需要审批。
 * 标题与说明写死成通用句：作业中心按工作域可读、不看项目权限，所以这里不放项目名、采购方与金额。
 */

import {
  WORKFORCE_PLAN_CONTRACT_VERSION,
  type ServerAuthoredPlanV1,
  type ServerAuthoredTaskV1,
} from "@/lib/workforce-runtime/server-plan";
import { BRANCH_DEFS, BRANCH_STEP_IDS, RESEARCH_STEP_IDS } from "./fork-rules";
import { RESEARCH_TREE_LIMITS } from "./limits";

export const RESEARCH_BRANCH_TOOL = "tender_research_branch" as const;
export const RESEARCH_TRUNK_TOOL = "tender_research_trunk" as const;
export const RESEARCH_PLAN_TOOLS: ReadonlyArray<{ name: string }> = Object.freeze([
  { name: RESEARCH_BRANCH_TOOL },
  { name: RESEARCH_TRUNK_TOOL },
]);

/** 作业中心里看到的标题（不含项目名） */
export const RESEARCH_TREE_GOAL = "情报调研：查往期同标与同类项目的公开授标（只读公开网页，不对外发送）";

const WORKER = "tender_worker";

function task(input: {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  preferredTool: string;
  expectedOutput: string;
}): ServerAuthoredTaskV1 {
  return {
    ...input,
    workerKey: WORKER,
    taskKind: "work",
    executionMode: "analysis",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  };
}

const WAVE1 = [RESEARCH_STEP_IDS.clauses, RESEARCH_STEP_IDS.priorAwards, RESEARCH_STEP_IDS.similar];

export function buildResearchTreePlan(): ServerAuthoredPlanV1 {
  const branchCount = BRANCH_STEP_IDS.length;
  const maxDepth = Math.max(...BRANCH_STEP_IDS.map((id) => BRANCH_DEFS[id].depth));
  if (branchCount > RESEARCH_TREE_LIMITS.MAX_BRANCHES_PER_TREE) throw new Error("调研树分支数超过上限");
  if (maxDepth > RESEARCH_TREE_LIMITS.MAX_DEPTH) throw new Error("调研树深度超过上限");

  const handoffNote = "交一张 research-handoff/v1 交接单（查到的事实带网址与原文摘录；没查到的写原因）。";
  const tasks: ServerAuthoredTaskV1[] = [
    task({
      id: RESEARCH_STEP_IDS.clauses,
      title: "调研分支：条款",
      description: "第一波。确认标书里的本地含量、指定品牌与等效品条款（条款员尚未接入，这次交「未接通」）。",
      dependsOn: [],
      preferredTool: RESEARCH_BRANCH_TOOL,
      expectedOutput: handoffNote,
    }),
    task({
      id: RESEARCH_STEP_IDS.priorAwards,
      title: "调研分支：往期同标",
      description: "第一波。在额度内搜索与读公开网页，找同一采购方的往期同类采购与中标情况。",
      dependsOn: [],
      preferredTool: RESEARCH_BRANCH_TOOL,
      expectedOutput: handoffNote,
    }),
    task({
      id: RESEARCH_STEP_IDS.similar,
      title: "调研分支：同类项目（初查）",
      description: "第一波。在一半额度内找数量与要求相近的同类采购授标。",
      dependsOn: [],
      preferredTool: RESEARCH_BRANCH_TOOL,
      expectedOutput: handoffNote,
    }),
    task({
      id: RESEARCH_STEP_IDS.wave2Full,
      title: "调研分支：同类项目（补查）",
      description: "第二波。往期同标没查到时，用全额额度继续找同类项目；否则交「无需追查」。",
      dependsOn: [...WAVE1],
      preferredTool: RESEARCH_BRANCH_TOOL,
      expectedOutput: handoffNote,
    }),
    task({
      id: RESEARCH_STEP_IDS.wave2Relaxed,
      title: "调研分支：同类项目（放宽条件）",
      description: "第二波。同类授标不足 3 条时放宽到数量不限、近 6 年、加上美国；否则交「无需追查」。",
      dependsOn: [...WAVE1, RESEARCH_STEP_IDS.wave2Full],
      preferredTool: RESEARCH_BRANCH_TOOL,
      expectedOutput: handoffNote,
    }),
    task({
      id: RESEARCH_STEP_IDS.trunk,
      title: "调研树干：汇总",
      description: "确定性汇总五个分支的交接单（不调模型），把每支状态、条数、未查到原因与用量写进情报室摘要。",
      dependsOn: [...BRANCH_STEP_IDS],
      preferredTool: RESEARCH_TRUNK_TOOL,
      expectedOutput: "情报室 summaryJson.researchTree：每支状态与用量、待反查、未追的线索（不含金额与摘录）。",
    }),
  ];

  return {
    contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
    objective: RESEARCH_TREE_GOAL,
    summary: "服务端固定六步：三个第一波分支 → 两个按分叉规则决定的第二波分支 → 确定性树干汇总。",
    assumptions: [
      "图与分叉由服务端规则决定，模型只在分支内决定下一步搜索、读页或结束。",
      "全部步骤只产生机器分析记录与线索，不发邮件、不建待批卡、不写报价与供应商库。",
    ],
    completionCriteria: [
      {
        id: "c1_trunk_summarized",
        evidenceStepIds: [RESEARCH_STEP_IDS.trunk],
        description: "tender_research_trunk 返回树干已汇总（每支都有交接单）。",
        verificationType: "tool_result",
      },
    ],
    tasks,
  };
}
