import { z } from "zod";

export const VerificationTypeSchema = z.enum([
  "tool_result",
  "database_state",
  "artifact_exists",
  "human_approval",
  "model_judgement",
]);

export const CompletionCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  verificationType: VerificationTypeSchema,
});

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  preferredTool: z.string().optional(),
  executionMode: z.enum(["read", "write", "analysis", "approval"]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  requiresApproval: z.boolean(),
  expectedOutput: z.string().min(1),
});

export const PlannerOutputSchema = z.object({
  objective: z.string().min(1),
  summary: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().optional(),
  completionCriteria: z.array(CompletionCriterionSchema).min(1),
  // max 放宽到 16，由 sanitize 按 AGENT_RUNTIME_V2_MAX_STEPS 裁剪
  steps: z.array(PlanStepSchema).min(1).max(16),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const VerifierVerdictSchema = z.enum([
  "PASS",
  "REPAIR",
  "NEEDS_HUMAN",
  "BLOCKED",
]);

export const VerifierOutputSchema = z.object({
  verdict: VerifierVerdictSchema,
  summary: z.string().min(1),
  satisfiedCriteria: z.array(z.string()),
  unsatisfiedCriteria: z.array(z.string()),
  evidenceReferences: z.array(z.string()),
  repairInstructions: z.array(z.string()),
});

export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

export const ToolDescriptorSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  readOnly: z.boolean(),
  requiresApproval: z.boolean(),
  supportedChannels: z.array(z.string()).default(["web", "wechat"]),
});

export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

export type RuntimeV2RunStatus =
  | "queued"
  | "planning"
  | "planned"
  | "executing"
  | "awaiting_approval"
  | "verifying"
  | "repairing"
  | "completed"
  | "partially_executed"
  | "needs_human"
  | "failed"
  | "cancelled";

export type RuntimeV2StepStatus =
  | "pending"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export const RUNTIME_V2_EVENT_TYPES = [
  "plan.started",
  "plan.created",
  "step.ready",
  "step.started",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "approval.required",
  "approval.resolved",
  "step.completed",
  "verification.started",
  "verification.passed",
  "verification.repair_required",
  "verification.needs_human",
  "repair.started",
  "repair.completed",
  "run.completed",
  "run.needs_human",
  "run.failed",
  "run.cancelled",
] as const;

export type RuntimeV2EventType = (typeof RUNTIME_V2_EVENT_TYPES)[number];
