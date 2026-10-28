"use client";

/**
 * INSTALL-2d：维修单页面（spec installation/repairs「维修单列表与详情」「维修单打印版」）
 * — RepairList：/install/repairs，按目标日升序；逾期标红
 * — RepairDetail：/install/repairs/[id]，表头 + 行（问题照）+ 当前阶段 + 打印入口
 * — RepairPrint：/install/repairs/[id]/print，纸质版式（抬头大写、至少 10 行、Filling Date），无照片无金额
 * 数据只来自 /api/install/repairs*（install.task.read ORG）；无权时显示提示。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList, Loader2, Printer } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { padPrintRows } from "@/lib/install/repair";
import { factoryText, type RepairDetailData, type RepairListItem } from "./install-types";

function useRepairFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(url);
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        setError(body.error || (res.status === 403 ? "无权查看维修单" : res.status === 404 ? "维修单不存在" : "加载失败"));
        setData(null);
        return;
      }
      setData(body);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading };
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-20 text-muted">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] p-4 text-sm text-danger">{text}</div>;
}

const STAGE_TONE: Record<string, string> = {
  repair_open: "bg-[rgba(201,138,34,0.14)] text-[#a86a12]",
  repair_ready_to_schedule: "bg-[rgba(36,99,165,0.1)] text-[#2463a5]",
};

function StageBadge({ stage, label }: { stage: string; label: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_TONE[stage] ?? "bg-[rgba(26,36,32,0.06)] text-muted"}`}>{label}</span>;
}

export function RepairList() {
  const { data, error, loading } = useRepairFetch<{ repairs: RepairListItem[] }>("/api/install/repairs");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/install" className="inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft size={16} /> 安装任务
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <ClipboardList size={20} className="text-[#a86a12]" /> 返修单
      </h1>
      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {data && data.repairs.length === 0 && <p className="text-sm text-muted">暂无维修单</p>}
      {data && data.repairs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card-bg">
          <table className="w-full text-sm">
            <thead className="bg-[rgba(26,36,32,0.03)] text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">维修单</th>
                <th className="px-3 py-2">客户</th>
                <th className="px-3 py-2">提交</th>
                <th className="px-3 py-2">目标返修日</th>
                <th className="px-3 py-2">行</th>
                <th className="px-3 py-2">需工厂</th>
                <th className="px-3 py-2">阶段</th>
              </tr>
            </thead>
            <tbody>
              {data.repairs.map((r) => (
                <tr key={r.id} id={`repair-row-${r.id}`} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <Link href={`/install/repairs/${r.id}`} className="font-mono text-accent">
                      {r.repairNo}
                    </Link>
                    <div className="font-mono text-[11px] text-muted">{r.orderCode}</div>
                  </td>
                  <td className="px-3 py-2">{r.customerName}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {r.takenBy.name ?? "—"}
                    <div>{r.fillDate}</div>
                  </td>
                  <td className={`px-3 py-2 ${r.overdue ? "font-semibold text-danger" : "text-foreground"}`}>
                    {r.targetDate}
                    {r.overdue && <div className="text-[11px]">已过目标日</div>}
                    <div className="text-[11px] font-normal text-muted">{r.customerConfirmed ? "已和客户确认" : "未和客户确认"}</div>
                  </td>
                  <td className="px-3 py-2">{r.rowCount}</td>
                  <td className="px-3 py-2 text-xs">{factoryText(r.factory)}</td>
                  <td className="px-3 py-2">
                    <StageBadge stage={r.stage} label={r.stageLabel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RepairDetail({ id }: { id: string }) {
  const { data, error, loading } = useRepairFetch<{ repair: RepairDetailData }>(`/api/install/repairs/${id}`);
  const r = data?.repair;
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <Link href="/install/repairs" className="inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft size={16} /> 返修单
      </Link>
      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {r && (
        <>
          <div className="rounded-xl border border-border bg-card-bg p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="font-mono text-lg font-bold text-foreground">{r.repairNo}</h1>
                <div className="mt-0.5 text-sm text-foreground">
                  {r.customerName} · <span className="font-mono">{r.orderCode}</span>
                </div>
              </div>
              <StageBadge stage={r.stage} label={r.stageLabel} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div><dt className="text-muted">电话</dt><dd className="text-foreground">{r.phone || "—"}</dd></div>
              <div><dt className="text-muted">提交人（Taken by）</dt><dd className="text-foreground">{r.takenBy.name ?? "—"}</dd></div>
              <div><dt className="text-muted">填写日</dt><dd className="text-foreground">{r.fillDate}</dd></div>
              <div><dt className="text-muted">客户期望日</dt><dd className="text-foreground">{r.customerPreferredDate ?? "—"}</dd></div>
              <div>
                <dt className="text-muted">目标返修日</dt>
                <dd className={r.overdue ? "font-semibold text-danger" : "text-foreground"}>{r.targetDate}{r.overdue ? "（已过）" : ""}</dd>
              </div>
              <div><dt className="text-muted">已和客户确认</dt><dd className="text-foreground">{r.customerConfirmed ? "是" : "否"}</dd></div>
              <div className="col-span-2 sm:col-span-3"><dt className="text-muted">需工厂出单</dt><dd className="text-foreground">{factoryText(r.factory)}</dd></div>
              {r.notes && (
                <div className="col-span-2 sm:col-span-3"><dt className="text-muted">备注</dt><dd className="whitespace-pre-wrap text-foreground">{r.notes}</dd></div>
              )}
            </dl>
            <Link
              href={`/install/repairs/${r.id}/print`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground"
            >
              <Printer size={15} /> 打印维修单
            </Link>
          </div>
          <div className="space-y-2">
            {r.rows.map((row) => (
              <div key={row.n} className="rounded-xl border border-[rgba(201,138,34,0.4)] bg-card-bg p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted">{row.n}.</span>
                  <span className="font-semibold text-foreground">#{row.itemNumber} {row.location || "—"}</span>
                  <span className="rounded-full bg-[rgba(26,36,32,0.06)] px-1.5 py-0.5 text-[10px] text-muted">{row.sectionLabel}</span>
                  {row.categoryLabel && <span className="text-xs text-muted">{row.categoryLabel}</span>}
                </div>
                <div className="mt-1 text-sm text-[#a86a12]">
                  {row.issueTypeLabel} · {row.needsFactory ? "需工厂出单" : "不需工厂"}
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{row.description}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.photos.map((p) => (
                    <a key={p.proxyUrl} href={p.proxyUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.proxyUrl} alt={`第 ${row.n} 行问题照片`} className="h-20 w-20 rounded border border-border object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 纸质维修单版式：打印时只输出 #repair-print */
export function RepairPrint({ id }: { id: string }) {
  const { data, error, loading } = useRepairFetch<{ repair: RepairDetailData }>(`/api/install/repairs/${id}`);
  const r = data?.repair;
  const cell = "border border-black px-2 py-1 align-top";
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <style>{`@media print {
  body * { visibility: hidden !important; }
  #repair-print, #repair-print * { visibility: visible !important; }
  #repair-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; border: 0; }
}`}</style>
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/install/repairs/${id}`} className="inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft size={16} /> 维修单
        </Link>
        {r && (
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-[color:var(--on-accent)]">
            <Printer size={15} /> 打印
          </button>
        )}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {r && (
        <div id="repair-print" className="rounded-lg border border-border bg-white p-6 text-[13px] text-black">
          <div className="text-center">
            <div className="text-lg font-bold tracking-wide">{r.company.name.toUpperCase()}</div>
            <div className="text-xs">{r.company.address.toUpperCase()}</div>
            <div className="mt-1 text-sm font-semibold">REPAIR / SERVICE ORDER · {r.repairNo}</div>
          </div>
          <table className="mt-4 w-full border-collapse">
            <tbody>
              <tr>
                <td className={`${cell} w-1/2`}><b>Name:</b> {r.customerName}</td>
                <td className={cell}><b>Order#:</b> {r.orderCode}</td>
              </tr>
              <tr>
                <td className={cell}><b>Taken by:</b> {r.takenBy.name ?? ""}</td>
                <td className={cell}><b>Phone:</b> {r.phone}</td>
              </tr>
              <tr>
                <td className={cell} colSpan={2}><b>Notes:</b> {r.notes}</td>
              </tr>
            </tbody>
          </table>
          <table className="mt-3 w-full border-collapse">
            <thead>
              <tr>
                <th className={`${cell} w-8`}>#</th>
                <th className={`${cell} w-40`}>Location</th>
                <th className={cell}>Description</th>
                <th className={`${cell} w-36`}>Type / Factory</th>
              </tr>
            </thead>
            <tbody>
              {padPrintRows(r.rows).map((row, i) => (
                <tr key={i} className="h-8">
                  <td className={`${cell} text-center`}>{i + 1}</td>
                  <td className={cell}>{row?.location ?? ""}</td>
                  <td className={cell}>{row?.description ?? ""}</td>
                  <td className={cell}>{row ? `${row.issueTypeLabel}${row.needsFactory ? " · 需工厂" : ""}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-between text-sm">
            <span><b>Filling Date:</b> {r.fillDate}</span>
            <span><b>Target return date:</b> {r.targetDate}{r.customerConfirmed ? "（已和客户确认）" : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
