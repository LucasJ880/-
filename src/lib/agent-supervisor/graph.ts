/**
 * LangGraph StateGraph — 流程编排层
 *
 * 生产执行以 engine.ts 为准（Serverless 友好的显式暂停/恢复）。
 * 本 Graph 用相同节点语义保证拓扑清晰，可供测试与可视化。
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { routeComplexity } from "./complexity-router";
import type { ComplexityResult, SupervisorStep } from "./types";

export const SupervisorGraphState = Annotation.Root({
  originalRequest: Annotation<string>,
  mode: Annotation<"direct" | "supervisor">,
  complexityReason: Annotation<string>,
  planStepCount: Annotation<number>,
  currentStep: Annotation<number>,
  skillCallCount: Annotation<number>,
  maxSkillCalls: Annotation<number>,
  maxSteps: Annotation<number>,
  replanCount: Annotation<number>,
  maxReplans: Annotation<number>,
  decision: Annotation<string>,
  status: Annotation<string>,
  candidateSkills: Annotation<string[]>,
});

export type SupervisorGraphStateType = typeof SupervisorGraphState.State;

function understandNode(
  state: SupervisorGraphStateType,
): Partial<SupervisorGraphStateType> {
  const c: ComplexityResult = routeComplexity({ content: state.originalRequest });
  return {
    mode: c.mode,
    complexityReason: c.reason,
    candidateSkills: c.candidateSkills,
    status: "understanding",
  };
}

function routeMode(state: SupervisorGraphStateType): "direct" | "supervisor" {
  return state.mode === "supervisor" ? "supervisor" : "direct";
}

function planNode(
  state: SupervisorGraphStateType,
): Partial<SupervisorGraphStateType> {
  const count = Math.min(
    state.maxSteps || 5,
    Math.max(1, state.candidateSkills?.length || 2),
  );
  return {
    planStepCount: count,
    currentStep: 0,
    status: "planning",
    decision: "continue",
  };
}

function executeNode(
  state: SupervisorGraphStateType,
): Partial<SupervisorGraphStateType> {
  const nextCall = (state.skillCallCount || 0) + 1;
  const nextStep = (state.currentStep || 0) + 1;
  const hitLimit = nextCall >= (state.maxSkillCalls || 6);
  const doneSteps = nextStep >= (state.planStepCount || 1);
  return {
    skillCallCount: nextCall,
    currentStep: nextStep,
    status: "running",
    decision: hitLimit || doneSteps ? "complete" : "continue",
  };
}

function observeNode(
  state: SupervisorGraphStateType,
): Partial<SupervisorGraphStateType> {
  if (state.decision === "complete") {
    return { status: "completed", decision: "complete" };
  }
  if ((state.replanCount || 0) > 0 && state.decision === "replan") {
    return { status: "replanning" };
  }
  return { status: "running", decision: state.decision || "continue" };
}

function decisionRouter(
  state: SupervisorGraphStateType,
): "continue" | "replan" | "complete" | "fail" {
  const d = state.decision || "continue";
  if (d === "complete") return "complete";
  if (d === "fail") return "fail";
  if (d === "replan") {
    if ((state.replanCount || 0) >= (state.maxReplans || 2)) return "complete";
    return "replan";
  }
  if ((state.skillCallCount || 0) >= (state.maxSkillCalls || 6)) return "complete";
  if ((state.currentStep || 0) >= (state.planStepCount || 1)) return "complete";
  return "continue";
}

function replanNode(
  state: SupervisorGraphStateType,
): Partial<SupervisorGraphStateType> {
  return {
    replanCount: (state.replanCount || 0) + 1,
    status: "replanning",
    decision: "continue",
  };
}

function summarizeNode(): Partial<SupervisorGraphStateType> {
  return { status: "completed", decision: "complete" };
}

function failNode(): Partial<SupervisorGraphStateType> {
  return { status: "failed", decision: "fail" };
}

/** 编译主管 Graph（无 MemorySaver；生产用 engine 持久化） */
export function compileSupervisorGraph() {
  const graph = new StateGraph(SupervisorGraphState)
    .addNode("understand_request", understandNode)
    .addNode("create_plan", planNode)
    .addNode("execute_step", executeNode)
    .addNode("observe_result", observeNode)
    .addNode("replan", replanNode)
    .addNode("summarize", summarizeNode)
    .addNode("fail_safe", failNode)
    .addEdge(START, "understand_request")
    .addConditionalEdges("understand_request", routeMode, {
      direct: "execute_step",
      supervisor: "create_plan",
    })
    .addEdge("create_plan", "execute_step")
    .addEdge("execute_step", "observe_result")
    .addConditionalEdges("observe_result", decisionRouter, {
      continue: "execute_step",
      replan: "replan",
      complete: "summarize",
      fail: "fail_safe",
    })
    .addEdge("replan", "execute_step")
    .addEdge("summarize", END)
    .addEdge("fail_safe", END);

  return graph.compile();
}

/** 将业务计划步骤转成 Graph 初始计数 */
export function stepsToGraphSeed(steps: SupervisorStep[]) {
  return {
    planStepCount: steps.length,
    currentStep: 0,
    skillCallCount: 0,
  };
}
