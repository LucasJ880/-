import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { createImportFromUpload, IMPORT_MAX_FILE_SIZE, listImports, serializeImport } from "@/lib/quote-engine/import/import-service";
import { IMPORT_SUPPORTED_EXTENSIONS } from "@/lib/quote-engine/import/contract";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";

/**
 * 成本导入（Quote Operations Phase 2）
 *  GET  ：导入记录列表（internal_cost：供应商成本属内部数据）
 *  POST ：上传供应商报价 / 成本表（multipart: file + supplierName? + quoteDate? + defaultCurrency? + reimport? + ai?）
 *         → Upload → Extract → REVIEW_REQUIRED（绝不直接写正式成本行）
 */

// 抽取 + 可引用单元解析 + （可选）AI 分类需要余量
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

function errorResponse(e: unknown) {
  if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
  if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "输入校验失败", code: "VALIDATION", details: (e as { issues: unknown }).issues }, { status: 400 });
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "internal_cost");
  if (access instanceof NextResponse) return access;
  try {
    const records = await listImports({ quoteId, projectId: id, orgId: access.orgId });
    return NextResponse.json({ imports: records.map((r) => serializeImport(r, { withRows: false })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求格式无效，需要 multipart/form-data" }, { status: 400 });
  }
  const entry = form.get("file");
  if (!(entry instanceof File)) return NextResponse.json({ error: "缺少文件（字段名 file）" }, { status: 400 });
  const check = await validateUploadedFileAsync(entry, { maxSize: IMPORT_MAX_FILE_SIZE, allowedExtensions: [...IMPORT_SUPPORTED_EXTENSIONS], checkMagicBytes: true });
  if (!check.ok) return NextResponse.json({ error: check.reason, code: "UPLOAD_REJECTED" }, { status: 400 });
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  try {
    const { record, extraction } = await createImportFromUpload({
      orgId: access.orgId,
      projectId: id,
      quoteId,
      userId: access.user.id,
      file: { buffer: Buffer.from(check.buffer), filename: entry.name, safeName: check.safeName, ext: check.ext, mime: check.mime ?? null, size: check.size },
      supplierName: str("supplierName"),
      quoteDate: str("quoteDate"),
      defaultCurrency: str("defaultCurrency"),
      reimport: str("reimport") === "true",
      ai: { enabled: str("ai") !== "false" },
    });
    return NextResponse.json({ import: serializeImport(record, { withRows: true }), extractionNotes: extraction?.notes ?? [] }, { status: record.status === "FAILED" ? 422 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
