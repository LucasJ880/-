import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; promptId: string }> };

/**
 * 将当前 Prompt（须位于 test 环境）的 active 版本发布到 prod（同 key）
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));
  const targetCode =
    typeof body.targetEnvironmentCode === "string"
      ? body.targetEnvironmentCode.trim().toLowerCase()
      : "prod";
  if (targetCode !== "prod") {
    return NextResponse.json(
      { error: "当前仅支持发布到 prod 环境" },
      { status: 400 }
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  try {
    const result = await db.$transaction(async (tx) => {
      const src = await tx.prompt.findFirst({
        where: { id: promptId, projectId },
        include: {
          environment: true,
          activeVersion: true,
        },
      });

      if (!src) {
        throw new Error("PROMPT_NOT_FOUND");
      }

      if (src.environment.code !== "test") {
        throw new Error("SOURCE_NOT_TEST");
      }

      if (!src.activeVersionId || !src.activeVersion) {
        throw new Error("NO_ACTIVE_VERSION");
      }

      const prodEnv = await tx.environment.findFirst({
        where: { projectId, code: "prod" },
      });
      if (!prodEnv) {
        throw new Error("NO_PROD_ENV");
      }

      let tgt = await tx.prompt.findUnique({
        where: {
          projectId_environmentId_key: {
            projectId,
            environmentId: prodEnv.id,
            key: src.key,
          },
        },
      });

      if (!tgt) {
        tgt = await tx.prompt.create({
          data: {
            projectId,
            environmentId: prodEnv.id,
            key: src.key,
            name: src.name,
            type: src.type,
            status: "active",
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }

      const maxV = await tx.promptVersion.aggregate({
        where: { promptId: tgt.id },
        _max: { version: true },
      });
      const nextV = (maxV._max.version ?? 0) + 1;

      const newVer = await tx.promptVersion.create({
        data: {
          promptId: tgt.id,
          version: nextV,
          content: src.activeVersion.content,
          note: note ?? `自 test v${src.activeVersion.version} 发布`,
          sourceVersionId: src.activeVersion.id,
          createdById: user.id,
        },
      });

      await tx.prompt.update({
        where: { id: tgt.id },
        data: {
          activeVersionId: newVer.id,
          updatedById: user.id,
          name: src.name,
          type: src.type,
        },
      });

      await tx.promptPublishLog.create({
        data: {
          projectId,
          promptKey: src.key,
          fromEnvironmentId: src.environmentId,
          toEnvironmentId: prodEnv.id,
          fromVersionId: src.activeVersion.id,
          toVersionId: newVer.id,
          publishedById: user.id,
          note,
        },
      });

      return {
        promptKey: src.key,
        sourcePromptId: src.id,
        sourceEnvironmentCode: src.environment.code,
        sourceVersion: {
          id: src.activeVersion.id,
          version: src.activeVersion.version,
        },
        targetPromptId: tgt.id,
        targetVersion: {
          id: newVer.id,
          version: newVer.version,
        },
      };
    });

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.UPDATE,
      targetType: AUDIT_TARGETS.PROMPT,
      targetId: promptId,
      afterData: {
        action: "publish_test_to_prod",
        promptKey: result.promptKey,
        fromVersionId: result.sourceVersion.id,
        toVersionId: result.targetVersion.id,
        targetPromptId: result.targetPromptId,
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const map: Record<string, { status: number; error: string }> = {
      PROMPT_NOT_FOUND: { status: 404, error: "Prompt 不存在" },
      SOURCE_NOT_TEST: {
        status: 400,
        error: "仅支持从 test 环境的 Prompt 发布到 prod",
      },
      NO_ACTIVE_VERSION: { status: 400, error: "源 Prompt 没有生效版本" },
      NO_PROD_ENV: {
        status: 400,
        error: "项目中不存在 prod 环境，请先创建",
      },
    };
    const m = map[code];
    if (m) {
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    console.error("[publish]", e);
    return NextResponse.json({ error: "发布失败" }, { status: 500 });
  }
}
