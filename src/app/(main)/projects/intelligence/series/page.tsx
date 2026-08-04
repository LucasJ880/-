import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";

export default function IntelSeriesPage() {
  return (
    <IntelHubShell title="周期采购" notEnabled>
      <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-sm text-[var(--muted)] space-y-2">
        <p>Phase 1：信息架构已就绪。</p>
        <p>
          请从具体项目的「智能调查室 → 项目系列识别」模块录入周期采购判断；本页后续将聚合跨项目系列视图。
        </p>
      </div>
    </IntelHubShell>
  );
}
