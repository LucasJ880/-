"use client";

import { useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useOrganizations } from "@/lib/hooks/use-organizations";

/** 与外贸 / 秘书等 API 共用的「当前组织」本地记忆（需用户显式写入，见 persistSelectedOrgId） */
export const SELECTED_ORG_STORAGE_KEY = "qingyan_selected_org_id";

function readStoredOrgId(): string {
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
 * 解析当前应使用的 orgId（不信任「列表第一个」为多组织默认值）
 *
 * 优先级：URL `/organizations/:id` → localStorage → 仅一个组织时自动
 */
export function getCurrentOrgIdFromRouteOrStorage(
  pathname: string,
  organizationIds: string[],
): { orgId: string | null; source: "route" | "storage" | "single" | "none" } {
  const routeId = pathname.match(/\/organizations\/([^/]+)/)?.[1];
  if (routeId && organizationIds.includes(routeId)) {
    return { orgId: routeId, source: "route" };
  }
  const stored = readStoredOrgId();
  if (stored && organizationIds.includes(stored)) {
    return { orgId: stored, source: "storage" };
  }
  if (organizationIds.length === 1) {
    return { orgId: organizationIds[0], source: "single" };
  }
  return { orgId: null, source: "none" };
}

function subscribeStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

/**
 * 多组织场景：若 `ambiguous` 为 true，调用方应提示用户选择组织，而不是默认第一个 org。
 */
export function useCurrentOrgId() {
  const pathname = usePathname();
  const { organizations, loading } = useOrganizations();
  const organizationIds = useMemo(() => organizations.map((o) => o.id), [organizations]);

  const storedSnapshot = useSyncExternalStore(
    subscribeStorage,
    readStoredOrgId,
    () => "",
  );

  const { orgId, source } = useMemo(() => {
    const ids = organizationIds;
    const routeId = pathname.match(/\/organizations\/([^/]+)/)?.[1];
    if (routeId && ids.includes(routeId)) {
      return { orgId: routeId, source: "route" as const };
    }
    const stored = storedSnapshot.trim();
    if (stored && ids.includes(stored)) {
      return { orgId: stored, source: "storage" as const };
    }
    if (ids.length === 1) {
      return { orgId: ids[0], source: "single" as const };
    }
    return { orgId: null, source: "none" as const };
  }, [pathname, organizationIds, storedSnapshot]);

  const ambiguous = organizations.length > 1 && source === "none";

  return { orgId, source, ambiguous, loading, organizations };
}
