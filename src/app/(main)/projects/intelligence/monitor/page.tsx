import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementMonitor } from "@/components/procurement-records/procurement-monitor";

/** PROC-1：情报监控 = 采购监控与候选（官方开放数据只读扫描；替代原 notEnabled 占位） */
export default function IntelMonitorPage() {
  return (
    <IntelHubShell title="采购监控与候选">
      <ProcurementMonitor />
    </IntelHubShell>
  );
}
