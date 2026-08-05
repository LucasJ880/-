import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";

export default function IntelSupplyChainPage() {
  return (
    <IntelHubShell title="供应链线索" notEnabled>
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
        <p>Phase 1：在调查室供应链模块记录关系，并强制标注可信度（不得把 INFERRED 显示为已确认）。</p>
        <p>完整全球供应链图谱延后。</p>
      </div>
    </IntelHubShell>
  );
}
