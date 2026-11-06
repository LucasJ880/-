import { IntelHubShell } from "@/components/bid-workflow/intel-hub-shell";
import { ProcurementMonitor } from "@/components/procurement-records/procurement-monitor";
import { ProcurementTabs } from "@/components/procurement-records/procurement-tabs";

/** PROC-1：采购情报 → 候选项目（官方开放数据只读扫描；监控配置与来源状态在「设置」） */
export default function IntelMonitorPage() {
  return (
    <IntelHubShell title="采购情报">
      <ProcurementTabs />
      <ProcurementMonitor mode="candidates" />
    </IntelHubShell>
  );
}
