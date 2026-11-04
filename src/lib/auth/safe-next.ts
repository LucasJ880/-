/**
 * 登录回跳（COLLAB-2 design D11，spec notifications/click-targets）
 *
 * 纯函数：中间件（edge）、登录页与选择组织页共用。
 * - next 只接受站内路径：以 / 开头、不以 // 开头，不含反斜杠、空白或控制字符；其他值一律当作 /。
 * - 中间件把未登录的页面请求跳到 /login?next=<路径+查询串>；原路径为 / 时不带 next。
 * - 浏览器不把锚点发给服务端；登录页与选择组织页把当前地址的锚点接回 next 后面。
 */

const UNSAFE_NEXT_CHARS = /[\\\s\u0000-\u001f\u007f-\u009f]/;

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (UNSAFE_NEXT_CHARS.test(raw)) return "/";
  return raw;
}

/** 未登录访问页面 → 登录页地址 */
export function loginRedirectPath(pathname: string, search: string = ""): string {
  const target = safeNextPath(`${pathname}${search}`);
  if (target === "/") return "/login";
  return `/login?next=${encodeURIComponent(target)}`;
}

const SAFE_HASH = /^#[A-Za-z0-9_-]+$/;

/** 把锚点（只接受 # 后跟字母、数字、-、_）接到 next 后面；next 已带锚点时不再接 */
export function appendSafeHash(next: string, hash: string | null | undefined): string {
  if (!hash || !SAFE_HASH.test(hash) || next.includes("#")) return next;
  return `${next}${hash}`;
}
