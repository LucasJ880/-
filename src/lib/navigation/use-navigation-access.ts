"use client";

/**
 * VIS-1b：客户端入口判定钩子（spec navigation/entry-visibility；design D7）
 *
 * 用与路由门相同的门表与输入回答「这个地址对我放行吗」「我的落地页」：
 * - 企业侧输入取 /api/auth/active-org，经 inputsFromActiveOrgResponse 还原（成员身份用响应里的 hasMembership）；
 * - 用户侧取 useCurrentUser（平台角色、Autopilot），开关取 useWechatEntryEnabled；
 * - 拼装用 buildNavigationFilterContext，与服务端 loader 同一个函数。
 * 输入未就绪时 canOpen 一律 false、landingPage 为 null（入口不先显示后消失）；平台 super_admin 一律放行。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { readStoredOrgId } from "@/lib/org-selection";
import { useWechatEntryEnabled } from "@/components/wechat-entry/context";
import {
  buildNavigationFilterContext,
  inputsFromActiveOrgResponse,
  type OrgNavigationInputs,
  type RouteGateContext,
} from "./filter-context";
import { canOpenHref, resolveLandingPage } from "./landing";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export type NavigationAccess = {
  /** 判定输入是否已取得 */
  ready: boolean;
  /** 判定输入（未就绪为 null） */
  ctx: RouteGateContext | null;
  canOpen(href: string): boolean;
  /** 当前用户的落地页（与路由门重定向目标同一函数；未就绪为 null） */
  landingPage: string | null;
};

export function useNavigationAccess(): NavigationAccess {
  const { user } = useCurrentUser();
  const wechatEntryEnabled = useWechatEntryEnabled();
  const storedOrgId = useSyncExternalStore(subscribeOrgStorage, readStoredOrgId, () => "");
  const [inputs, setInputs] = useState<OrgNavigationInputs | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/active-org");
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (!cancelled) setInputs(inputsFromActiveOrgResponse(body));
      } catch {
        /* 取不到输入：保持未就绪，入口不出现 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedOrgId]);

  const ctx = useMemo<RouteGateContext | null>(() => {
    if (!user || !inputs) return null;
    return buildNavigationFilterContext(inputs, { role: user.role }, {
      autopilotAllowed: user.autopilotAllowed === true,
      wechatEntryEnabled,
    });
  }, [user, inputs, wechatEntryEnabled]);

  const canOpen = useCallback((href: string) => canOpenHref(href, ctx), [ctx]);
  const landingPage = useMemo(() => (ctx ? resolveLandingPage(ctx) : null), [ctx]);

  return { ready: ctx !== null, ctx, canOpen, landingPage };
}
