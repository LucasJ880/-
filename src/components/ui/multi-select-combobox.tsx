"use client";

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { Search, X, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  id: string;
  label: string;
  /** 可选二级文字（如邮箱） */
  sublabel?: string;
  /** 可选计数，展示在右侧 */
  count?: number;
}

/**
 * 多选下拉 Combobox（搜索 + chips）
 * - 支持键盘 Esc 关闭
 * - 选中项以 chips 显示在触发按钮内
 * - 点击外部自动关闭
 */
export function MultiSelectCombobox({
  options,
  value,
  onChange,
  placeholder = "请选择…",
  emptyText = "未找到匹配项",
  searchPlaceholder = "搜索…",
  disabled,
  className,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedOptions = useMemo(
    () => options.filter((o) => value.includes(o.id)),
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const needle = q.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        o.sublabel?.toLowerCase().includes(needle),
    );
  }, [q, options]);

  const toggle = useCallback(
    (id: string) => {
      if (value.includes(id)) {
        onChange(value.filter((v) => v !== id));
      } else {
        onChange([...value, id]);
      }
    },
    [value, onChange],
  );

  const clearAll = useCallback(() => onChange([]), [onChange]);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-[38px] w-full items-center gap-1 rounded-lg border border-border bg-white/80 px-2 py-1.5 text-left text-sm transition-colors",
          "hover:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20",
          disabled && "opacity-50 cursor-not-allowed",
          open && "border-accent/40 ring-2 ring-accent/20",
        )}
      >
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {selectedOptions.length === 0 ? (
            <span className="text-muted">{placeholder}</span>
          ) : (
            selectedOptions.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs text-accent-foreground border border-accent/20"
              >
                <span className="max-w-[120px] truncate">{o.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(o.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      toggle(o.id);
                    }
                  }}
                  className="text-muted hover:text-foreground cursor-pointer"
                  aria-label={`移除 ${o.label}`}
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))
          )}
        </div>
        {selectedOptions.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                clearAll();
              }
            }}
            className="rounded p-0.5 text-muted hover:bg-muted/10 hover:text-foreground cursor-pointer"
            title="清空"
            aria-label="清空全部选择"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm placeholder:text-muted focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="text-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
            ) : (
              filtered.map((o) => {
                const selected = value.includes(o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                      "hover:bg-accent/5",
                      selected && "bg-accent/10",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selected
                          ? "bg-accent border-accent text-white"
                          : "border-border bg-white",
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">
                      <span>{o.label}</span>
                      {o.sublabel && (
                        <span className="ml-1 text-[11px] text-muted">
                          {o.sublabel}
                        </span>
                      )}
                    </span>
                    {typeof o.count === "number" && (
                      <span className="shrink-0 text-[11px] text-muted tabular-nums">
                        {o.count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {options.length > 0 && (
            <div className="flex items-center justify-between border-t border-border bg-muted/5 px-3 py-1.5 text-[11px] text-muted">
              <span>
                已选 {value.length} / 共 {options.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(filtered.map((o) => o.id))}
                  className="hover:text-foreground"
                >
                  全选当前
                </button>
                <span className="text-border">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="hover:text-foreground"
                >
                  清空
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
