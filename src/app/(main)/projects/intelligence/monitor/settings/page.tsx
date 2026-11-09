import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementMonitor } from "@/components/procurement-records/procurement-monitor";
import { ProcurementTabs } from "@/components/procurement-records/procurement-tabs";
import { RecordsLedger } from "@/components/procurement-records/records-ledger";

/** PROC-1：采购情报 → 设置（一次性准备：监控配置与来源状态、申请人资料、机关规则核实、历史台账） */
export default function ProcurementSettingsPage() {
  return (
    <IntelHubShell title="采购情报">
      <ProcurementTabs />
      <ProcurementMonitor mode="settings" />
      <RecordsLedger mode="settings" />
    </IntelHubShell>
  );
}
