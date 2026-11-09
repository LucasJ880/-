"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { isSuperAdmin } from "@/lib/permissions-client";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  /** 管理员控制的"是否可修改客户信息"开关；admin 永远视为 true */
  canEditCustomers?: boolean;
  /** 公司归属（联合品牌）；第一个为主公司，左上角显示「青砚 × 公司logo」 */
  companies?: { id: string; name: string; slug: string; logoUrl: string }[];
  /** 服务端计算：是否可见 Autopilot。不含 owner id 列表。 */
  autopilotAllowed?: boolean;
  /** PERM-4c5：当前企业的岗位派生平台角色（按业务角色显示模块用；平台管理判定仍用 role） */
  effectiveRole?: string;
}

interface UseCurrentUserReturn {
  user: CurrentUser | null;
  loading: boolean;
  isSuperAdmin: boolean;
  /** 与 isSuperAdmin 同义；调试面门禁请用此名 */
  isPlatformAdmin: boolean;
  reload: () => void;
}

let cachedUser: CurrentUser | null = null;
let cachePromise: Promise<CurrentUser | null> | null = null;

function fetchUser(): Promise<CurrentUser | null> {
  if (cachePromise) return cachePromise;
  cachePromise = apiFetch("/api/auth/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cachedUser = d?.user ?? null;
      return cachedUser;
    })
    .catch(() => null)
    .finally(() => {
      cachePromise = null;
    });
  return cachePromise;
}

const subscribeNever = () => () => {};

export function useCurrentUser(): UseCurrentUserReturn {
  const [user, setUser] = useState<CurrentUser | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);
  // 服务端渲染与水合时按服务端快照（false）处理：只返回「无用户、加载中」，与服务端 HTML 一致；
  // 水合提交后 React 立即用客户端快照（true）重渲染，再读模块缓存。
  // 否则晚于外壳水合的 Suspense 边界（如 /admin/users）首帧会读到外壳已写入的缓存，
  // 渲染出与服务端 HTML 不同的内容（hydration mismatch）。客户端路由切换不经水合，仍直接用缓存。
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  const reload = useCallback(() => {
    cachedUser = null;
    setLoading(true);
    fetchUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (cachedUser) {
      setUser(cachedUser);
      setLoading(false);
      return;
    }
    fetchUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const visibleUser = hydrated ? user : null;

  // PERM-7b：只认 super_admin（平台 admin 等同 user）
  const isPlatformAdmin = isSuperAdmin(visibleUser?.role);

  return {
    user: visibleUser,
    loading: hydrated ? loading : true,
    isSuperAdmin: isPlatformAdmin,
    isPlatformAdmin,
    reload,
  };
}
