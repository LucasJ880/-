"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";

interface UseApiQueryOptions {
  enabled?: boolean;
}

interface UseApiQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  mutate: (data: T | null) => void;
}

export function useApiQuery<T>(
  url: string | null,
  options?: UseApiQueryOptions,
): UseApiQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const enabled = options?.enabled !== false;

  const load = useCallback(async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(currentUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || `请求失败 (${res.status})`,
        );
      }
      const json = await res.json();
      setData(json as T);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && url) {
      load();
    }
  }, [url, enabled, load]);

  return { data, loading, error, retry: load, mutate: setData };
}
