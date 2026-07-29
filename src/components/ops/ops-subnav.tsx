"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/ops", label: "运营首页", exact: true },
  { href: "/tasks", label: "我的工作" },
  { href: "/ops/projects", label: "执行项目" },
  { href: "/service-inbox", label: "客户与沟通" },
];

export function OpsSubnav() {
  const pathname = usePathname() || "";

  return (
    <nav
      aria-label="运营中心"
      className="border-b border-[var(--border)] bg-[var(--card)]"
    >
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 md:px-6">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] ${
                active
                  ? "bg-[var(--accent)] text-[var(--on-accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
