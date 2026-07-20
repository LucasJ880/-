/**
 * 数字员工执行前加载：个人确认偏好 + 已批准 Playbook
 * 优先级：安全规则 > 企业规则 > Playbook > 确认偏好 > 推断偏好 > 本次请求
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { listActivePlaybooks } from "./playbook-service";
import {
  NON_OVERRIDABLE_RULE_KEYS,
  type EmployeeAssistContext,
} from "./types";
import { isEmployeeAiPlaybooksEnabled, isEmployeeAiLearningEnabled } from "./flags";
import { flattenConfirmedForInject, unwrapConfirmedValue } from "./preference-history";

function hashContext(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function mergePreferencesWithSafety(input: {
  confirmed: Record<string, unknown>;
  inferred: Record<string, unknown>;
}): {
  confirmedPersonalPreferences: Record<string, unknown>;
  inferredPersonalPreferences: Record<string, unknown>;
  doNotUse: string[];
} {
  const doNotUse: string[] = [...NON_OVERRIDABLE_RULE_KEYS];
  const confirmed: Record<string, unknown> = {};
  const inferred: Record<string, unknown> = {};
  const flatConfirmed = flattenConfirmedForInject(input.confirmed || {});

  for (const [k, v] of Object.entries(flatConfirmed)) {
    if (NON_OVERRIDABLE_RULE_KEYS.includes(k as (typeof NON_OVERRIDABLE_RULE_KEYS)[number])) {
      doNotUse.push(`blocked_confirmed:${k}`);
      continue;
    }
    confirmed[k] = v;
  }
  for (const [k, v] of Object.entries(input.inferred || {})) {
    if (k in confirmed) continue;
    if (NON_OVERRIDABLE_RULE_KEYS.includes(k as (typeof NON_OVERRIDABLE_RULE_KEYS)[number])) {
      continue;
    }
    inferred[k] = unwrapConfirmedValue(v);
  }

  return {
    confirmedPersonalPreferences: confirmed,
    inferredPersonalPreferences: inferred,
    doNotUse: Array.from(new Set(doNotUse)),
  };
}

export function formatAssistContextForPrompt(ctx: EmployeeAssistContext): string {
  const lines: string[] = [
    "【员工辅助上下文 — 不得覆盖审批/合规/品牌禁用词/工具白名单】",
  ];

  const conf = ctx.confirmedPersonalPreferences;
  if (Object.keys(conf).length > 0) {
    lines.push("已确认个人偏好：");
    for (const [k, v] of Object.entries(conf)) {
      const unwrapped = unwrapConfirmedValue(v);
      const text =
        typeof unwrapped === "object" &&
        unwrapped &&
        "preference" in (unwrapped as object)
          ? String((unwrapped as { preference: string }).preference)
          : typeof unwrapped === "string"
            ? unwrapped
            : JSON.stringify(unwrapped);
      lines.push(`- ${k}: ${text}`);
    }
  }

  if (ctx.activeRolePlaybooks.length > 0) {
    lines.push("已批准部门 Playbook（请遵循，并在建议中标注依据名称与版本）：");
    for (const pb of ctx.activeRolePlaybooks) {
      lines.push(`- ${pb.name} v${pb.version}`);
      if (pb.rules) lines.push(`  规则摘要: ${JSON.stringify(pb.rules).slice(0, 400)}`);
      if (pb.workflows) {
        lines.push(`  流程摘要: ${JSON.stringify(pb.workflows).slice(0, 400)}`);
      }
    }
  }

  if (ctx.doNotUse.length > 0) {
    lines.push(`禁止被个人偏好覆盖: ${ctx.doNotUse.join(", ")}`);
  }

  return lines.join("\n");
}

export async function buildEmployeeAssistContext(input: {
  orgId: string;
  userId: string;
  workerType?: string;
  skillSlug?: string;
  taskType?: string;
  role?: string | null;
  orgCode?: string | null;
  skillVersion?: number | null;
}): Promise<EmployeeAssistContext> {
  const empty: EmployeeAssistContext = {
    confirmedPersonalPreferences: {},
    inferredPersonalPreferences: {},
    activeRolePlaybooks: [],
    relevantApprovedRules: [],
    doNotUse: [...NON_OVERRIDABLE_RULE_KEYS],
    contextVersion: "v1",
    employeeAiProfileVersion: null,
    rolePlaybookIds: [],
    rolePlaybookVersions: [],
    skillVersion: input.skillVersion ?? null,
    contextHash: "disabled",
  };

  const flagInput = {
    userId: input.userId,
    orgId: input.orgId,
    orgCode: input.orgCode,
    role: input.role,
  };

  if (!isEmployeeAiLearningEnabled(flagInput)) {
    return empty;
  }

  const profile = await db.employeeAiProfile.findUnique({
    where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
  });

  const confirmedBag =
    (profile?.manuallyConfirmedPreferences as Record<string, unknown>) || {};
  const confirmed = (confirmedBag.confirmed as Record<string, unknown>) || {};
  const learned = (profile?.learnedPreferences as Record<string, unknown>) || {};
  const inferredRaw = (learned.inferred as Record<string, unknown>) || {};

  const merged = mergePreferencesWithSafety({
    confirmed,
    inferred: inferredRaw,
  });

  let playbooks: Awaited<ReturnType<typeof listActivePlaybooks>> = [];
  if (isEmployeeAiPlaybooksEnabled(flagInput)) {
    const roleScope =
      input.workerType ||
      profile?.roleScope ||
      (input.skillSlug?.includes("sales")
        ? "sales"
        : input.skillSlug?.includes("marketing")
          ? "marketing"
          : undefined);
    playbooks = await listActivePlaybooks({
      orgId: input.orgId,
      roleScope,
      department: profile?.department ?? undefined,
    });
  }

  const activeRolePlaybooks = playbooks.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    department: p.department,
    roleScope: p.roleScope,
    rules: p.rules,
    workflows: p.workflows,
  }));

  const payload = {
    confirmed: merged.confirmedPersonalPreferences,
    playbooks: activeRolePlaybooks.map((p) => ({
      id: p.id,
      version: p.version,
    })),
    skillVersion: input.skillVersion ?? null,
  };

  return {
    ...merged,
    activeRolePlaybooks,
    relevantApprovedRules: activeRolePlaybooks.map(
      (p) => `${p.name} v${p.version}`,
    ),
    contextVersion: "v1",
    employeeAiProfileVersion: profile?.version ?? null,
    rolePlaybookIds: activeRolePlaybooks.map((p) => p.id),
    rolePlaybookVersions: activeRolePlaybooks.map((p) => p.version),
    skillVersion: input.skillVersion ?? null,
    contextHash: hashContext(payload),
  };
}
