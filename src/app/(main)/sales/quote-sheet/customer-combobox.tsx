"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboCustomer {
  id: string;
  name: string;
  phone?: string | null;
}

/**
 * 报价单客户选择器：可搜索（姓名/电话）+ 内嵌「新建客户」入口。
 * 替换原生 <select>——原实现最多只能显示 API 返回的前 20 条且无法搜索。
 */
export function CustomerCombobox({
  customers,
  value,
  onSelect,
  onCreateNew,
}: {
  customers: ComboCustomer[];
  value: string;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = customers.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (qDigits && (c.phone ?? "").replace(/\D/g, "").includes(qDigits)) return true;
      return false;
    });
  }, [customers, query]);

  // 点击组件外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      // 打开后聚焦搜索框（下一帧，等列表渲染完）
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const pick = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card-bg px-3 py-2.5 text-left text-base md:text-sm min-h-[44px]"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected
            ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ""}`
            : "— Select customer —"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-border bg-card-bg shadow-lg">
          <div className="relative border-b border-border">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered.length > 0) {
                  e.preventDefault();
                  pick(filtered[0].id);
                }
              }}
              placeholder="搜索姓名或电话…"
              className="w-full bg-transparent py-2.5 pl-8 pr-3 text-sm outline-none min-h-[44px]"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                没有匹配的客户
              </li>
            )}
            {filtered.slice(0, 50).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent-soft min-h-[44px]"
                >
                  <span className="truncate">
                    {c.name}
                    {c.phone && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {c.phone}
                      </span>
                    )}
                  </span>
                  {c.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
            {filtered.length > 50 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                还有 {filtered.length - 50} 位，继续输入缩小范围
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateNew();
            }}
            className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-accent-soft min-h-[44px]"
          >
            <Plus className="h-4 w-4" />
            新建客户
          </button>
        </div>
      )}
    </div>
  );
}
