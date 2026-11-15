import { Suspense } from "react";
import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { RfqTracker } from "@/components/bids/rfq-tracker";

// T-2 询价追踪页。可见性与 /bids 相同：由路由门判定（src/proxy.ts → route-gate，/bids 前缀即 ws-bids），这里只保留未登录跳转
export default async function RfqTrackerPage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <p className="text-[12px] font-medium tracking-wide text-[var(--muted)]">招投标中心</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">询价追踪</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
          所有在途询价：谁没回、系统哪天自动催、哪张催单卡在等你批。落地价与「最便宜」直接取各轮的比价矩阵。
        </p>
      </header>
      <Suspense fallback={null}>
        <RfqTracker />
      </Suspense>
    </div>
  );
}
