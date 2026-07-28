"use client";

import Link from "next/link";
import {
  CalendarPlus,
  Camera,
  FileText,
  MessageSquare,
  UserPlus,
  X,
} from "lucide-react";

const ITEMS = [
  {
    href: "/sales?view=customers&new=1",
    label: "新客户",
    icon: UserPlus,
  },
  {
    href: "/sales?view=customers&followup=1",
    label: "记跟进",
    icon: MessageSquare,
  },
  {
    href: "/sales/quote-sheet",
    label: "快速报价",
    icon: FileText,
  },
  {
    href: "/sales/calendar?new=1",
    label: "新预约",
    icon: CalendarPlus,
  },
  {
    href: "/sales/measure",
    label: "上传照片",
    icon: Camera,
  },
] as const;

export function SalesMobileCreateSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
          <p className="text-[15px] font-semibold">新增</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted)]"
            aria-label="关闭菜单"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex min-h-14 items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-3 text-[13px] font-medium hover:bg-[var(--muted)]/10"
              >
                <Icon className="h-4 w-4 text-[var(--accent)]" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
