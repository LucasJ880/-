/**
 * 公开报价 PDF — 无需登录，通过 shareToken 访问
 *
 * 客户以此 PDF 为准查看报价并签字：
 * - 已签署时返回盖了签名的 signedPdfPath
 * - 否则返回发送时存档的 pdfPath
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readBlobStream } from "@/lib/files/blob-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token || token.length < 8) {
    return NextResponse.json({ error: "无效的分享链接" }, { status: 400 });
  }

  const quote = await db.salesQuote.findUnique({
    where: { shareToken: token },
    select: { id: true, orderNumber: true, pdfPath: true, signedPdfPath: true },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价不存在或链接已失效" }, { status: 404 });
  }

  const pdfPath = quote.signedPdfPath || quote.pdfPath;
  if (!pdfPath) {
    return NextResponse.json({ error: "此报价暂无 PDF 版本" }, { status: 404 });
  }

  const blob = await readBlobStream(pdfPath);
  if (!blob) {
    return NextResponse.json({ error: "PDF 文件读取失败" }, { status: 404 });
  }

  const filename = `Order_${quote.orderNumber || quote.id}${quote.signedPdfPath ? "_signed" : ""}.pdf`;
  const download = request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      ...(blob.size ? { "Content-Length": String(blob.size) } : {}),
    },
  });
}
