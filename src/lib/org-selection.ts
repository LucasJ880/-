/**
 * 「当前组织」本地记忆 — 纯浏览器工具函数（无 React 依赖）。
 *
 * 独立成模块的原因：apiFetch 与 useCurrentOrgId 都需要读取，
 * 而 hooks 链路（use-current-org-id → use-organizations → api-fetch）
 * 若反向 import 会形成循环依赖。
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
