"use client";

/** PROC-1 采购情报的三个子页：候选项目（日常）/ 资料申请（日常）/ 设置（一次性准备，平时不用进） */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/projects/intelligence/monitor", label: "候选项目", match: (p: string) => p === "/projects/intelligence/monitor" },
  { href: "/projects/intelligence/records", label: "资料申请", match: (p: string) => p.startsWith("/projects/intelligence/records") },
  { href: "/projects/intelligence/monitor/settings", label: "设置", match: (p: string) => p.startsWith("/projects/intelligence/monitor/settings") },
];

export function ProcurementTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="inline-flex rounded-lg border border-border bg-card-bg p-0.5 text-xs" aria-label="采购情报" data-testid="procurement-tabs">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
