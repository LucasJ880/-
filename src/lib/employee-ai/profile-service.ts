import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { EmployeeAiAccessError } from "./access";
import { applyPreferenceDecision } from "./preference-history";

export async function getOrCreateEmployeeAiProfile(input: {
  orgId: string;
  userId: string;
  roleScope?: string;
  department?: string;
}) {
  const existing = await db.employeeAiProfile.findUnique({
    where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
  });
  if (existing) return existing;

  return db.employeeAiProfile.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      roleScope: input.roleScope ?? "general",
      department: input.department,
      learnedPreferences: { inferred: {}, confidence: {}, lastLearnedAt: null },
      manuallyConfirmedPreferences: { confirmed: {}, history: [] },
    },
  });
}

export async function getOwnEmployeeAiProfile(input: {
  orgId: string;
  userId: string;
}) {
  return getOrCreateEmployeeAiProfile(input);
}

export async function updateOwnEmployeeAiProfile(input: {
  orgId: string;
  userId: string;
  patch: {
    preferredLanguage?: string | null;
    responseDetailLevel?: string | null;
    preferredFormats?: unknown;
    preferredChannels?: unknown;
    schedulingPreferences?: unknown;
    communicationStyle?: unknown;
    approvalPreferences?: unknown;
    personalTemplates?: unknown;
    manuallyConfirmedPreferences?: unknown;
    /** 按 key 写入确认偏好（走 history supersede） */
    confirmPreference?: { key: string; value: unknown; scope?: unknown };
    department?: string | null;
    roleScope?: string;
    status?: "active" | "paused";
    consentConfirmed?: boolean;
  };
}) {
  const profile = await getOrCreateEmployeeAiProfile(input);
  if (profile.userId !== input.userId || profile.orgId !== input.orgId) {
    throw new EmployeeAiAccessError("只能修改自己的 AI 偏好", 403);
  }

  const data: Record<string, unknown> = { version: profile.version + 1 };
  const p = input.patch;
  if (p.preferredLanguage !== undefined) data.preferredLanguage = p.preferredLanguage;
  if (p.responseDetailLevel !== undefined) data.responseDetailLevel = p.responseDetailLevel;
  if (p.preferredFormats !== undefined) data.preferredFormats = p.preferredFormats as object;
  if (p.preferredChannels !== undefined) data.preferredChannels = p.preferredChannels as object;
  if (p.schedulingPreferences !== undefined) {
    data.schedulingPreferences = p.schedulingPreferences as object;
  }
  if (p.communicationStyle !== undefined) data.communicationStyle = p.communicationStyle as object;
  if (p.approvalPreferences !== undefined) data.approvalPreferences = p.approvalPreferences as object;
  if (p.personalTemplates !== undefined) data.personalTemplates = p.personalTemplates as object;
  if (p.manuallyConfirmedPreferences !== undefined) {
    data.manuallyConfirmedPreferences = p.manuallyConfirmedPreferences as object;
  }
  if (p.confirmPreference?.key) {
    const bag =
      (profile.manuallyConfirmedPreferences as Record<string, unknown>) || {};
    const { confirmedBag } = applyPreferenceDecision({
      confirmedBag: bag,
      key: p.confirmPreference.key,
      decision: "manual",
      nextValue: p.confirmPreference.value,
      scope: p.confirmPreference.scope,
    });
    data.manuallyConfirmedPreferences = confirmedBag as object;
  }
  if (p.department !== undefined) data.department = p.department;
  if (p.roleScope !== undefined) data.roleScope = p.roleScope;
  if (p.status !== undefined) data.status = p.status;
  if (p.consentConfirmed === true) {
    data.consentConfirmed = true;
    data.consentConfirmedAt = new Date();
  }

  const updated = await db.employeeAiProfile.update({
    where: { id: profile.id },
    data,
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.profile.update",
    targetType: "EmployeeAiProfile",
    targetId: updated.id,
    afterData: { version: updated.version, status: updated.status },
  });

  return updated;
}

/** 确认或拒绝一项推断偏好（不得自动永久写入 confirmed） */
export async function respondToInferredPreference(input: {
  orgId: string;
  userId: string;
  preferenceKey: string;
  decision: "confirm" | "reject" | "scope_limit" | "stop_learning";
  scopedValue?: unknown;
}) {
  const profile = await getOrCreateEmployeeAiProfile(input);
  const learned = (profile.learnedPreferences as Record<string, unknown>) || {};
  const inferred = (learned.inferred as Record<string, unknown>) || {};
  const confirmedBag =
    (profile.manuallyConfirmedPreferences as Record<string, unknown>) || {};

  let nextValue: unknown = inferred[input.preferenceKey] ?? true;
  if (input.decision === "scope_limit") {
    nextValue = inferred[input.preferenceKey] ?? true;
  }

  const { confirmedBag: nextBag } = applyPreferenceDecision({
    confirmedBag,
    key: input.preferenceKey,
    decision: input.decision,
    nextValue,
    scope: input.decision === "scope_limit" ? input.scopedValue ?? "limited" : undefined,
  });

  if (input.decision === "reject" || input.decision === "stop_learning") {
    const rejected = (learned.rejected as string[]) || [];
    if (!rejected.includes(input.preferenceKey)) rejected.push(input.preferenceKey);
    learned.rejected = rejected;
  }

  delete inferred[input.preferenceKey];
  learned.inferred = inferred;

  return db.employeeAiProfile.update({
    where: { id: profile.id },
    data: {
      learnedPreferences: learned as object,
      manuallyConfirmedPreferences: nextBag as object,
      version: profile.version + 1,
    },
  });
}
