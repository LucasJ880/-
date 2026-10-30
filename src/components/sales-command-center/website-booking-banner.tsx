"use client";

/**
 * CAL-2：首页"网站预约待转入 N 条"入口。无查看权（403）、未开启日历观察或没有待转入时不渲染。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

export function WebsiteBookingBanner() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    apiFetch("/api/sales/website-bookings")
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { items?: unknown[] };
        if (alive) setCount(body.items?.length ?? 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (count <= 0) return null;
  return (
    <Link
      href="/sales/website-bookings"
      className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-[13px] text-sky-800 dark:text-sky-300"
    >
      <span>网站预约待转入 {count} 条：客户在网站自主预约，还没建青砚客户与预约</span>
      <span className="shrink-0 font-medium">去处理 →</span>
    </Link>
  );
}
