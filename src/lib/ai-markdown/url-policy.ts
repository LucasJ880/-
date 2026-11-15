/**
 * 模型输出按 Markdown 渲染时的地址判定（openspec change ai-markdown-image-allowlist，
 * spec agents/ai-output-rendering）。
 *
 * 纯函数：不引 React、不读环境、不发请求。同一输入在任何组织 / 用户 / 部署下结果相同。
 *
 * 为什么要这一层：模型读到的外部内容（邮件、网页、标书、附件）可以让它在回复里写一张
 * 地址里夹着数据的图片；浏览器一渲染就会去请求那个地址，数据不经用户点击就出去了。
 * 所以图片只放行站内文件代理下的地址，其余一律不生成会自动加载的元素。
 */

/** 唯一放行的图片来源：站内文件鉴权代理（src/app/api/files/[...path]/route.ts）。 */
export const AI_IMAGE_ALLOWED_PREFIX = "/api/files/";

/**
 * 两个不同的占位源。一个地址只有在对两个占位源解析后都仍落在各自的源上，才算「站内相对地址」——
 * 这样模型即使把其中一个占位主机名原样写进地址，也过不了另一个。
 * 用 URL 解析器做规范化而不是正则：`//host/x`、`/\host/x`、夹制表符的 `/<TAB>/host/x`
 * 都会被解析到别的主机；`..` 与 `%2e%2e` 都会被折叠。
 */
const PLACEHOLDER_ORIGINS = ["https://qingyan-a.invalid", "https://qingyan-b.invalid"] as const;

const MAX_ALT_CHARS = 80;
const MAX_HOST_CHARS = 60;

/** 按两个占位源解析；任何一次解析失败返回 null。 */
function resolveTwice(raw: string): [URL, URL] | null {
  try {
    return [new URL(raw, PLACEHOLDER_ORIGINS[0]), new URL(raw, PLACEHOLDER_ORIGINS[1])];
  } catch {
    return null;
  }
}

/** 站内相对地址：对两个占位源解析后都没有离开各自的源。 */
function isSiteRelative(resolved: [URL, URL]): boolean {
  return resolved[0].origin === PLACEHOLDER_ORIGINS[0] && resolved[1].origin === PLACEHOLDER_ORIGINS[1];
}

/** 显示用主机名：过长时保留结尾（可注册域名在结尾）。 */
function displayHost(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;
  return host.length > MAX_HOST_CHARS ? `…${host.slice(-(MAX_HOST_CHARS - 1))}` : host;
}

export type AiImageDecision =
  | { allowed: true; /** 规范化后的站内「路径 + 查询串」，浏览器请求的就是它 */ src: string }
  | { allowed: false; /** 地址里的主机名；站内其它路径、无主机的协议、无法解析时为 null */ host: string | null };

/**
 * 图片地址判定：以单个 `/` 开头、解析后不离开站内、规范化路径位于 `/api/files/` 之下才放行。
 * 带协议或主机的绝对地址（含指向青砚自己域名的）一律不放行。
 */
export function classifyAiImageSrc(raw: unknown): AiImageDecision {
  if (typeof raw !== "string" || raw.length === 0) return { allowed: false, host: null };
  const resolved = resolveTwice(raw);
  if (!resolved) return { allowed: false, host: null };

  if (!isSiteRelative(resolved)) {
    return { allowed: false, host: displayHost(resolved[0].hostname) };
  }
  const { pathname, search } = resolved[0];
  const underProxy = pathname.startsWith(AI_IMAGE_ALLOWED_PREFIX) && pathname.length > AI_IMAGE_ALLOWED_PREFIX.length;
  if (raw[0] !== "/" || !underProxy) return { allowed: false, host: null };
  return { allowed: true, src: `${pathname}${search}` };
}

/** 被拦下的图片在原位置显示的文字：有替代文字 / 主机名才带上，不含地址的路径与查询串。 */
export function blockedImageLabel(alt: unknown, host: string | null): string {
  const cleanAlt = typeof alt === "string" ? alt.replace(/\s+/g, " ").trim() : "";
  const shownAlt = cleanAlt.length > MAX_ALT_CHARS ? `${cleanAlt.slice(0, MAX_ALT_CHARS - 1)}…` : cleanAlt;
  const altPart = shownAlt ? `：${shownAlt}` : "";
  const hostPart = host ? ` · ${host}` : "";
  return `〔图片未加载${altPart}${hostPart}〕`;
}

export type AiLinkInfo =
  | { external: false }
  | { external: true; /** 链接真实去向的主机名 */ host: string };

/** 链接是否指向外部主机：解析后离开站内、且是 http / https。其余（站内相对、mailto 等）按非外部处理。 */
export function classifyAiLinkHref(raw: unknown): AiLinkInfo {
  if (typeof raw !== "string" || raw.length === 0) return { external: false };
  const resolved = resolveTwice(raw);
  if (!resolved || isSiteRelative(resolved)) return { external: false };
  const url = resolved[0];
  if (url.protocol !== "http:" && url.protocol !== "https:") return { external: false };
  const host = displayHost(url.hostname);
  return host ? { external: true, host } : { external: false };
}

/** 链接文字里已经含目标主机名时不再重复显示；否则返回要追加在链接后面的主机名。 */
export function linkHostSuffix(linkText: string, host: string): string | null {
  return linkText.toLowerCase().includes(host.replace(/^…/, "")) ? null : host;
}
