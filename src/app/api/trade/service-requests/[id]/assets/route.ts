/**
 * 外贸客户服务工单 — 资产上传（输入图 / 交付物）
 *
 * POST /api/trade/service-requests/[id]/assets   (multipart/form-data)
 *   fields: file（必填）, kind（input|deliverable，默认 input）
 *
 * 客户 org 或处理方 org 都可上传；资产归属客户 org。
 */

import { NextRequest, NextResponse } from "next/server";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { addRequestAsset } from "@/lib/trade/service-request";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "文件过大（上限 15MB）" }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: `不支持的文件类型: ${mime}` }, { status: 400 });
  }

  const kind = form.get("kind") === "deliverable" ? "deliverable" : "input";
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const ts = Date.now();
  const pathname = `trade-service/${orgRes.orgId}/${id}/${kind}/${ts}_${safeName}`;

  const blob = await putPrivateBlob({ pathname, body: buffer, contentType: mime });

  try {
    const asset = await addRequestAsset({
      requestId: id,
      callerOrgId: orgRes.orgId,
      kind,
      fileUrl: blob.proxyUrl,
      fileName: safeName,
      mimeType: mime,
      createdById: auth.user.id,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "资产写入失败" },
      { status: 400 },
    );
  }
}
