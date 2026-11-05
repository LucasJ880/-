"use client";

/** PROC-1 Tender 详情「情报」Tab：历史采购与资料申请（只读卡片；维护在情报中枢的采购监控 / 资料申请页） */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSearch } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import { FILES_STATUS_LABELS, OUTCOME_LABELS, REQUEST_STATUS_LABELS, type GovernmentOutcome, type RequestStatus } from "@/lib/procurement-records/labels";

type Summary = {
  available: boolean;
  instruments?: Array<{ relation: string; id: string; officialNumber: string; title: string | null; currentExpiryAt: string | null; recordsHolderInstitution: string | null }>;
  requests?: Array<{ id: string; title: string; status: string; filesStatus: string; analysisStatus: string; governmentOutcome: string | null; caseNumber: string | null }>;
};

const REL: Record<string, string> = { CURRENT: "当前", PREDECESSOR: "前序（关联，不是编号别名）", RELATED_HISTORY: "相关历史" };

export function TenderProcurementCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    apiJson<Summary>(`/api/projects/${projectId}/procurement-records`).then(setData).catch(() => setData(null));
  }, [projectId]);
  if (!data || !data.available) return null;
  const inst = data.instruments ?? [];
  const reqs = data.requests ?? [];
  return (
    <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-procurement-card">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileSearch size={16} className="text-accent/60" />
        历史采购与资料申请
        <span className="text-[10px] font-normal text-muted">前序合同 / call-up / ATI 申请与披露分析</span>
      </h3>
      {inst.length === 0 && reqs.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          尚未关联历史合同。到 <Link className="text-accent underline" href="/projects/intelligence/monitor">采购监控</Link> 关注合同并「准备申请」，或在申请卡里关联本项目。
        </p>
      ) : null}
      {inst.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {inst.map((i) => (
            <li key={i.id}>
              {REL[i.relation] ?? i.relation} · <span className="font-medium">{i.officialNumber}</span> {i.title ?? ""} · 公开到期 {i.currentExpiryAt ?? "未知"} · 资料持有机关 {i.recordsHolderInstitution ?? "未核实"}
            </li>
          ))}
        </ul>
      ) : null}
      {reqs.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {reqs.map((r) => (
            <li key={r.id}>
              <Link className="text-accent underline" href={`/projects/intelligence/records/${r.id}`}>{r.title}</Link> · {REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? r.status} · {FILES_STATUS_LABELS[r.filesStatus] ?? r.filesStatus}
              {r.governmentOutcome ? ` · ${OUTCOME_LABELS[r.governmentOutcome as GovernmentOutcome]}` : ""}
              {r.caseNumber ? ` · 案件 ${r.caseNumber}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
