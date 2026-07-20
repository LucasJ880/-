/**
 * 管理摘要结构化 Schema（业务主管语言，非技能 JSON）
 */

import { z } from "zod";

export const SummaryFindingSchema = z.object({
  finding: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
});

export const SummaryActionSchema = z.object({
  priority: z.number().int().min(1).max(7),
  action: z.string().min(1),
  reason: z.string().default(""),
  ownerSuggestion: z.string().default(""),
  suggestedDueAt: z.string().default(""),
  approvalRequired: z.boolean().default(false),
  pendingActionId: z.string().nullable().default(null),
});

export const KnowledgeRetrievalSchema = z.object({
  status: z.enum(["available", "degraded", "unavailable"]).default("available"),
  reason: z.string().default(""),
  sourcesUsed: z.array(z.string()).default([]),
});

export const ManagementSummarySchema = z.object({
  executiveConclusion: z.string().min(1),
  keyFindings: z.array(SummaryFindingSchema).default([]),
  recommendedActions: z.array(SummaryActionSchema).default([]),
  preparedItems: z.array(z.string()).default([]),
  pendingApprovals: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  completedSteps: z.array(z.string()).default([]),
  skippedOrFailedSteps: z.array(z.string()).default([]),
  nextReviewSuggestion: z.string().default(""),
  limitations: z.array(z.string()).default([]),
  knowledgeRetrieval: KnowledgeRetrievalSchema.optional(),
  /** 调试用，不对普通用户展示 */
  debugSkillSnippets: z.array(z.string()).optional(),
});

export type ManagementSummary = z.infer<typeof ManagementSummarySchema>;
export type KnowledgeRetrievalStatus = z.infer<typeof KnowledgeRetrievalSchema>;
