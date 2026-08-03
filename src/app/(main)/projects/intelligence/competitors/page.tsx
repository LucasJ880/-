import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";

export default function IntelCompetitorsPage() {
  return (
    <IntelHubShell title="竞争对手">
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)]">
        Phase 1 空状态：竞争对手画像在调查室模块中维护；本页后续提供组织级竞争库。
      </div>
    </IntelHubShell>
  );
}
