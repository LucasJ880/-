import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";

export default function IntelAgenciesPage() {
  return (
    <IntelHubShell title="采购机构" notEnabled>
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)]">
        Phase 1 空状态：采购机构信息来自项目 `clientOrganization` 与调查室「项目理解」模块。
      </div>
    </IntelHubShell>
  );
}
