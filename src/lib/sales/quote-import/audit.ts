/**
 * 导入留痕 → 审计内容（QUOTE-1b，openspec change quote-import-studio-file，design D10）
 *
 * 报价表单数据里的 `importSource` 由浏览器在「导入报价文件」时写入；服务端在新建 / 修改两条保存路径上
 * 读它，同一张报价的同一次导入只写一条审计 `quote_imported`。
 * 纯函数：只读白名单字段，审计内容不含客户电话、邮箱、地址。
 */

export const QUOTE_IMPORTED_AUDIT_ACTION = "quote_imported";

export interface ImportSourceAudit {
  tool: "sunny-quote-studio";
  fileVersion: number | null;
  quoteId: string;
  quoteNumber: string;
  plan: string;
  exportedAt: string;
  pricelistVersion: string;
  fileGrandTotal: number | null;
  importedAt: string;
  pricelistMatch: boolean | null;
  rowCount: number | null;
}

const MAX_TEXT = 200;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 从 formDataJson 里读出留痕；没有、解析失败或形状不对 → null（不抛错） */
export function readImportSource(formDataJson: string | null | undefined): ImportSourceAudit | null {
  if (typeof formDataJson !== "string" || !formDataJson) return null;
  let form: unknown;
  try {
    form = JSON.parse(formDataJson);
  } catch {
    return null;
  }
  if (!form || typeof form !== "object" || Array.isArray(form)) return null;
  const raw = (form as { importSource?: unknown }).importSource;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (src.tool !== "sunny-quote-studio") return null;
  const quoteId = text(src.quoteId);
  const exportedAt = text(src.exportedAt);
  const importedAt = text(src.importedAt);
  // 没有这三项就无法判断「是不是同一次导入」
  if (!quoteId || !exportedAt || !importedAt) return null;
  return {
    tool: "sunny-quote-studio",
    fileVersion: finite(src.fileVersion),
    quoteId,
    quoteNumber: text(src.quoteNumber),
    plan: text(src.plan),
    exportedAt,
    pricelistVersion: text(src.pricelistVersion),
    fileGrandTotal: finite(src.fileGrandTotal),
    importedAt,
    pricelistMatch: typeof src.pricelistMatch === "boolean" ? src.pricelistMatch : null,
    rowCount: finite(src.rowCount),
  };
}

function importKey(s: ImportSourceAudit): string {
  return `${s.quoteId}|${s.exportedAt}|${s.importedAt}`;
}

/**
 * 这次保存要不要写 `quote_imported`：
 * 新的表单数据带留痕，且（之前没有留痕，或之前的留痕不是同一次导入）→ 返回审计内容；否则 null。
 */
export function importAuditPayload(
  nextFormDataJson: string | null | undefined,
  prevFormDataJson: string | null | undefined,
): ImportSourceAudit | null {
  const next = readImportSource(nextFormDataJson);
  if (!next) return null;
  const prev = readImportSource(prevFormDataJson);
  if (prev && importKey(prev) === importKey(next)) return null;
  return next;
}
