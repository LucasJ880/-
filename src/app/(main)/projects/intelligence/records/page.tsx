import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { RecordsLedger } from "@/components/procurement-records/records-ledger";

/** PROC-1：资料申请台账（青砚数据库是唯一正式申请台账） */
export default function RecordsLedgerPage() {
  return (
    <IntelHubShell title="资料申请台账">
      <RecordsLedger />
    </IntelHubShell>
  );
}
