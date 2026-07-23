import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

import {
  EmployeeAiAccessError,
  assertOrgMembership,
  canReviewTeamLearning,
  createPlaybookDraft,
  listPlaybooks,
  resolveEmployeeAiOrgId,
} from "@/lib/employee-ai";
import { asOptionalStringArray, asString } from "@/lib/employee-ai/http";

export const GET = withAuth(async (req, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    await assertOrgMembership(user.id, orgId);
    const status = req.nextUrl.searchParams.get("status") || undefined;
    const department = req.nextUrl.searchParams.get("department") || undefined;
    const playbooks = await listPlaybooks({ orgId, status, department });
    return NextResponse.json({ playbooks });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});

export const POST = withAuth(async (req, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  try {
    const orgId = await resolveEmployeeAiOrgId(user.id);
    if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });
    const { memberRole } = await assertOrgMembership(user.id, orgId);
    if (!canReviewTeamLearning({ platformRole: user.role, memberRole })) {
      return NextResponse.json({ error: "需要主管或管理员权限" }, { status: 403 });
    }
    const body = (await safeParseBody(req)) || {};
    if (!body.name || !body.description || !body.department || !body.roleScope) {
      return NextResponse.json(
        { error: "name/description/department/roleScope 必填" },
        { status: 400 },
      );
    }
    const playbook = await createPlaybookDraft({
      orgId,
      userId: user.id,
      department: asString(body.department),
      roleScope: asString(body.roleScope),
      name: asString(body.name),
      description: asString(body.description),
      rules: body.rules,
      workflows: body.workflows,
      templates: body.templates,
      exceptions: body.exceptions,
      sourceCandidatePracticeIds: asOptionalStringArray(
        body.sourceCandidatePracticeIds,
      ),
    });
    return NextResponse.json({ ok: true, playbook });
  } catch (e) {
    if (e instanceof EmployeeAiAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
