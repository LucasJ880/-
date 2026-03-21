/**
 * 客户端统一 fetch：带 cookie，401 时跳转登录（波次 B · E4）
 * 仅应在浏览器环境调用（"use client" 组件内）。
 */

const AUTH_PATH_PREFIXES = ["/login", "/register"];

export type ApiFetchInit = RequestInit & {
  /** 为 true 时不做 401 跳转（如登录页调试用） */
  skipAuthRedirect?: boolean;
};

function shouldRedirectOn401(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return !AUTH_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * 与原生 fetch 类似；默认 `credentials: "include"`。
 * 非登录/注册页收到 401 时跳转 `/login?next=当前路径`。
 */
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
