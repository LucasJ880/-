"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { Loader2 } from "lucide-react";

interface Candidate {
  id: string;
  title: string;
  description: string;
  department: string;
  roleScope: string;
  status: string;
  evidenceCount: number;
  confidence: number;
  evidenceSummary?: { uniqueUsers?: number; outcomeCount?: number };
}

export default function TeamLearningPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = () =>
    apiJson<{ candidates: Candidate[]; metrics: Record<string, unknown> }>(
      "/api/team/candidate-practices",
    )
      .then((d) => {
        setCandidates(d.candidates || []);
        setMetrics(d.metrics || null);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
  }, []);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 text-[12px]">
        <Link href="/settings/digital-employees" className="text-[#68706c] hover:underline">
          ← 数字员工学习
        </Link>
      </div>
      <PageHeader
        title="部门学习审核"
        description="候选工作方法须主管批准后才成为 Playbook；不会自动改 Skill 或全公司规则。"
      />

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
          {error}
        </div>
      )}

      {metrics && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            使用 {(metrics.usageCount as number) ?? 0}
          </div>
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            候选 {(metrics.candidatePracticeCount as number) ?? 0}
          </div>
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            Playbook {(metrics.activePlaybookCount as number) ?? 0}
          </div>
          <div className="rounded-lg bg-[#f4f5f5] p-2">无个人排名</div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {candidates.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-black/[0.06] bg-white p-4 text-[13px]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-[#171a19]">{c.title}</div>
              <span className="shrink-0 rounded-md bg-[#f4f5f5] px-2 py-0.5 text-[11px]">
                {c.status}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-[#68706c]">{c.description}</p>
            <div className="mt-2 text-[11px] text-[#68706c]">
              {c.department} · {c.roleScope} · 证据 {c.evidenceCount} · 员工{" "}
              {c.evidenceSummary?.uniqueUsers ?? "—"} · Outcome{" "}
              {c.evidenceSummary?.outcomeCount ?? "—"} · 置信度{" "}
              {(c.confidence * 100).toFixed(0)}%
            </div>
            {c.status === "pending_review" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-[#202422] px-3 py-1.5 text-[12px] text-white"
                  onClick={async () => {
                    await apiFetch(`/api/team/candidate-practices/${c.id}/review`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        decision: "approve",
                        department: c.department,
                        roleScope: c.roleScope,
                      }),
                    });
                    void reload();
                  }}
                >
                  批准并发布 Playbook
                </button>
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-[12px]"
                  onClick={async () => {
                    await apiFetch(`/api/team/candidate-practices/${c.id}/review`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        decision: "reject",
                        rejectionReason: "证据不足或不适用",
                      }),
                    });
                    void reload();
                  }}
                >
                  拒绝
                </button>
              </div>
            )}
          </div>
        ))}
        {candidates.length === 0 && !error && (
          <p className="text-[12px] text-[#68706c]">
            暂无候选。需多员工授权 team_candidate 反馈 + 可验证 Outcome，且由周任务挖掘生成。
          </p>
        )}
      </div>
    </div>
  );
}
