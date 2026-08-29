"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 面料纹理图缓存 hook：按 url 去重加载，成功一张更新一张。
 * crossOrigin=anonymous 与底图加载策略一致（否则 canvas 导出会被污染）。
 */
export function useTextureImages(
  urls: Array<string | null | undefined>,
): Map<string, HTMLImageElement> {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(
    () => new Map(),
  );

  const uniqueKey = useMemo(
    () => [...new Set(urls.filter((u): u is string => Boolean(u)))].sort().join("\n"),
    [urls],
  );

  useEffect(() => {
    const unique = uniqueKey ? uniqueKey.split("\n") : [];
    let cancelled = false;
    for (const url of unique) {
      setImages((prev) => {
        if (prev.has(url)) return prev;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (!cancelled) {
            setImages((current) => new Map(current).set(url, img));
          }
        };
        img.src = url;
        return prev;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [uniqueKey]);

  return images;
}
