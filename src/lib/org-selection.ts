/**
 * 「当前组织」本地记忆 — 纯浏览器工具函数（无 React 依赖）。
 *
 * 独立成模块的原因：apiFetch 与 useCurrentOrgId 都需要读取，
 * 而 hooks 链路（use-current-org-id → use-organizations → api-fetch）
 * 若反向 import 会形成循环依赖。
 *
 * 服务端偏好字段 User.activeOrgId 与此处双写：登出再登入仍沿用。
 */

export const SELECTED_ORG_STORAGE_KEY = "qingyan_selected_org_id";

export function readStoredOrgId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** 将用户选择的组织写入 localStorage（供非 /organizations/:id 路由下的多组织场景使用） */
export function persistSelectedOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId.trim());
    window.dispatchEvent(new Event("qingyan-org-storage"));
  } catch {
    /* ignore */
  }
}

/**
 * 选定当前工作组织：本地 + 服务端双写。
 * 成功后触发 qingyan-org-storage，供 hooks / apiFetch 立即生效。
 */
export async function selectActiveOrganization(
  orgId: string,
  options?: { reload?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const id = orgId.trim();
  if (!id) return { ok: false, error: "orgId 为空" };

  persistSelectedOrgId(id);

  try {
    const res = await fetch("/api/auth/active-org", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orgId: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || "保存当前组织失败" };
    }
  } catch {
    // 本地已写入；服务端失败时下次 hydrate 可能覆盖，提示但不阻断
    return { ok: false, error: "网络错误，当前组织仅保存在本机" };
  }

  if (options?.reload) {
    window.location.reload();
  }
  return { ok: true };
}

/** 从服务端偏好 hydrate 到 localStorage（登录后 / AppShell 启动时） */
export function hydrateStoredOrgId(orgId: string | null | undefined) {
  if (!orgId?.trim()) return;
  const current = readStoredOrgId();
  if (current === orgId.trim()) return;
  persistSelectedOrgId(orgId);
}
