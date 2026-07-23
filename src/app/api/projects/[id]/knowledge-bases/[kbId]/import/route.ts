/**
 * POST /api/projects/:id/knowledge-bases/:kbId/import
 * 项目知识库 Markdown/ZIP 批量导入（单次版本 bump）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireDiagnosticProjectManageAccess as requireProjectManageAccess } from "@/lib/projects/diagnostic-access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  importVaultToProjectKnowledgeBase,
  importZipToProjectKnowledgeBase,
} from "@/lib/knowledge-bases/vault-import";
import type { VaultFileInput } from "@/lib/knowledge/markdown-vault-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; kbId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, kbId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const defaultCategory = String(form.get("defaultCategory") || "general");
  const entries = form.getAll("file").concat(form.getAll("files"));
  const blobs = entries.filter((item): item is File => item instanceof File);
  if (blobs.length === 0) {
    return NextResponse.json(
      { error: "请上传 .md / .txt 或 Obsidian 导出的 .zip" },
      { status: 400 },
    );
  }

  try {
    let result;
    if (blobs.length === 1 && /\.zip$/i.test(blobs[0]!.name)) {
      const buffer = new Uint8Array(await blobs[0]!.arrayBuffer());
      if (buffer.byteLength > 12 * 1024 * 1024) {
        return NextResponse.json({ error: "ZIP 不能超过 12MB" }, { status: 400 });
      }
      result = await importZipToProjectKnowledgeBase({
        projectId,
        kbId,
        userId: user.id,
        zip: buffer,
        defaultCategory,
      });
    } else {
      const files: VaultFileInput[] = [];
      for (const blob of blobs.slice(0, 100)) {
        if (!/\.(md|mdx|txt|markdown)$/i.test(blob.name)) continue;
        files.push({ path: blob.name, content: await blob.text() });
      }
      if (files.length === 0) {
        return NextResponse.json({ error: "未识别到 Markdown/文本文件" }, { status: 400 });
      }
      result = await importVaultToProjectKnowledgeBase({
        projectId,
        kbId,
        userId: user.id,
        files,
        defaultCategory,
      });
    }

    await logAudit({
      userId: user.id,
      orgId: project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.CREATE,
      targetType: AUDIT_TARGETS.KNOWLEDGE_DOCUMENT,
      targetId: kbId,
      afterData: { import: true, created: result.created },
      request,
    });

    return NextResponse.json(
      {
        ...result,
        note: "已导入项目知识库（vault_import）。会话 Agent 将读取生效版本中的文档。",
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 400 },
    );
  }
}
