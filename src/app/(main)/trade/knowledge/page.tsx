"use client";

import { BookOpen, Construction } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function TradeKnowledgePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="外贸知识库"
        description="外贸话术模板、常见问题和最佳实践"
      />

      <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card-bg px-8 py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
          <BookOpen className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">外贸知识库即将上线</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          外贸知识库将提供行业术语、标书分析模板、报价策略、客户沟通话术等专业知识。
        </p>
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <Construction size={14} />
          <span>功能开发中，敬请期待</span>
        </div>
      </div>
    </div>
  );
}
