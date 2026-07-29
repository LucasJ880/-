"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--ui-z-tabbar)] md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-semibold">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
