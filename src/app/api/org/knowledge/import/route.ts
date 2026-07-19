import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  importVaultToOrgKnowledge,
  importZipToOrgKnowledge,
} from "@/lib/knowledge/org-knowledge";
import type { VaultFileInput } from "@/lib/knowledge/markdown-vault-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const orgRes = await resolveRequestOrgIdForUser(
    auth.user,
    String(form.get("orgId") || ""),
  );
  if (!orgRes.ok) return orgRes.response;

  if (auth.user.role !== "admin" && auth.user.role !== "super_admin") {
    const membership = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId: orgRes.orgId, userId: auth.user.id } },
      select: { status: true },
    });
    if (membership?.status !== "active") {
      return NextResponse.json({ error: "无权写入该组织知识库" }, { status: 403 });
    }
  }

  const defaultCategory = String(form.get("defaultCategory") || "general");
  const indexVectors = form.get("indexVectors") !== "false";
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
      result = await importZipToOrgKnowledge({
        orgId: orgRes.orgId,
        userId: auth.user.id,
        zip: buffer,
        defaultCategory,
        indexVectors,
      });
    } else {
      const files: VaultFileInput[] = [];
      for (const blob of blobs.slice(0, 200)) {
        if (!/\.(md|mdx|txt|markdown)$/i.test(blob.name)) continue;
        files.push({ path: blob.name, content: await blob.text() });
      }
      if (files.length === 0) {
        return NextResponse.json({ error: "未识别到 Markdown/文本文件" }, { status: 400 });
      }
      result = await importVaultToOrgKnowledge({
        orgId: orgRes.orgId,
        userId: auth.user.id,
        files,
        defaultCategory,
        indexVectors,
      });
    }

    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: "org_knowledge_vault_import",
      targetType: "org_knowledge_document",
      targetId: orgRes.orgId,
      afterData: { created: result.created, skipped: result.skipped.length },
      request,
    });

    return NextResponse.json(
      {
        ...result,
        note: "已写入组织知识库并尝试向量索引。青砚为真相源；Obsidian 仅作起草导入。",
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
