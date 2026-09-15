import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { SupplierEvidenceWorkspace } from "@/components/supplier-intel/supplier-evidence-workspace";

/**
 * S3-B：供应商产品与资质（证据工作台）。
 *
 * 唯一的 canonical 供应商证据页——从 S3-A 的已关联线索、从搜索记录里的内部候选进来，
 * 最后都到这里；不在别处各建一套 Supplier Detail。
 *
 * URL 参数只表达「从哪来、想看哪个」：supplierId 是主键；projectId / signalId / searchRunId
 * 是上下文，是否属实由服务端核实后回传（前端不据 URL 自行断言）。
 */
export default async function SupplierEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; projectId?: string; signalId?: string; searchRunId?: string; evaluationRunId?: string }>;
}) {
  const sp = await searchParams;
  return (
    <IntelHubShell title="供应商产品与资质">
      <SupplierEvidenceWorkspace
        supplierId={sp.supplierId?.trim() || null}
        projectId={sp.projectId?.trim() || null}
        signalId={sp.signalId?.trim() || null}
        searchRunId={sp.searchRunId?.trim() || null}
        evaluationRunId={sp.evaluationRunId?.trim() || null}
      />
    </IntelHubShell>
  );
}
