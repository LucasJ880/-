"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { navEntryLabel } from "@/lib/navigation/entry-label";

/**
 * /help 功能地图里的入口名称（NAV-1a；spec navigation/entry-naming）。
 * 界面语言只存在浏览器里，所以这一格在客户端按当前语言取名——与侧栏调的是同一个 navEntryLabel。
 */
export function HelpEntryName({ label, labelKey, href }: { label: string; labelKey: string | null; href: string | null }) {
  const { m } = useLocale();
  const name = navEntryLabel({ label, labelKey }, m);
  if (!href) return <>{name}</>;
  return (
    <Link href={href} className="text-accent hover:underline">
      {name}
    </Link>
  );
}
