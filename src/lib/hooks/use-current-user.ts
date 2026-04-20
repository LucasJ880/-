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
}

interface UseCurrentUserReturn {
  user: CurrentUser | null;
  loading: boolean;
  isSuperAdmin: boolean;
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

  return {
    user,
    loading,
    isSuperAdmin: user?.role === "super_admin" || user?.role === "admin",
    reload,
  };
}
