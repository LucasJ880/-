/**
 * POST /api/trade/knowledge/import
 * multipart: file(.zip|.md|.txt) 或 files[]；可选 defaultCategory、orgId
 * 平台边界：只写入当前组织 TradeKnowledge，不双向同步 Obsidian。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { logAudit } from "@/lib/audit/logger";
import {
  importVaultDocumentsToTradeKnowledge,
  importZipToTradeKnowledge,
} from "@/lib/trade/knowledge-import";
import type { VaultFileInput } from "@/lib/knowledge/markdown-vault-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: String(form.get("orgId") || ""),
  });
  if (!orgRes.ok) return orgRes.response;

  const defaultCategory = String(form.get("defaultCategory") || "product");
  const entries = form.getAll("file").concat(form.getAll("files"));
  const blobs = entries.filter((item): item is File => item instanceof File);

  if (blobs.length === 0) {
    return NextResponse.json(
      { error: "请上传 .md / .txt 文件，或 Obsidian 导出的 .zip" },
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
      result = await importZipToTradeKnowledge({
        orgId: orgRes.orgId,
        userId: auth.user.id,
        zip: buffer,
        defaultCategory,
      });
    } else {
      const files: VaultFileInput[] = [];
      for (const blob of blobs.slice(0, 200)) {
        if (!/\.(md|mdx|txt|markdown)$/i.test(blob.name)) {
          continue;
        }
        if (blob.size > 2 * 1024 * 1024) {
          return NextResponse.json(
            { error: `单文件过大：${blob.name}` },
            { status: 400 },
          );
        }
        files.push({
          path: blob.name,
          content: await blob.text(),
        });
      }
      if (files.length === 0) {
        return NextResponse.json(
          { error: "未识别到可导入的 Markdown/文本文件" },
          { status: 400 },
        );
      }
      result = await importVaultDocumentsToTradeKnowledge({
        orgId: orgRes.orgId,
        userId: auth.user.id,
        files,
        defaultCategory,
      });
    }

    await logAudit({
      userId: auth.user.id,
      orgId: orgRes.orgId,
      action: "trade_knowledge_vault_import",
      targetType: "trade_knowledge",
      targetId: orgRes.orgId,
      afterData: {
        created: result.created,
        skipped: result.skipped.length,
      },
      request,
    });

    return NextResponse.json(
      {
        ...result,
        note: "已写入组织外贸知识库。Obsidian 仅作起草工具；组织知识以青砚为准，数字员工从此检索。",
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
