import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import Link from "next/link";

export default function IntelMonitorPage() {
  return (
    <IntelHubShell title="情报监控" notEnabled>
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
        <p>Phase 1：复用现有市场监测能力，不在本页同步爬取。</p>
        <Link href="/trade/signals" className="underline text-[var(--foreground)]">
          打开市场监测（业务运营域）
        </Link>
      </div>
    </IntelHubShell>
  );
}
