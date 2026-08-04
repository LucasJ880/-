"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/projects/intelligence", label: "智能调查室 / 组织智能" },
  { href: "/projects/intelligence/series", label: "周期采购" },
  { href: "/projects/intelligence/awards", label: "历史中标" },
  { href: "/projects/intelligence/competitors", label: "竞争对手" },
  { href: "/projects/intelligence/agencies", label: "采购机构" },
  { href: "/projects/intelligence/supply-chain", label: "供应链线索" },
  { href: "/projects/intelligence/monitor", label: "情报监控" },
];

export function IntelHubShell({
  title,
  children,
  notEnabled = false,
}: {
  title: string;
  children: React.ReactNode;
  /** 信息架构占位页：明确尚未启用，避免伪装已有数据 */
  notEnabled?: boolean;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-[var(--muted)]">项目智能</p>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {notEnabled && (
          <p className="text-xs rounded-lg bg-amber-50 text-amber-900 px-3 py-2 inline-block">
            本页尚未启用聚合数据能力；当前仅为导航占位，请在具体项目的「智能调查室」录入事实。
          </p>
        )}
        <nav className="flex flex-wrap gap-2 pt-2">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1 text-xs border ${
                  active
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-[var(--border)]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
