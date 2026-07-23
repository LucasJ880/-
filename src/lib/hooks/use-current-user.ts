"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

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

export function useCurrentUser(): UseCurrentUserReturn {
  const [user, setUser] = useState<CurrentUser | null>(cachedUser);
  const [loading, setLoading] = useState(!cachedUser);

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

  const isPlatformAdmin =
    user?.role === "super_admin" || user?.role === "admin";

  return {
    user,
    loading,
    isSuperAdmin: isPlatformAdmin,
    isPlatformAdmin,
    reload,
  };
}
