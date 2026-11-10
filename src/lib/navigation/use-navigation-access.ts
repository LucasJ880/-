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

/** 同一页面里多个钩子实例共用一次 active-org 请求（按当前企业键；30 秒内复用，与路由门缓存同时效） */
const INPUTS_TTL_MS = 30_000;
let inputsCache: { orgKey: string; at: number; promise: Promise<OrgNavigationInputs | null> } | null = null;

function fetchNavigationInputs(orgKey: string): Promise<OrgNavigationInputs | null> {
  const now = Date.now();
  if (inputsCache && inputsCache.orgKey === orgKey && now - inputsCache.at < INPUTS_TTL_MS) return inputsCache.promise;
  const promise = (async () => {
    try {
      const res = await apiFetch("/api/auth/active-org");
      if (!res.ok) return null;
      return inputsFromActiveOrgResponse(await res.json());
    } catch {
      return null;
    }
  })();
  inputsCache = { orgKey, at: now, promise };
  // 失败不缓存：下一个实例或下次挂载重试
  void promise.then((v) => {
    if (v === null && inputsCache?.promise === promise) inputsCache = null;
  });
  return promise;
}

export type NavigationAccess = {
  /** 判定输入是否已取得 */
  ready: boolean;
  /** VIS-1c：判定输入取失败（未就绪且本次请求已失败）；入口仍不出现，可调 retry 重取 */
  failed: boolean;
  /** 重新请求判定输入（失败的请求不缓存） */
  retry(): void;
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // 取不到输入：保持未就绪，入口不出现；标记失败，调用方可提示并重试
    void fetchNavigationInputs(storedOrgId).then((next) => {
      if (cancelled) return;
      if (next) {
        setInputs(next);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storedOrgId, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const ctx = useMemo<RouteGateContext | null>(() => {
    if (!user || !inputs) return null;
    return buildNavigationFilterContext(inputs, { role: user.role }, {
      autopilotAllowed: user.autopilotAllowed === true,
      wechatEntryEnabled,
    });
  }, [user, inputs, wechatEntryEnabled]);

  const canOpen = useCallback((href: string) => canOpenHref(href, ctx), [ctx]);
  const landingPage = useMemo(() => (ctx ? resolveLandingPage(ctx) : null), [ctx]);

  return { ready: ctx !== null, failed: ctx === null && failed, retry, ctx, canOpen, landingPage };
}
