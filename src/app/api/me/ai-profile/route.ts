import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  EmployeeAiAccessError,
  assertOrgMembership,
  getOwnEmployeeAiProfile,
  isEmployeeAiLearningEnabled,
  loadOrgCode,
  resolveEmployeeAiOrgId,
  respondToInferredPreference,
  suggestPersonalPreferences,
  updateOwnEmployeeAiProfile,
  getPersonalLearningMetrics,
} from "@/lib/employee-ai";
import { asOptionalString, asString } from "@/lib/employee-ai/http";

export const GET = withAuth(async (_req, _ctx, user) => {
  const orgId = await resolveEmployeeAiOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }
  await assertOrgMembership(user.id, orgId);
  const orgCode = await loadOrgCode(orgId);
  const enabled = isEmployeeAiLearningEnabled({
    userId: user.id,
    role: user.role,
    orgId,
    orgCode,
  });

  const profile = await getOwnEmployeeAiProfile({ orgId, userId: user.id });
  const suggestions = enabled
    ? await suggestPersonalPreferences({ orgId, userId: user.id })
    : [];
  const metrics = await getPersonalLearningMetrics({ orgId, userId: user.id });

  return NextResponse.json({
    enabled,
    profile,
    suggestions,
    metrics,
    privacy: {
      records: [
        "AI 工作建议与接受/修改/拒绝",
        "主动填写的修改原因",
        "关联业务系统的工作结果",
        "经授权用于部门学习的反馈",
      ],
      neverRecords: [
        "私人聊天",
        "私人邮箱",
        "键盘轨迹",
        "屏幕录像",
        "与工作无关的浏览",
        "私人设备内容",
        "情绪或人格推断",
      ],
    },
  });
});

export const PATCH = withAuth(async (req, _ctx, user) => {
  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) {
      return NextResponse.json({ error: "无组织" }, { status: 403 });
    }
    await assertOrgMembership(user.id, orgId);
    const body = (await safeParseBody(req)) || {};

    if (body.inferredDecision && body.preferenceKey) {
      const updated = await respondToInferredPreference({
        orgId,
        userId: user.id,
        preferenceKey: asString(body.preferenceKey),
        decision: asString(body.inferredDecision) as
          | "confirm"
          | "reject"
          | "scope_limit"
          | "stop_learning",
        scopedValue: body.scopedValue,
      });
      return NextResponse.json({ ok: true, profile: updated });
    }

    const statusRaw = asOptionalString(body.status);
    const profile = await updateOwnEmployeeAiProfile({
      orgId,
      userId: user.id,
      patch: {
        preferredLanguage: asOptionalString(body.preferredLanguage),
        responseDetailLevel: asOptionalString(body.responseDetailLevel),
        preferredFormats: body.preferredFormats,
        preferredChannels: body.preferredChannels,
        schedulingPreferences: body.schedulingPreferences,
        communicationStyle: body.communicationStyle,
        approvalPreferences: body.approvalPreferences,
        personalTemplates: body.personalTemplates,
        manuallyConfirmedPreferences: body.manuallyConfirmedPreferences,
        department: asOptionalString(body.department),
        roleScope: asOptionalString(body.roleScope) ?? undefined,
        status:
          statusRaw === "active" || statusRaw === "paused"
            ? statusRaw
            : undefined,
        consentConfirmed: body.consentConfirmed === true,
      },
    });
    return NextResponse.json({ ok: true, profile });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
