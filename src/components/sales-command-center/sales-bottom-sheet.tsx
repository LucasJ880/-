"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

/** 供测试与样式契约引用：遮罩 / 面板分层且面板强制不透明 */
export const SALES_BOTTOM_SHEET_OVERLAY_CLASS =
  "fixed inset-0 z-[var(--ui-z-dialog-overlay)] bg-black/45 opacity-100";

export const SALES_BOTTOM_SHEET_PANEL_CLASS = cn(
  "fixed inset-x-0 bottom-0 z-[var(--ui-z-dialog-panel)] flex max-h-[85dvh] flex-col",
  "rounded-t-2xl border border-border opacity-100 shadow-2xl",
  // 单一不透明背景：勿并用 bg-white（twMerge 会互相冲掉）；--card 未定义故禁用用 --card-bg
  "bg-[var(--card-bg,#faf8f4)] text-foreground",
  "pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3",
  "md:hidden",
);

export function SalesBottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleEsc);
    const unlock = lockAppScroll("sales-bottom-sheet");
    // 下一帧聚焦关闭按钮，便于读屏与键盘
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", handleEsc);
      unlock();
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [open, handleEsc]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="md:hidden" data-sales-bottom-sheet="true">
      {/* Overlay：独立节点，禁止与 Content 共用 opacity 父级 */}
      <button
        type="button"
        className={SALES_BOTTOM_SHEET_OVERLAY_CLASS}
        aria-label="关闭遮罩"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-sales-bottom-sheet-panel="true"
        className={SALES_BOTTOM_SHEET_PANEL_CLASS}
        style={{ backgroundColor: "var(--card-bg, #faf8f4)" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-border" />
        <div className="flex shrink-0 items-center justify-between gap-2 px-4">
          <p
            id={titleId}
            className="min-w-0 flex-1 break-words text-[15px] font-semibold text-foreground"
          >
            {title}
          </p>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-black/5 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
