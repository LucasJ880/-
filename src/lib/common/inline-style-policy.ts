/**
 * 内联样式过滤（openspec change ai-html-preview-no-autoload，spec agents/ai-output-rendering）。
 *
 * 纯函数：不碰 DOM、不读环境。只保留不会让浏览器加载资源的声明。
 *
 * 为什么按「函数允许清单」而不是「禁用 url()」：浏览器经内联样式加载资源都要通过函数记号
 * （url()、image-set()、image()、cross-fade()、element() ……），新的函数还会再加。
 * 所以反过来只放行几种确定不加载东西的函数，其余一律去掉。
 * 反斜杠一刀切：CSS 转义（`u\72l(`）怎么还原取决于解析器，这里不赌，直接不要。
 */

/** 值里允许出现的函数：颜色与计算，都不加载任何东西 */
const SAFE_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "calc"]);

const PROPERTY_RE = /^-?[a-z][a-z0-9-]*$/;
const FUNCTION_RE = /([a-z-]+)\s*\(/gi;

function isSafeValue(value: string): boolean {
  if (!value) return false;
  // 转义、注释、@ 规则：都不是邮件正文样式需要的东西
  if (value.includes("\\") || value.includes("/*") || value.includes("@")) return false;
  for (const m of value.matchAll(FUNCTION_RE)) {
    if (!SAFE_FUNCTIONS.has(m[1].toLowerCase())) return false;
  }
  // 没有函数名的裸括号（如 `(`）不是合法值，也不放行
  const withoutSafeCalls = value.replace(FUNCTION_RE, "");
  return !withoutSafeCalls.includes("(");
}

/**
 * 过滤一段内联样式，返回只含安全声明的样式文本（保留原顺序）；一条都不剩时返回空字符串。
 *
 * 按 `;` 朴素拆分：引号里带 `;` 的值会被拆坏，但那种值本来就要去掉——拆出来的碎片
 * 要么没有冒号、要么过不了值检查，同样被丢弃。
 */
export function sanitizeInlineStyle(style: unknown): string {
  if (typeof style !== "string" || style.length === 0) return "";
  const kept: string[] = [];
  for (const raw of style.split(";")) {
    const colon = raw.indexOf(":");
    if (colon <= 0) continue;
    const property = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    if (!PROPERTY_RE.test(property)) continue;
    if (!isSafeValue(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join("; ");
}
