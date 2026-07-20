"use client";

/**
 * 进入主应用后：用服务端 User.activeOrgId hydrate 本地记忆。
 * 若多组织且尚未选定，跳转 /select-org 强制选定一次。
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  hydrateStoredOrgId,
  persistSelectedOrgId,
  readStoredOrgId,
} from "@/lib/org-selection";

export function ActiveOrgHydrator() {
  const pathname = usePathname();
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (pathname.startsWith("/select-org")) return;
    ran.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/active-org", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          activeOrgId?: string | null;
          needsSelection?: boolean;
          organizations?: Array<{ id: string }>;
        };

        if (data.activeOrgId) {
          hydrateStoredOrgId(data.activeOrgId);
          return;
        }

        // 本地已有有效选择时，回写服务端
        const local = readStoredOrgId();
        const ids = (data.organizations ?? []).map((o) => o.id);
        if (local && ids.includes(local)) {
          persistSelectedOrgId(local);
          await fetch("/api/auth/active-org", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ orgId: local }),
          }).catch(() => null);
          return;
        }

        if (data.needsSelection && ids.length > 1) {
          const next = encodeURIComponent(pathname || "/");
          router.replace(`/select-org?next=${next}`);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
