/**
 * 乱码时代生成文档的列表过滤（2026-09-03 Lucas「批量作废」，取不删数据的安全口径）
 *
 * 两类被隐藏（行与 Blob 保留，可审计可回滚）：
 *  ① jsPDF 时代的 .pdf（无 renderMode 元数据）——无 CJK 字体，中文全是方块（「真文件、假内容」）
 *  ② renderMode=html_fallback:* 的回落件——Chromium 修复前的降级产物，被 UI 按 .pdf 命名时误报「已损坏」
 * chromium_pdf 与其后的一切正常件不受影响。
 */

export function isLegacyGarbledGeneratedDoc(doc: { metaJson: string | null; blobUrl: string | null }): boolean {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(doc.metaJson ?? "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const renderMode = typeof meta.renderMode === "string" ? meta.renderMode : null;
  if (renderMode?.startsWith("html_fallback")) return true;
  if (!renderMode && (doc.blobUrl ?? "").endsWith(".pdf")) return true;
  return false;
}
