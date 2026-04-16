"use client";

import { useEffect, useState } from "react";
import type { ProductName } from "@/lib/blinds/pricing-types";
import {
  ensureSkuCatalogLoaded,
  getSkusByProduct,
  type SkuEntry,
} from "@/lib/blinds/sku-catalog";
import { cn } from "@/lib/utils";

interface Props {
  product: ProductName;
  value: string;
  onChange: (sku: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * 统一的 SKU 下拉：
 * - 按当前行 Product 自动过滤
 * - Option 文本为 "SKU · 可读标签"
 * - 无真 SKU 时退化为 fabric 类别（附 (type only) 提示）
 */
export function SkuSelect({ product, value, onChange, className, placeholder }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    ensureSkuCatalogLoaded().then(() => setTick((n) => n + 1));
  }, []);

  const entries: SkuEntry[] = getSkusByProduct(product);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "bg-transparent border-0 outline-none text-[10px] min-h-[44px]",
        className,
      )}
      title={value || undefined}
    >
      <option value="">{placeholder ?? "— SKU —"}</option>
      {entries.map((e) => (
        <option key={e.sku} value={e.sku}>
          {e.isCategoryFallback
            ? `${e.readable} (type only)`
            : `${e.sku} · ${e.readable}`}
        </option>
      ))}
    </select>
  );
}
