import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { putPrivateBlob, deleteBlob } from "@/lib/files/blob-access";

/**
 * POST /api/sales/quotes/[quoteId]/pdf
 *
 * 报价 PDF 存档：销售发送 Quote 时，前端把导出的 Order Form PDF 原样上传，
 * 作为客户查看与签字的唯一权威版本（解决分享页网页渲染与 PDF 内容不一致）。
 *
 * - body 为 PDF 原始字节（Content-Type: application/pdf）
 * - 存入私有 Blob：sales-quotes/{quoteId}/order-v{version}-{ts}.pdf
 * - 重复发送覆盖存档（删旧传新）；客户已签字（signedPdfPath 存在）后冻结，禁止覆盖
 */
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      version: true,
      createdById: true,
      pdfPath: true,
      signedPdfPath: true,
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (quote.createdById !== user.id && !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权操作此报价单" }, { status: 403 });
  }
  if (quote.signedPdfPath) {
    return NextResponse.json(
      { error: "客户已签署此报价单，PDF 已冻结，不可覆盖" },
      { status: 409 },
    );
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  // PDF 文件魔数 %PDF
  if (buffer.length < 4 || buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    return NextResponse.json({ error: "请上传有效的 PDF 文件" }, { status: 400 });
  }
  if (buffer.length > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF 文件过大（上限 15MB）" }, { status: 400 });
  }

  const pathname = `sales-quotes/${quoteId}/order-v${quote.version}-${Date.now()}.pdf`;
  await putPrivateBlob({
    pathname,
    body: buffer,
    contentType: "application/pdf",
  });

  await db.salesQuote.update({
    where: { id: quoteId },
    data: { pdfPath: pathname },
  });

  // 删除被替换的旧存档（失败不阻断）
  if (quote.pdfPath && quote.pdfPath !== pathname) {
    await deleteBlob(quote.pdfPath).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, pdfPath: pathname });
});
