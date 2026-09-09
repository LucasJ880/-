import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementWorkspace } from "@/components/supplier-intel/procurement-workspace";

/**
 * S3-A：国内采购工作台（原「供应链线索」占位页激活）。
 * 项目上下文由 `?projectId=` 携带——Tender 内的入口带着它进来，保证只有一个工作台、
 * 一套状态与一套 API，不在 Tender 与本页各建一份。
 */
export default async function IntelSupplyChainPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  return (
    <IntelHubShell title="国内采购 / 找供应商">
      <ProcurementWorkspace projectId={projectId?.trim() || null} />
    </IntelHubShell>
  );
}
