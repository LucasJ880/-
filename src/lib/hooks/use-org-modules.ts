"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { OrgModule, OrgModulesConfig } from "@/lib/tenancy/modules";

/**
 * 当前企业启用模块（来自 /api/auth/active-org，与侧栏同源）。
 * loading 期间 hasModule 返回 null（三态），调用方据此先按保守方式渲染。
 */
export function useOrgModules(): {
  modules: OrgModulesConfig | null;
  loading: boolean;
  hasModule: (module: OrgModule) => boolean | null;
} {
  const [modules, setModules] = useState<OrgModulesConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/active-org")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modules?: OrgModulesConfig | null } | null) => {
        if (!cancelled) setModules(d?.modules ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasModule = (module: OrgModule): boolean | null => {
    if (loading) return null;
    if (!modules?.enabled?.length) return true; // 未配置=不限制（与导航过滤语义一致）
    return modules.enabled.includes(module);
  };

  return { modules, loading, hasModule };
}
