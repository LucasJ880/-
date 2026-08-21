import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { generateCustomerQuotationPdf, listCustomerQuotationPdfs } from "@/lib/quote-engine/quotation-pdf";

/**
 * Customer Quotation PDF
 *  GET  ：本报价已生成的 PDF 列表（read）
 *  POST ：生成（edit = Customer Quote Export；渲染前泄露门 fail-closed；修订后旧 PDF 保留）
 */

// CJK-PDF 包：Chromium 冷启动 + 渲染需要余量（生成文档为低频动作）
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

function errorResponse(e: unknown) {
  if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "read");
  if (access instanceof NextResponse) return access;
  try {
    return NextResponse.json({ documents: await listCustomerQuotationPdfs({ quoteId, projectId: id, orgId: access.orgId }) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  try {
    const doc = await generateCustomerQuotationPdf({ quoteId, projectId: id, orgId: access.orgId, userId: access.user.id });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
