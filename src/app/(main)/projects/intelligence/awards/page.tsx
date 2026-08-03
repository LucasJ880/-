import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";

export default function IntelAwardsPage() {
  return (
    <IntelHubShell title="历史中标">
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
        <p>Phase 1：请在调查室「历史中标调查」模块保存中标事实（含可信度）。</p>
        <p>跨项目历史中标列表将在后续阶段聚合展示。</p>
      </div>
    </IntelHubShell>
  );
}
