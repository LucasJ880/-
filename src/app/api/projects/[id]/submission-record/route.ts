/**
 * GET / POST /api/projects/[id]/submission-record（FLOW-H4a）
 *
 * 投标提交的记录：人在门户或线下交完标之后，在这里记下实际提交的时间、方式、回执编号。青砚不代为提交。
 *   GET  项目读权限：项目上的提交时间、最新的一条记录、历次条数、这个人能不能记录。
 *   POST 项目写权限：记录一次（第一次 / 更正 / 补记）。每一次追加一条记录，不覆盖之前的。
 *
 * 开关 TENDER_SUBMISSION_RECORD_ENABLED 关闭（或组织不在名单）、或项目不是招投标项目 → 404。
 * 组织只取自服务端加载的项目记录。响应与记录里没有任何金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";
import { parseSubmissionInput } from "@/lib/tender-submission/contract";
import { isSubmissionRecordEnabledForOrg } from "@/lib/tender-submission/flags";
import { loadSubmissionRecordView, recordSubmission } from "@/lib/tender-submission/service";

const notEnabled = () => NextResponse.json({ error: "提交记录未启用" }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user, orgRole, projectRole } = access;
  const orgId = project.orgId;
  if (!orgId || !isSubmissionRecordEnabledForOrg(orgId) || project.workDomain !== "tender") return notEnabled();

  // 有没有项目写权限（与写接口同一组条件，且项目须已分发）
  const canRecord =
    project.intakeStatus === "dispatched" &&
    (isSuperAdmin(user.role) ||
      project.ownerId === user.id ||
      (!!orgRole && hasOrgRole(orgRole, "org_admin")) ||
      (!!projectRole && hasProjectRole(projectRole, "project_admin")));

  const view = await loadSubmissionRecordView({ projectId, orgId, canRecord });
  if (!view) return notEnabled();
  return NextResponse.json({ view });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user } = access;
  const orgId = project.orgId;
  if (!orgId || !isSubmissionRecordEnabledForOrg(orgId) || project.workDomain !== "tender") return notEnabled();

  const body = await request.json().catch(() => null);
  const parsed = parseSubmissionInput(body, new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.errors.join("；"), errors: parsed.errors }, { status: 400 });

  const result = await recordSubmission({
    projectId,
    orgId,
    actor: { id: user.id, name: user.name ?? user.email ?? "", email: user.email ?? "" },
    value: parsed.value,
    request,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const view = await loadSubmissionRecordView({ projectId, orgId, canRecord: true });
  return NextResponse.json({ ok: true, kind: result.kind, view });
}
