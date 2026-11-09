import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementTabs } from "@/components/procurement-records/procurement-tabs";
import { RequestDetailView } from "@/components/procurement-records/request-detail";

/** PROC-1：资料申请详情 */
export default async function RecordsRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <IntelHubShell title="采购情报">
      <ProcurementTabs />
      <RequestDetailView requestId={id} />
    </IntelHubShell>
  );
}
