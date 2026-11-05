import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { RequestDetailView } from "@/components/procurement-records/request-detail";

/** PROC-1：资料申请详情 */
export default async function RecordsRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <IntelHubShell title="资料申请">
      <RequestDetailView requestId={id} />
    </IntelHubShell>
  );
}
