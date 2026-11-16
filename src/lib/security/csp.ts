/**
 * 全站内容安全策略（openspec change site-csp-baseline，spec platform/content-security-policy）。
 *
 * 纯函数：只读传入的环境变量，不碰 DOM、不发请求。next.config.ts 的 headers() 调它。
 *
 * 这一版是「基线」：只收紧确定不会误伤现有页面的几类——被别的网站嵌套、表单与 base 劫持、
 * 插件对象、外部嵌入框架、外部媒体 / 字体 / worker、浏览器向外部主机发起的网络请求。
 *
 * 有意不限制的三类（见 design「为什么不限制」）：
 * - 图片：企业 Logo、头像、面料目录、邮件预览里的企业图片等来自任意主机，列不出允许清单；
 * - 脚本、样式：框架依赖内联脚本，页面大量使用内联样式，要限制得先上 nonce。
 * 所以这里没有 default-src，也没有 img-src / script-src / style-src。
 *
 * 另有一条给文件代理（/api/files）的响应用：fileResponseCsp——上传或生成的文件被直接打开时放进沙箱，
 * 里面的脚本不执行、也拿不到登录身份。
 */

export type CspMode = "enforce" | "report-only" | "off";

type Env = Record<string, string | undefined>;

/** CSP_MODE：enforce（缺省）/ report-only（只上报不拦截）/ off（不发这个响应头）。写错的值按缺省处理。 */
export function resolveCspMode(env: Env): CspMode {
  const raw = (env.CSP_MODE ?? "").trim().toLowerCase();
  return raw === "off" || raw === "report-only" ? raw : "enforce";
}

/** Sentry 浏览器端直连时的上报主机（配置了 NEXT_PUBLIC_SENTRY_DSN 才有；走 /monitoring 隧道时用不到，多放行无害） */
export function sentryIngestOrigin(env: Env): string | null {
  const dsn = (env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" || !url.hostname) return null;
    // 只取源，丢掉 DSN 里的公钥与项目号
    return `https://${url.host}`;
  } catch {
    return null;
  }
}

/**
 * 基线策略的各条指令（顺序固定）。同一组环境变量下结果相同。
 * 预览环境（VERCEL_ENV=preview）额外放行 Vercel 工具条用到的主机；开发环境放行本机热更新的 WebSocket。
 */
export function buildCspDirectives(env: Env): string[] {
  const isPreview = env.VERCEL_ENV === "preview";
  const isDev = env.NODE_ENV === "development";

  const connect = ["'self'"];
  const sentry = sentryIngestOrigin(env);
  if (sentry) connect.push(sentry);
  if (isPreview) connect.push("https://vercel.live", "wss://ws-us3.pusher.com");
  if (isDev) connect.push("ws://localhost:*", "ws://127.0.0.1:*");

  const frame = ["'self'"];
  if (isPreview) frame.push("https://vercel.live");

  const font = ["'self'", "data:"];
  if (isPreview) font.push("https://vercel.live", "https://assets.vercel.com");

  return [
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `frame-src ${frame.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    "media-src 'self' blob: data:",
    `font-src ${font.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
}

export interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

/** 页面与静态文件；不含接口（/api）、框架静态资源（/_next）、Sentry 隧道、以及单独处理的粗报价工具页 */
export const CSP_PAGE_SOURCE = "/((?!api/|_next/|monitoring|sunny-quote\\.html).*)";
/** 粗报价工具页：自带一整段内联脚本并按需从 CDN 取识别库，只加「不许被别的网站嵌套」 */
export const CSP_ROUGH_QUOTE_SOURCE = "/sunny-quote.html";

/** next.config.ts 的 headers() 返回值；off 时为空数组 */
export function buildSecurityHeaders(env: Env): HeaderRule[] {
  const mode = resolveCspMode(env);
  if (mode === "off") return [];
  const key = mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  return [
    { source: CSP_PAGE_SOURCE, headers: [{ key, value: buildCspDirectives(env).join("; ") }] },
    { source: CSP_ROUGH_QUOTE_SOURCE, headers: [{ key, value: "frame-ancestors 'self'" }] },
  ];
}

/**
 * 文件代理（/api/files）响应的策略：除 PDF 外一律 `sandbox`。
 *
 * 文件的内容类型是上传时存下的；一旦有人传进一份网页或带脚本的 SVG，别的成员直接打开这个地址时，
 * 浏览器会把它当成青砚自己的页面来执行。加了 `sandbox`，这份文档里的脚本不执行，
 * 文档也不算青砚这个站点（读不到登录状态）。`<img>` 引用图片、带 attachment 的下载都不受影响
 * （沙箱只作用于「被当成文档打开」的情况）。
 *
 * PDF 不加：Chrome 自带的 PDF 阅读器在沙箱里打不开；PDF 本身也不会在站点身份下执行脚本。
 * 沙箱没有「只上报」的形式，所以 report-only 模式下照常生效；只有 off 才不发。
 */
export function fileResponseCsp(contentType: string | null | undefined, env: Env): string | null {
  if (resolveCspMode(env) === "off") return null;
  const essence = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return essence === "application/pdf" ? null : "sandbox";
}
