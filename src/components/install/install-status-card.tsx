"use client";

/**
 * INSTALL-2d：工艺单详情顶部的安装状态卡（spec installation/install-stage「工艺单详情的安装状态卡」）
 * 数据来自 GET /api/blinds-orders/{id}/install-status（读权同工艺单详情）；接口失败不显示，不影响页面其他内容。
 * 不出照片、问题描述、电话、金额。
 */

import { useEffect, useState } from "react";
import { ClipboardList, Wrench } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type InstallStatus = {
  stage: string;
  stageLabel: string;
  salesText: string;
  installAt: string | null;
  repair: {
    repairNo: string;
    targetDate: string;
    customerConfirmed: boolean;
    /** INSTALL-2e：已排返修的日期 / 待登记出单品类数 */
    scheduledDate?: string | null;
    pendingFactory?: number;
    rows: Array<{ n: number; location: string; issueTypeLabel: string; needsFactory: boolean }>;
  } | null;
};

const TONE: Record<string, string> = {
  repair_open: "border-[rgba(201,138,34,0.45)] bg-[rgba(201,138,34,0.06)]",
  repair_ready_to_schedule: "border-[rgba(201,138,34,0.45)] bg-[rgba(201,138,34,0.06)]",
  awaiting_balance: "border-[rgba(46,122,86,0.35)] bg-[rgba(46,122,86,0.05)]",
  closed: "border-[rgba(46,122,86,0.35)] bg-[rgba(46,122,86,0.05)]",
};

export function InstallStatusCard({ orderId, refreshKey }: { orderId: string; refreshKey?: string }) {
  const [data, setData] = useState<InstallStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/blinds-orders/${orderId}/install-status`);
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const body = (await res.json()) as InstallStatus;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, refreshKey]);

  if (!data) return null;
  return (
    <section aria-label="安装状态" className={`rounded-lg border p-4 ${TONE[data.stage] ?? "border-border bg-card-bg"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Wrench size={16} className="text-muted" />
        <span className="text-xs text-muted">安装状态</span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-foreground">{data.stageLabel}</span>
        <span className="text-sm font-semibold text-foreground">{data.salesText}</span>
      </div>
      {data.repair && (
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1 font-mono text-foreground">
              <ClipboardList size={13} /> {data.repair.repairNo}
            </span>
            <span>目标返修日 {data.repair.targetDate}</span>
            {data.repair.scheduledDate && <span className="font-medium text-foreground">已排 {data.repair.scheduledDate} 返修</span>}
            {!!data.repair.pendingFactory && <span>待工厂出单</span>}
            <span>{data.repair.customerConfirmed ? "已和客户确认" : "未和客户确认"}</span>
          </div>
          <ul className="space-y-0.5 text-xs text-foreground">
            {data.repair.rows.map((r) => (
              <li key={r.n}>
                {r.n}. {r.location || "—"} · {r.issueTypeLabel}
                <span className="text-muted">{r.needsFactory ? "（需工厂出单）" : "（不需工厂）"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
