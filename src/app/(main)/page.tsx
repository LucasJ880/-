"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WorkbenchShell } from "@/components/workbench";
import { LegacyDashboard } from "@/components/dashboard/legacy-dashboard";

/**
 * 首页默认 Workbench V2（classic / glass 共用信息架构）。
 * 回退旧纵栈 Dashboard：
 *   - 环境变量 NEXT_PUBLIC_DASHBOARD_LEGACY=1
 *   - 或 URL ?legacy=1
 */
function HomeInner() {
  const searchParams = useSearchParams();
  const legacy =
    process.env.NEXT_PUBLIC_DASHBOARD_LEGACY === "1" ||
    searchParams.get("legacy") === "1";

  if (legacy) return <LegacyDashboard />;
  return <WorkbenchShell />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<WorkbenchShell />}>
      <HomeInner />
    </Suspense>
  );
}
