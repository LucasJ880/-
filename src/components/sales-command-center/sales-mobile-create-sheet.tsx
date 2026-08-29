"use client";

import Link from "next/link";
import {
  CalendarPlus,
  FileText,
  MessageSquare,
  Ruler,
  UserPlus,
} from "lucide-react";
import { SalesBottomSheet } from "./sales-bottom-sheet";

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
    // 页面实际是量房/尺寸录入 + 粗略计价；照片上传做出来之前不许挂错标签
    href: "/sales/measure",
    label: "量房估价",
    icon: Ruler,
  },
] as const;

export function SalesMobileCreateSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <SalesBottomSheet open={open} onClose={onClose} title="新增">
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
    </SalesBottomSheet>
  );
}
