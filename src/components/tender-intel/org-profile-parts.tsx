"use client";

/**
 * P2-0b — 「竞争对手」「采购机构」两页共用：数据加载、可信度徽标、授标记录表。
 * 数据来自 GET /api/org/tender-intel-profiles（只读）。
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import type { AgencyProfile, CompetitorProfile, ProfileAward } from "@/lib/tender-intel/org-profiles";

export type OrgIntelProfilesResponse = {
  orgId: string;
  awardsAvailable: boolean;
  reason: string | null;
  ownOrgName: string | null;
  competitors: CompetitorProfile[];
  ownAwardCount: number;
  agencies: AgencyProfile[];
  projectsTruncated: boolean;
};

export function useOrgIntelProfiles() {
  const { orgId, ambiguous } = useCurrentOrgId();
  const [data, setData] = useState<OrgIntelProfilesResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setData(
        await apiJson<OrgIntelProfilesResponse>(
          `/api/org/tender-intel-profiles?orgId=${encodeURIComponent(orgId)}`,
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
    setBusy(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, busy, err, ambiguous, reload: load };
}

export const VERIFICATION_LABEL: Record<string, { text: string; cls: string }> = {
  HUMAN_CONFIRMED: { text: "人工确认", cls: "bg-emerald-500/10 text-emerald-600" },
  SYSTEM_VERIFIED: { text: "权威公开来源", cls: "bg-sky-500/10 text-sky-600" },
  AI_EXTRACTED: { text: "AI 提取·待确认", cls: "bg-amber-500/10 text-amber-600" },
  NEEDS_REVIEW: { text: "待人工复核", cls: "bg-orange-500/10 text-orange-600" },
};

export function VerificationBadge({ status, recordStatus }: { status: string; recordStatus?: string }) {
  const badge = VERIFICATION_LABEL[status] ?? { text: status, cls: "bg-zinc-500/10 text-zinc-500" };
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
      {badge.text}
      {recordStatus === "NEEDS_REVIEW" ? " · 疑似重复" : ""}
    </span>
  );
}

export function fmtAmount(v: number | null, currency: string | null): string {
  if (v == null) return "—";
  return `${currency ?? ""} ${v.toLocaleString()}`.trim();
}

/** 授标记录表；column = 竞争对手页显示「采购机构」，采购机构页显示「中标方」 */
export function AwardRecordsTable({ awards, column }: { awards: ProfileAward[]; column: "buyer" | "winner" }) {
  if (awards.length === 0) {
    return <p className="text-xs text-[var(--muted)]">暂无授标记录。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
            <th className="px-2 py-1.5 font-medium">{column === "buyer" ? "采购机构" : "中标方"}</th>
            <th className="px-2 py-1.5 font-medium">招标编号</th>
            <th className="px-2 py-1.5 font-medium">授标日期</th>
            <th className="px-2 py-1.5 font-medium">金额</th>
            <th className="px-2 py-1.5 font-medium">可信度</th>
            <th className="px-2 py-1.5 font-medium">项目</th>
          </tr>
        </thead>
        <tbody>
          {awards.map((a) => (
            <tr key={a.id} className="border-b border-[var(--border)] last:border-b-0">
              <td className="px-2 py-1.5">
                {column === "buyer" ? (
                  a.buyerName ?? "—"
                ) : (
                  <>
                    {a.winnerName}
                    {a.isOwn ? <span className="ml-1 rounded bg-[var(--accent)]/10 px-1 text-[var(--accent)]">我方</span> : null}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-[var(--muted)]">{a.solicitationNumber ?? "—"}</td>
              <td className="px-2 py-1.5">{a.awardDate ?? "—"}</td>
              <td className="px-2 py-1.5">{fmtAmount(a.contractAmount, a.currency)}</td>
              <td className="px-2 py-1.5">
                <VerificationBadge status={a.verificationStatus} recordStatus={a.recordStatus} />
              </td>
              <td className="px-2 py-1.5">
                {a.projectId ? (
                  <Link href={`/projects/${a.projectId}`} className="text-[var(--accent)] hover:underline">
                    打开
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-8 w-64 max-w-full rounded-lg border border-[var(--border)] bg-transparent px-2 text-sm"
    />
  );
}

export function matchesQuery(name: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}
