"use client";

import Link from "next/link";
import {
  CalendarPlus,
  FileText,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ACTIONS = [
  {
    href: "/sales?view=customers&new=1",
    label: "新建客户",
    icon: UserPlus,
    primary: true,
  },
  {
    href: "/sales/quote-sheet",
    label: "快速报价",
    icon: FileText,
    primary: false,
  },
  {
    href: "/sales?view=customers&followup=1",
    label: "记录跟进",
    icon: MessageSquare,
    primary: false,
  },
  {
    href: "/sales/calendar?new=1",
    label: "新建预约",
    icon: CalendarPlus,
    primary: false,
  },
] as const;

export function SalesQuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors",
              a.primary
                ? "bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]"
                : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]/10",
            )}
          >
            <Icon className="h-4 w-4" />
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
