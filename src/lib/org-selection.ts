/**
 * 「当前组织」本地记忆 — 纯浏览器工具函数（无 React 依赖）。
 *
 * Security-1：自助切换走 /api/auth/switch-org；FIXED 用户不可切换。
 */

export const SELECTED_ORG_STORAGE_KEY = "qingyan_selected_org_id";
export const SELECTED_WORKSPACE_STORAGE_KEY = "qingyan_selected_workspace_id";

export function readStoredOrgId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function persistSelectedOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId.trim());
    window.dispatchEvent(new Event("qingyan-org-storage"));
  } catch {
    /* ignore */
  }
}

export function clearOrgScopedClientState(opts?: { keepOrgId?: string }) {
  if (typeof window === "undefined") return;
  try {
    // Workspace 选择按 org 隔离；切换时清空旧 key
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith("qingyan:quote-sheet-draft:") ||
        k.startsWith(`${SELECTED_WORKSPACE_STORAGE_KEY}:`) ||
        k.startsWith("qy_proj_tab_")
      ) {
        // 报价草稿保留其他 org 的；仅清当前会话相关 workspace
        if (k.startsWith(`${SELECTED_WORKSPACE_STORAGE_KEY}:`)) {
          keysToRemove.push(k);
        }
      }
    }
    for (const k of keysToRemove) window.localStorage.removeItem(k);
    if (opts?.keepOrgId) {
      persistSelectedOrgId(opts.keepOrgId);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 选定当前工作组织：走 Security-1 switch-org API。
 * FIXED 用户会收到 ORG_SWITCH_NOT_ALLOWED。
 */
export async function selectActiveOrganization(
  orgId: string,
  options?: { reload?: boolean },
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const id = orgId.trim();
  if (!id) return { ok: false, error: "orgId 为空" };

  try {
    const res = await fetch("/api/auth/switch-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orgId: id }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      activeOrgId?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || "切换工作企业失败",
        code: data.code,
      };
    }
    clearOrgScopedClientState({ keepOrgId: data.activeOrgId ?? id });
    persistSelectedOrgId(data.activeOrgId ?? id);
  } catch {
    return { ok: false, error: "网络错误，未能切换工作企业" };
  }

  if (options?.reload !== false) {
    window.location.assign("/");
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

/** Workspace 选择 key（含 orgId） */
export function workspaceStorageKey(orgId: string): string {
  return `${SELECTED_WORKSPACE_STORAGE_KEY}:${orgId}`;
}
