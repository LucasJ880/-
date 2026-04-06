/**
 * 客户端统一 fetch：带 cookie，401 时跳转登录
 * 仅应在浏览器环境调用（"use client" 组件内）。
 *
 * 防循环机制（sessionStorage 跨页面重载持久化）：
 * - 10 秒冷却：上次 401 跳转后 10 秒内不再跳
 * - 3 次熔断：同一会话 60 秒内连续 3 次 401 跳转 → 停止跳转，留在当前页
 */

const AUTH_PATH_PREFIXES = ["/login", "/register"];
const REDIRECT_COOLDOWN_MS = 10_000;
const TS_KEY = "qy_401_ts";
const COUNT_KEY = "qy_401_n";
const MAX_REDIRECTS = 3;
const COUNT_WINDOW_MS = 60_000;
let _redirecting = false;

export type ApiFetchInit = RequestInit & {
  skipAuthRedirect?: boolean;
};

function storageGet(key: string): string {
  try { return sessionStorage.getItem(key) || "0"; } catch { return "0"; }
}
function storageSet(key: string, v: string): void {
  try { sessionStorage.setItem(key, v); } catch {}
}

function shouldRedirectOn401(): boolean {
  if (typeof window === "undefined") return false;
  if (_redirecting) return false;

  const lastTs = Number(storageGet(TS_KEY));
  if (Date.now() - lastTs < REDIRECT_COOLDOWN_MS) return false;

  const count = Number(storageGet(COUNT_KEY));
  if (count >= MAX_REDIRECTS && Date.now() - lastTs < COUNT_WINDOW_MS) return false;

  const path = window.location.pathname;
  return !AUTH_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

function recordRedirect(): void {
  const lastTs = Number(storageGet(TS_KEY));
  const count = Number(storageGet(COUNT_KEY));
  const fresh = Date.now() - lastTs > COUNT_WINDOW_MS;
  storageSet(COUNT_KEY, String(fresh ? 1 : count + 1));
  storageSet(TS_KEY, String(Date.now()));
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiFetchInit
): Promise<Response> {
  const { skipAuthRedirect, ...rest } = init ?? {};
  const res = await fetch(input, {
    ...rest,
    credentials: rest.credentials ?? "include",
  });

  if (
    res.status === 401 &&
    !skipAuthRedirect &&
    shouldRedirectOn401()
  ) {
    _redirecting = true;
    recordRedirect();
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.assign(`/login?next=${next}`);
  }

  return res;
}

/** 读取 JSON；失败时抛出带 status 的 Error */
export async function apiJson<T>(input: RequestInfo | URL, init?: ApiFetchInit): Promise<T> {
  const res = await apiFetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error: unknown }).error)
        : `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
