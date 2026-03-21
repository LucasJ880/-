import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  normalizeEnvCode,
  isValidEnvCodeFormat,
} from "@/lib/projects/members-utils";

type Ctx = { params: Promise<{ id: string }> };

function sortEnvironments<T extends { code: string }>(list: T[]): T[] {
  const rank = (code: string) => {
    if (code === "test") return 0;
    if (code === "prod") return 1;
    return 2;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a.code);
    const rb = rank(b.code);
    if (ra !== rb) return ra - rb;
    return a.code.localeCompare(b.code);
  });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const list = await db.environment.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    environments: sortEnvironments(list),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json();
  const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
  if (!nameRaw) {
    return NextResponse.json({ error: "环境名称不能为空" }, { status: 400 });
  }

  let code: string;
  if (body.code != null && String(body.code).trim() !== "") {
    code = normalizeEnvCode(String(body.code));
  } else {
    code = normalizeEnvCode(nameRaw);
  }

  if (!code || !isValidEnvCodeFormat(code)) {
    return NextResponse.json(
      { error: "code 须为小写字母、数字、连字符，2–32 位" },
      { status: 400 }
    );
  }

  if (code === "test" || code === "prod") {
    return NextResponse.json(
      { error: "默认环境 test / prod 已存在，请使用其他 code（如 staging）" },
      { status: 409 }
    );
  }

  const dup = await db.environment.findUnique({
    where: { projectId_code: { projectId, code } },
  });
  if (dup) {
    return NextResponse.json({ error: "该 code 已存在" }, { status: 409 });
  }

  const env = await db.environment.create({
    data: {
      projectId,
      name: nameRaw,
      code,
      status: "active",
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.ENVIRONMENT,
    targetId: env.id,
    afterData: { code: env.code, name: env.name },
    request,
  });

  return NextResponse.json({ environment: env }, { status: 201 });
}
