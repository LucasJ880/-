/**
 * Blob 代理 URL 纯函数（客户端 / 服务端均可引用，禁止依赖 fs）
 */

export const FILE_PROXY_PREFIX = "/api/files/";

/**
 * 从「存储的 URL」提取 Blob pathname。
 * 兼容：Blob 完整 URL / 代理 URL / 纯 pathname
 */
export function blobPathnameFromUrl(urlOrPathname: string): string {
  let path = urlOrPathname;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // 保底按原字符串处理
    }
  }
  path = path.replace(/^\/+/, "");
  const proxyPrefix = FILE_PROXY_PREFIX.replace(/^\/+/, ""); // "api/files/"
  if (path.startsWith(proxyPrefix)) {
    path = path.slice(proxyPrefix.length);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** 存储 URL / pathname → 浏览器可用的代理 URL。 */
export function toProxyUrl(urlOrPathname: string): string {
  const pathname = blobPathnameFromUrl(urlOrPathname);
  const encoded = pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${FILE_PROXY_PREFIX}${encoded}`;
}

/** 判断一个 URL 是否已是本系统代理 URL（避免重复包装）。 */
export function isProxyUrl(url: string): boolean {
  return url.startsWith(FILE_PROXY_PREFIX);
}
