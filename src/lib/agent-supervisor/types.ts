/**
 * 主管 AI Supervisor — 类型与 Zod Schema
 */

import { z } from "zod";

export const SupervisorStatusSchema = z.enum([
  "understanding",
  "planning",
  "running",
  "replanning",
  "waiting_for_user",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
]);
export type SupervisorStatus = z.infer<typeof SupervisorStatusSchema>;

export const WorkerIdSchema = z.enum([
  "sales",
  "tender",
  "marketing",
  "analytics",
]);
export type WorkerId = z.infer<typeof WorkerIdSchema>;

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "skipped",
  "waiting_for_user",
  "waiting_for_approval",
  "failed",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const SupervisorStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  worker: WorkerIdSchema,
  skillSlug: z.string().min(1),
  objective: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  status: StepStatusSchema.default("pending"),
  mayCreatePendingAction: z.boolean().default(false),
  resultRef: z
    .object({
      skillExecutionId: z.string().optional(),
      agentRunEventId: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
  resultSummary: z.string().optional(),
});
export type SupervisorStep = z.infer<typeof SupervisorStepSchema>;

export const ComplexityResultSchema = z.object({
  mode: z.enum(["direct", "supervisor"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  candidateWorker: WorkerIdSchema.or(z.literal("")).default(""),
  candidateSkills: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
});
export type ComplexityResult = z.infer<typeof ComplexityResultSchema>;

export const PlannerOutputSchema = z.object({
  objective: z.string(),
  assumptions: z.array(z.string()).default([]),
  completionCriteria: z.array(z.string()).default([]),
  steps: z
    .array(
      z.object({
        id: z.string(),
        order: z.number().int().positive(),
        worker: WorkerIdSchema,
        skillSlug: z.string(),
        objective: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
        dependsOn: z.array(z.string()).default([]),
        mayCreatePendingAction: z.boolean().default(false),
      }),
    )
    .max(5),
  expectedApprovalPoints: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export const ObserverOutputSchema = z.object({
  decision: z.enum([
    "continue",
    "replan",
    "ask_user",
    "wait_approval",
    "complete",
    "fail",
  ]),
  reason: z.string(),
  factsLearned: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  recommendedChanges: z.array(z.string()).default([]),
  pendingActionIds: z.array(z.string()).default([]),
});
export type ObserverOutput = z.infer<typeof ObserverOutputSchema>;

export type SupervisorDecision =
  | { type: "continue"; reason: string }
  | { type: "replan"; reason: string }
  | { type: "ask_user"; reason: string; questions: string[] }
  | {
      type: "wait_approval";
      reason: string;
      pendingActionIds: string[];
    }
  | { type: "complete"; reason: string }
  | { type: "fail"; reason: string };

export type SupervisorObservation = {
  stepId: string;
  at: string;
  success: boolean;
  summary: string;
  factsLearned: string[];
  pendingActionIds: string[];
  decision: ObserverOutput["decision"];
};

export type SupervisorArtifact = {
  id: string;
  kind: "skill_result" | "summary" | "draft";
  stepId?: string;
  title: string;
  content: string;
  skillExecutionId?: string;
};

export type SupervisorFinalSummary = {
  managementSummary: string;
  /** 结论（主管语言） */
  executiveConclusion?: string;
  keyFindings: string[];
  recommendedActions: string[];
  preparedDrafts: string[];
  pendingApprovals: string[];
  incompleteAndMissing: string[];
  nextCheckSuggestion?: string;
  fallbackUsed?: boolean;
  limitations?: string[];
  knowledgeRetrieval?: {
    status: "available" | "degraded" | "unavailable";
    reason: string;
    sourcesUsed: string[];
  };
  /** 结构化摘要（前端优先渲染） */
  structured?: import("./summary-schema").ManagementSummary;
};

export type SupervisorPageContext = {
  pathname?: string;
  projectId?: string;
  customerId?: string;
  opportunityId?: string;
  quoteId?: string;
  campaignId?: string;
  productId?: string;
};

export type SupervisorState = {
  sessionId: string;
  runId: string;
  orgId: string;
  userId: string;
  userRole?: string;

  originalRequest: string;
  objective: string;

  pageContext?: SupervisorPageContext;

  resolvedContext: {
    organization?: Record<string, unknown>;
    currentEntity?: Record<string, unknown>;
    relevantFacts?: Array<Record<string, unknown>>;
    missingContext?: string[];
    availableSkills?: Array<{ slug: string; name: string; domain: string }>;
  };

  mode: "direct" | "supervisor";
  complexity?: ComplexityResult;

  plan: SupervisorStep[];
  currentStepIndex: number;

  observations: SupervisorObservation[];
  artifacts: SupervisorArtifact[];
  pendingActionIds: string[];

  status: SupervisorStatus;
  decision?: SupervisorDecision;

  stepCount: number;
  replanCount: number;
  skillCallCount: number;

  maxSteps: number;
  maxReplans: number;
  maxSkillCalls: number;

  waitingReason?: string;
  finalSummary?: SupervisorFinalSummary;
  error?: string;
  fallbackUsed?: boolean;
  userVisibleTimeline: string[];

  /** 已执行技能指纹，防重复 */
  executedFingerprints: string[];

  /** 企业知识检索状态（embedding 失败时显式降级） */
  knowledgeRetrieval?: {
    status: "available" | "degraded" | "unavailable";
    reason: string;
    sourcesUsed: string[];
  };

  /** 模型调用遥测（非静默 fallback） */
  modelTelemetry?: Array<{
    purpose: "planner" | "observer" | "summary" | "repair";
    requestedModel: string;
    actualModel: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
  }>;
};

export type SupervisorRunResult = {
  ok: boolean;
  status: SupervisorStatus;
  text: string;
  state: SupervisorState;
  pendingActionIds: string[];
  fallbackUsed?: boolean;
};

export type WorkerResult = {
  ok: boolean;
  skillSlug: string;
  skillExecutionId?: string;
  content: string;
  parsed?: unknown;
  pendingActionIds: string[];
  summary: string;
  error?: string;
};
