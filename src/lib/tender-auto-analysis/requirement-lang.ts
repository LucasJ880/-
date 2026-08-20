/**
 * 语言启发式（零依赖纯函数；server 翻译服务与 client 矩阵卡共用，防口径漂移）。
 */

/**
 * 是否需要翻译成中文：CJK 字符占比 < 15% 视为非中文。
 * 阈值取宽：中英混排的真中文译文（含大量代号/单位/标准号）不会被误判重翻。
 */
export function needsChineseTranslation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const cjk = t.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  return cjk / t.length < 0.15;
}
