import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isValidKbStatus } from "@/lib/knowledge-bases/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; kbId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const kb = await db.knowledgeBase.findFirst({
    where: { id: kbId, projectId },
    include: {
      environment: { select: { id: true, code: true, name: true } },
      activeVersion: {
        select: {
          id: true,
          version: true,
          note: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!kb) {
    return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  }

  const recentVersions = await db.knowledgeBaseVersion.findMany({
    where: { knowledgeBaseId: kbId },
    orderBy: { version: "desc" },
    take: 8,
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  let documents: {
    id: string;
    title: string;
    sourceType: string;
    sourceUrl: string | null;
    status: string;
    sortOrder: number;
    updatedAt: Date;
    activeSnapshot: {
      id: string;
      version: number;
      content: string;
      summary: string | null;
      note: string | null;
    } | null;
  }[] = [];

  if (kb.activeVersionId) {
    const snaps = await db.knowledgeDocumentVersion.findMany({
      where: { knowledgeBaseVersionId: kb.activeVersionId },
      include: { document: true },
    });
    snaps.sort((a, b) => {
      if (a.document.sortOrder !== b.document.sortOrder) {
        return a.document.sortOrder - b.document.sortOrder;
      }
      return a.document.createdAt.getTime() - b.document.createdAt.getTime();
    });
    documents = snaps.map((s) => ({
      id: s.document.id,
      title: s.document.title,
      sourceType: s.document.sourceType,
      sourceUrl: s.document.sourceUrl,
      status: s.document.status,
      sortOrder: s.document.sortOrder,
      updatedAt: s.document.updatedAt,
      activeSnapshot: {
        id: s.id,
        version: s.version,
        content: s.content,
        summary: s.summary,
        note: s.note,
      },
    }));
  }

  return NextResponse.json({
    knowledgeBase: {
      id: kb.id,
      projectId: kb.projectId,
      key: kb.key,
      name: kb.name,
      description: kb.description,
      status: kb.status,
      environment: kb.environment,
      activeVersion: kb.activeVersion,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    },
    documents,
    recentKbVersions: recentVersions,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const kb = await db.knowledgeBase.findFirst({
    where: { id: kbId, projectId },
  });
  if (!kb) {
    return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const data: {
    name?: string;
    description?: string | null;
    status?: string;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (body.description === null || typeof body.description === "string") {
    data.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (typeof body.status === "string" && body.status.trim()) {
    const st = body.status.trim();
    if (!isValidKbStatus(st)) {
      return NextResponse.json({ error: "无效的 status" }, { status: 400 });
    }
    data.status = st;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const before = {
    name: kb.name,
    description: kb.description,
    status: kb.status,
  };

  const updated = await db.knowledgeBase.update({
    where: { id: kbId },
    data: {
      ...data,
      updatedById: user.id,
    },
    include: {
      environment: { select: { id: true, code: true, name: true } },
      activeVersion: {
        select: { id: true, version: true },
      },
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.KNOWLEDGE_BASE,
    targetId: kbId,
    beforeData: { ...before, key: kb.key, environmentId: kb.environmentId },
    afterData: {
      name: updated.name,
      description: updated.description,
      status: updated.status,
      key: updated.key,
      environmentId: updated.environmentId,
    },
    request,
  });

  return NextResponse.json({ knowledgeBase: updated });
}
