import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementTabs } from "@/components/procurement-records/procurement-tabs";
import { RecordsLedger } from "@/components/procurement-records/records-ledger";

/** PROC-1：采购情报 → 资料申请（青砚数据库是唯一正式申请台账；准备工作在「设置」） */
export default function RecordsLedgerPage() {
  return (
    <IntelHubShell title="采购情报">
      <ProcurementTabs />
      <RecordsLedger mode="list" />
    </IntelHubShell>
  );
}
