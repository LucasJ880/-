"use client";

import { Handshake, Construction } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function TradeDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="外贸看板"
        description="管理外贸业务、客户、询盘和报价"
      />

      <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card-bg px-8 py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
          <Handshake className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">外贸看板即将上线</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          外贸模块正在建设中，将包含客户管理、询盘跟踪、报价管理、供应商对接等功能。
        </p>
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <Construction size={14} />
          <span>功能开发中，敬请期待</span>
        </div>
      </div>
    </div>
  );
}
