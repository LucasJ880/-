"use client";

/**
 * S3-A：Tender 内的「国内采购 / 找供应商」入口。
 *
 * 只是一个带项目上下文的入口——真正的工作台仍是唯一的
 * `/projects/intelligence/supply-chain`，不在 Tender 里再建一套状态与 API。
 */

import Link from "next/link";
import { ArrowRight, Factory } from "lucide-react";

export function TenderSourcingEntry({ projectId }: { projectId: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Factory size={15} className="text-[var(--accent)]" />
            国内采购 / 找供应商
          </h3>
          <p className="mt-1 text-xs text-muted">
            用中文看懂这个标要买什么、哪些条件不能忽略，再按需求去找国内厂家：
            内部供应商优先，外部公开渠道补充，线索由你人工确认归属。
          </p>
        </div>
        <Link
          href={`/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm text-[color:var(--on-accent)]"
          data-testid="tender-sourcing-entry"
        >
          进入采购工作台
          <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
