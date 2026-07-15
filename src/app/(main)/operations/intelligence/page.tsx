"use client";

import { useState } from "react";
import { FileSearch, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import ManualAnalysisPanel from "@/components/market-intelligence/manual-analysis-panel";
import { MonitoringWorkspace } from "@/components/market-intelligence/monitoring-workspace";

type WorkspaceView = "monitoring" | "analysis";

export default function MarketIntelligencePage() {
  const [view, setView] = useState<WorkspaceView>("monitoring");
  return (
    <div className="space-y-5">
      <div className="mx-auto flex max-w-7xl gap-1 border-b border-border" role="tablist" aria-label="市场情报视图">
        {[
          { id: "monitoring" as const, label: "竞品监听", icon: Radar },
          { id: "analysis" as const, label: "专项分析", icon: FileSearch },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium",
              view === item.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
      </div>
      {view === "monitoring" ? <MonitoringWorkspace /> : <ManualAnalysisPanel />}
    </div>
  );
}
