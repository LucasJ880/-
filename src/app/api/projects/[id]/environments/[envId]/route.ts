import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  isReservedEnvCode,
  isValidEnvironmentStatus,
} from "@/lib/projects/members-utils";

type Ctx = { params: Promise<{ id: string; envId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, envId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const env = await db.environment.findFirst({
    where: { id: envId, projectId },
  });
  if (!env) {
    return NextResponse.json({ error: "环境不存在" }, { status: 404 });
  }

  const body = await request.json();

  if (body.code !== undefined) {
    return NextResponse.json({ error: "不允许修改环境 code" }, { status: 400 });
  }

  const data: { name?: string; status?: string } = {};

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) {
      return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    }
    data.name = n;
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    if (!isValidEnvironmentStatus(s)) {
      return NextResponse.json({ error: "无效的环境状态" }, { status: 400 });
    }
    if (s === "archived" && isReservedEnvCode(env.code)) {
      return NextResponse.json(
        { error: "系统默认环境 test / prod 不可归档" },
        { status: 400 }
      );
    }
    data.status = s;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const before = { name: env.name, status: env.status };

  const updated = await db.environment.update({
    where: { id: envId },
    data,
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.ENVIRONMENT,
    targetId: envId,
    beforeData: before,
    afterData: { name: updated.name, status: updated.status },
    request,
  });

  return NextResponse.json({ environment: updated });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id: projectId, envId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const env = await db.environment.findFirst({
    where: { id: envId, projectId },
  });
  if (!env) {
    return NextResponse.json({ error: "环境不存在" }, { status: 404 });
  }

  if (isReservedEnvCode(env.code)) {
    return NextResponse.json(
      { error: "系统默认环境不可归档，如需停用请使用业务层开关（后续版本）" },
      { status: 400 }
    );
  }

  const activeCount = await db.environment.count({
    where: { projectId, status: "active" },
  });
  if (activeCount <= 1) {
    return NextResponse.json(
      { error: "至少保留一个活跃环境" },
      { status: 400 }
    );
  }

  if (env.status !== "active") {
    return NextResponse.json({ error: "环境已归档" }, { status: 400 });
  }

  const before = { status: env.status };

  const updated = await db.environment.update({
    where: { id: envId },
    data: { status: "archived" },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.DELETE,
    targetType: AUDIT_TARGETS.ENVIRONMENT,
    targetId: envId,
    beforeData: before,
    afterData: { status: updated.status },
    request,
  });

  return NextResponse.json({
    ok: true,
    environment: { id: updated.id, status: updated.status },
  });
}
