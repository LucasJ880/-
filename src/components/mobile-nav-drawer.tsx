"use client";

/**
 * 移动端一级分类 → 二级菜单（不把桌面侧栏压成超长列表）
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { apiFetch } from "@/lib/api-fetch";
import type { OrgModulesConfig } from "@/lib/tenancy/modules";
import {
  MOBILE_TOP_CATEGORIES,
  NAVIGATION_REGISTRY,
  resolveNavigationTree,
  type NavigationFilterContext,
  type NavigationGroup,
  type ResolvedNavItem,
} from "@/lib/navigation";
import { useLocale } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { CoBrand } from "@/components/co-brand";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";
import { isPlatformAdmin as checkPlatformAdmin } from "@/lib/permissions-client";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export function MobileNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { m } = useLocale();
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const [drill, setDrill] = useState<NavigationGroup | null>(null);
  const [orgModules, setOrgModules] = useState<OrgModulesConfig | null>(null);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [hasMembership, setHasMembership] = useState(false);

  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );

  useEffect(() => {
    if (!open) setDrill(null);
  }, [open]);

  // 打开时锁定 main（AppShell 主滚动）+ body/html；关闭/卸载恢复 previous
  useEffect(() => {
    if (!open) return;
    return lockAppScroll("mobile-nav-drawer");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/active-org");
        if (!res.ok) return;
        const data = (await res.json()) as {
          modules?: OrgModulesConfig | null;
          workspaceIds?: string[];
          orgRole?: string | null;
          hasMembership?: boolean;
        };
        if (!cancelled) {
          setOrgModules(data.modules ?? null);
          setWorkspaceIds(data.workspaceIds ?? []);
          setOrgRole(data.orgRole ?? null);
          setHasMembership(Boolean(data.hasMembership ?? data.orgRole));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedOrgId, open]);

  const platformRole = user?.role ?? "user";
  const isPlatformAdmin = checkPlatformAdmin(platformRole);

  const ctx: NavigationFilterContext = useMemo(
    () => ({
      pathname,
      platformRole,
      orgRole:
        orgRole ??
        organizations.find((o) => o.id === storedOrgId)?.myRole ??
        null,
      hasMembership:
        hasMembership ||
        Boolean(organizations.find((o) => o.id === storedOrgId)?.myRole),
      workspaceIds,
      modules: orgModules,
      isPlatformAdmin,
    }),
    [
      pathname,
      platformRole,
      orgRole,
      hasMembership,
      workspaceIds,
      orgModules,
      isPlatformAdmin,
      organizations,
      storedOrgId,
    ],
  );

  const resolved = useMemo(
    () => resolveNavigationTree(NAVIGATION_REGISTRY, ctx),
    [ctx],
  );

  const categoryItems = (group: NavigationGroup): ResolvedNavItem[] => {
    const items = resolved.filter((i) => i.group === group);
    const flat: ResolvedNavItem[] = [];
    for (const item of items) {
      if (item.children?.length) {
        flat.push(...item.children);
      } else {
        flat.push(item);
      }
    }
    return flat;
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--ui-z-drawer-panel)] flex md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="完整导航"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full max-h-dvh w-[min(300px,85vw)] flex-col bg-[#111b1d] text-white animate-in slide-in-from-left duration-200 pb-safe">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-3">
          {drill ? (
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-white/80"
              onClick={() => setDrill(null)}
            >
              <ChevronLeft size={16} />
              返回分类
            </button>
          ) : (
            <CoBrand size="sm" variant="sidebar" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {!drill && (
            <ul className="space-y-1">
              {MOBILE_TOP_CATEGORIES.map((cat) => {
                const items = categoryItems(cat.key);
                const needsMembership = [
                  "OPERATIONS",
                  "CAPABILITIES",
                  "BUSINESS",
                  "GROWTH",
                  "MANAGEMENT",
                ].includes(cat.key);
                if (needsMembership && !ctx.hasMembership) return null;
                // BUSINESS 无稳定落地页：无二级入口时不展示空分类
                if (cat.key === "BUSINESS" && items.length === 0) return null;
                if (
                  cat.key !== "WORK" &&
                  items.length === 0 &&
                  !cat.href
                ) {
                  return null;
                }
                const groupActive = resolved.some(
                  (i) =>
                    i.group === cat.key &&
                    (i.active || i.children?.some((c) => c.active)),
                );
                return (
                  <li key={cat.key}>
                    {cat.href && items.length <= 1 ? (
                      <Link
                        href={cat.href}
                        onClick={onClose}
                        className={cn(
                          "flex min-h-11 items-center rounded-md px-3 text-[15px]",
                          groupActive ||
                            pathname.startsWith(cat.href) ||
                            (cat.href === "/" && pathname === "/")
                            ? "bg-white/10 text-white"
                            : "text-white/75 hover:bg-white/5",
                        )}
                      >
                        {cat.label}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (cat.href && items.length === 0) {
                            onClose();
                            window.location.assign(cat.href);
                            return;
                          }
                          setDrill(cat.key);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between rounded-md px-3 text-left text-[15px] hover:bg-white/5",
                          groupActive
                            ? "bg-white/10 text-white"
                            : "text-white/75",
                        )}
                      >
                        <span>{cat.label}</span>
                        <span className="text-white/35">›</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {drill && (
            <ul className="space-y-1">
              {categoryItems(drill).map((item) => {
                if (!item.href) return null;
                const label =
                  item.labelKey && m[item.labelKey as MessageKey]
                    ? m[item.labelKey as MessageKey]
                    : item.label;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex min-h-10 items-center rounded-md px-3 text-sm",
                        item.active
                          ? "bg-white/10 text-emerald-200"
                          : "text-white/75 hover:bg-white/5",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
