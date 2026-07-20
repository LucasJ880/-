import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { EmployeeAiAccessError } from "./access";

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
      manuallyConfirmedPreferences: { confirmed: {} },
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
  const confirmed = (confirmedBag.confirmed as Record<string, unknown>) || {};

  if (input.decision === "confirm") {
    confirmed[input.preferenceKey] = inferred[input.preferenceKey] ?? true;
  } else if (input.decision === "scope_limit") {
    confirmed[input.preferenceKey] = {
      value: inferred[input.preferenceKey],
      scope: input.scopedValue ?? "limited",
    };
  } else if (input.decision === "reject" || input.decision === "stop_learning") {
    delete confirmed[input.preferenceKey];
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
      manuallyConfirmedPreferences: { ...confirmedBag, confirmed } as object,
      version: profile.version + 1,
    },
  });
}
