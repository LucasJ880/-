"use client";

import { useCallback, useEffect, useRef } from "react";
import { Inbox } from "lucide-react";
import { WorkStackCard } from "./work-stack-card";
import type { WorkQueueItem } from "./types";

type Props = {
  items: WorkQueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
};

export function ActiveWorkStack({
  items,
  selectedId,
  onSelect,
  loading,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(
    0,
    items.findIndex((i) => i.id === selectedId),
  );

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const next = (selectedIndex + delta + items.length) % items.length;
      onSelect(items[next].id);
    },
    [items, onSelect, selectedIndex],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        move(-1);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [move]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col px-4 py-4 md:px-5">
        <p className="mb-3 text-xs font-medium text-muted">核心工作队列</p>
        <div className="relative min-h-[220px]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-x-0 h-20 animate-pulse rounded-[var(--radius-lg)] border border-border bg-card-bg"
              style={{
                transform: `translateY(${i * 12}px) scale(${1 - i * 0.03})`,
                opacity: 1 - i * 0.2,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
        <Inbox className="mb-3 text-muted" size={28} />
        <p className="text-sm font-medium text-foreground">当前没有紧急事项</p>
        <p className="mt-1 max-w-xs text-xs text-muted">
          逾期、今日截止、待审批和风险项目会显示在这里
        </p>
      </div>
    );
  }

  // 选中项置前展示，其后最多 3 层背景卡
  const ordered = [
    items[selectedIndex],
    ...items.slice(selectedIndex + 1),
    ...items.slice(0, selectedIndex),
  ].filter(Boolean);
  const visible = ordered.slice(0, Math.min(4, ordered.length));

  return (
    <div
      ref={listRef}
      tabIndex={0}
      role="listbox"
      aria-label="核心工作队列"
      aria-activedescendant={selectedId ?? undefined}
      className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
    >
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3 md:px-5">
        <p className="text-xs font-medium text-muted">核心工作队列</p>
        <p className="text-[11px] text-text-quaternary">
          {items.length} 项 · ↑↓ 选择
        </p>
      </div>
      <div className="relative mx-4 min-h-[200px] flex-1 md:mx-5">
        {visible.map((item, depth) => (
          <WorkStackCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            depth={depth}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
      {/* 列表辅助：小点指示位置 */}
      <div className="flex shrink-0 justify-center gap-1.5 px-4 pb-3 pt-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.title}
            onClick={() => onSelect(item.id)}
            className={`h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none ${
              item.id === selectedId
                ? "w-4 bg-accent"
                : "w-1.5 bg-border hover:bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
