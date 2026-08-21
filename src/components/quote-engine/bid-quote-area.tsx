"use client";

/**
 * 投标 tab 报价区：引擎启用 → 「招投标报价」独立区块置顶，legacy「外贸标准报价」折叠为次级；
 * 引擎未启用（flag OFF / 无组织）→ 与改动前一致，只渲染 legacy 区块。
 */
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api-fetch";
import { ProjectQuoteSection } from "@/components/quote/project-quote-section";
import { QuoteEngineSection, type QuoteEngineListPayload } from "./quote-engine-section";

export function BidQuoteArea({ projectId }: { projectId: string }) {
  const [data, setData] = useState<QuoteEngineListPayload | null | undefined>(undefined);
  const load = useCallback(() => { apiJson<QuoteEngineListPayload>(`/api/projects/${projectId}/quote-engine`).then((d) => setData(d.enabled ? d : null)).catch(() => setData(null)); }, [projectId]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <ProjectQuoteSection projectId={projectId} />;
  return (
    <div className="space-y-4" data-testid="bid-quote-area">
      <QuoteEngineSection projectId={projectId} data={data} onReload={load} />
      <details className="rounded-xl border border-border/60 bg-card-bg/60" data-testid="legacy-quote-collapsed">
        <summary className="cursor-pointer px-4 py-2 text-xs text-muted">外贸标准报价（legacy 报价单，点击展开）</summary>
        <div className="px-1 pb-2"><ProjectQuoteSection projectId={projectId} /></div>
      </details>
    </div>
  );
}
