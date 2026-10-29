"use client";

/**
 * INSTALL-2d：维修单页面（spec installation/repairs「维修单列表与详情」「维修单打印版」）
 * — RepairList：/install/repairs，按目标日升序；逾期标红
 * — RepairDetail：/install/repairs/[id]，表头 + 行（问题照）+ 当前阶段 + 打印入口
 * — RepairPrint：/install/repairs/[id]/print，纸质版式（抬头大写、至少 10 行、Filling Date），无照片无金额
 * 数据只来自 /api/install/repairs*（install.task.read ORG）；无权时显示提示。
 * INSTALL-2e：详情显示出单登记 / 返修排期 / 关闭情况；「登记出单」「安排返修 / 改期」按钮只按接口返回的可执行操作显示。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, ClipboardList, Loader2, Package, Printer, X } from "lucide-react";
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
  return { data, error, loading, reload: load };
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

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
  repair_scheduled: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]",
};

/** 列表 / 详情共用的进度一句话 */
function progressText(r: RepairListItem): string {
  if (r.closed) return r.closed.reason === "superseded" ? `已转入 ${r.closed.supersededBy ?? "新单"}` : r.closed.label;
  if (r.scheduledAt) return `返修 ${fmtWhen(r.scheduledAt)}`;
  if (r.pendingFactory.length > 0) return `待出单：${r.pendingFactory.map((c) => c.label).join("、")}`;
  return "待排返修";
}

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
                <th className="px-3 py-2">进度</th>
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
                  <td className={`px-3 py-2 ${r.overdue ? "font-semibold text-danger" : r.closed ? "text-muted" : "text-foreground"}`}>
                    {r.targetDate}
                    {r.overdue && <div className="text-[11px]">已过目标日</div>}
                    <div className="text-[11px] font-normal text-muted">{r.customerConfirmed ? "已和客户确认" : "未和客户确认"}</div>
                  </td>
                  <td className="px-3 py-2">{r.rowCount}</td>
                  <td className="px-3 py-2 text-xs">{factoryText(r.factory)}</td>
                  <td className="px-3 py-2 text-xs">{progressText(r)}</td>
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
  const { data, error, loading, reload } = useRepairFetch<{ repair: RepairDetailData }>(`/api/install/repairs/${id}`);
  const r = data?.repair;
  const [dialog, setDialog] = useState<RepairDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
          {notice && <div className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm text-foreground">{notice}</div>}
          <RepairProgressCards repair={r} onAction={setDialog} />
          {dialog === "issue" && (
            <FactoryIssueDialog
              repair={r}
              onClose={() => setDialog(null)}
              onDone={async (msg) => {
                setDialog(null);
                setNotice(msg);
                await reload();
              }}
            />
          )}
          {dialog === "schedule" && (
            <ScheduleDialog
              repair={r}
              onClose={() => setDialog(null)}
              onDone={async (msg) => {
                setDialog(null);
                setNotice(msg);
                await reload();
              }}
            />
          )}
          {(dialog === "void" || dialog === "close") && (
            <CloseRepairDialog
              repair={r}
              kind={dialog}
              onClose={() => setDialog(null)}
              onDone={async (msg) => {
                setDialog(null);
                setNotice(msg);
                await reload();
              }}
            />
          )}
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

type RepairDialog = "issue" | "schedule" | "void" | "close";

/** 关闭横幅的一句话（INSTALL-2f：已作废 / 关闭不返修带原因说明与操作人） */
function closedText(c: NonNullable<RepairDetailData["progress"]["closed"]>): string {
  if (c.reason === "superseded") return `返修时又发现问题，转入 ${c.supersededBy ?? "新单"}`;
  if (c.reason === "completed") return "返修已完成";
  return `${c.label}${c.note ? `：${c.note}` : ""} · ${c.by.name ?? "—"}`;
}

/** INSTALL-2e：出单登记 / 返修排期 / 关闭情况；按钮只按接口返回的可执行操作显示（design D9） */
function RepairProgressCards({ repair: r, onAction }: { repair: RepairDetailData; onAction: (a: RepairDialog) => void }) {
  const p = r.progress;
  const exceptional = p.closed?.reason === "voided" || p.closed?.reason === "waived";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {p.closed && (
        <div
          className={`rounded-xl border p-3 text-sm sm:col-span-2 ${
            exceptional ? "border-border bg-[rgba(26,36,32,0.04)] text-foreground" : "border-[rgba(46,122,86,0.35)] bg-[rgba(46,122,86,0.06)] text-[#2e7a56]"
          }`}
        >
          维修单已关闭：{closedText(p.closed)}（{fmtWhen(p.closed.at)}）
        </div>
      )}
      <section aria-label="出单" className="rounded-xl border border-border bg-card-bg p-3 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Package size={15} /> 工厂出单
        </div>
        {p.factoryCategories.length === 0 ? (
          <p className="mt-1 text-xs text-muted">不需工厂出单</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {p.issued.map((i) => (
              <li key={i.key} className="text-foreground">
                ✓ {i.label}：预计 <b>{i.readyDate}</b> 备好 · {i.by.name ?? "—"}
                {i.note && <span className="text-muted"> · {i.note}</span>}
              </li>
            ))}
            {p.pending.map((c) => (
              <li key={c.key} className={p.closed ? "text-muted" : "text-[#a86a12]"}>
                ○ {c.label}：{p.closed ? "未登记（维修单已关闭）" : "待登记"}
              </li>
            ))}
          </ul>
        )}
        {r.actions.issueCategories.length > 0 && (
          <button type="button" onClick={() => onAction("issue")} className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)]">
            登记出单（{r.actions.issueCategories.map((c) => c.label).join("、")}）
          </button>
        )}
      </section>
      <section aria-label="返修排期" className="rounded-xl border border-border bg-card-bg p-3 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <CalendarClock size={15} /> 返修排期
        </div>
        {p.schedule ? (
          <p className="mt-1 text-xs text-foreground">
            {fmtWhen(p.schedule.installAt)} · 安装工 {p.schedule.assignedTo.name ?? "—"}
            {p.schedule.completed ? " · 已完成" : p.schedule.cancelled ? " · 已取消" : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">尚未排返修{p.readyDate ? `（返修件预计 ${p.readyDate} 备好）` : ""}</p>
        )}
        {r.actions.canSchedule && (
          <button type="button" onClick={() => onAction("schedule")} className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)]">
            {p.schedule && !p.schedule.completed ? "改期" : "安排返修"}
          </button>
        )}
      </section>
      {/* INSTALL-2f：例外出口，只按接口返回的可执行操作显示（design D5） */}
      {(r.actions.canVoid || r.actions.canClose) && (
        <section aria-label="处理维修单" className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted sm:col-span-2">
          <span>不再按此单返修：</span>
          {r.actions.canVoid && (
            <button type="button" onClick={() => onAction("void")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">
              作废维修单
            </button>
          )}
          {r.actions.canClose && (
            <button type="button" onClick={() => onAction("close")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">
              关闭不返修
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function DialogShell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card-bg p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{label}</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function FactoryIssueDialog({ repair: r, onClose, onDone }: { repair: RepairDetailData; onClose: () => void; onDone: (msg: string) => void | Promise<void> }) {
  const [readyDate, setReadyDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labels = r.actions.issueCategories.map((c) => c.label).join("、");
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const { ok, data } = await postJson(`/api/install/repairs/${r.id}/factory-issued`, { readyDate, note });
      if (!ok) {
        setErr(String(data.error ?? "登记失败"));
        return;
      }
      await onDone(`已登记出单：${labels}，预计 ${readyDate} 备好`);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogShell label="登记出单" onClose={onClose}>
      <p className="text-xs text-muted">
        {r.repairNo} · 登记品类：<b className="text-foreground">{labels}</b>
      </p>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">预计备好日</span>
        <input type="date" aria-label="预计备好日" min={r.fillDate} value={readyDate} onChange={(e) => setReadyDate(e.target.value)} className="w-full rounded-md border border-border px-2 py-1.5" />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">备注（可不填）</span>
        <textarea aria-label="出单备注" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="w-full rounded-md border border-border px-2 py-1.5" />
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <button type="button" disabled={busy || !readyDate} onClick={save} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[color:var(--on-accent)] disabled:opacity-50">
        {busy && <Loader2 size={15} className="animate-spin" />}确认已出单
      </button>
    </DialogShell>
  );
}

function ScheduleDialog({ repair: r, onClose, onDone }: { repair: RepairDetailData; onClose: () => void; onDone: (msg: string) => void | Promise<void> }) {
  const [installers, setInstallers] = useState<Array<{ id: string; name: string }>>([]);
  const [assignedToId, setAssignedToId] = useState(r.progress.schedule?.assignedTo.id ?? "");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/install/installers");
        const data = (await res.json().catch(() => ({}))) as { installers?: Array<{ id: string; name: string }> };
        setInstallers(data.installers ?? []);
      } catch {
        setInstallers([]);
      }
    })();
  }, []);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const { ok, data } = await postJson(`/api/install/repairs/${r.id}/schedule`, { installAt: new Date(when).toISOString(), assignedToId });
      if (!ok) {
        setErr(String(data.error ?? "安排失败"));
        return;
      }
      const warnings = (data.warnings as string[] | undefined) ?? [];
      const who = installers.find((i) => i.id === assignedToId)?.name ?? "";
      await onDone(`${data.rescheduled ? "已改期" : "已安排返修"}：${fmtWhen(new Date(when).toISOString())} · ${who}${warnings.length ? `。注意：${warnings.join("；")}` : ""}`);
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogShell label={r.progress.schedule && !r.progress.schedule.completed ? "改期" : "安排返修"} onClose={onClose}>
      <p className="text-xs text-muted">
        {r.repairNo} · {r.rowCount} 项 · 目标 {r.targetDate}
        {r.progress.readyDate ? ` · 返修件预计 ${r.progress.readyDate} 备好` : ""}
        {r.progress.pending.length > 0 ? ` · 出单尚未登记：${r.progress.pending.map((c) => c.label).join("、")}` : ""}
      </p>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">安装工</span>
        <select aria-label="返修安装工" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="w-full rounded-md border border-border bg-white px-2 py-1.5">
          <option value="">选择安装工</option>
          {installers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">返修时间</span>
        <input type="datetime-local" aria-label="返修时间" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-md border border-border px-2 py-1.5" />
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <button type="button" disabled={busy || !when || !assignedToId} onClick={save} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[color:var(--on-accent)] disabled:opacity-50">
        {busy && <Loader2 size={15} className="animate-spin" />}确认排期
      </button>
    </DialogShell>
  );
}

/** 纸质维修单版式：打印时只输出 #repair-print */
/** INSTALL-2f：作废 / 关闭不返修（必填原因；写明会发生什么） */
function CloseRepairDialog({
  repair: r,
  kind,
  onClose,
  onDone,
}: {
  repair: RepairDetailData;
  kind: "void" | "close";
  onClose: () => void;
  onDone: (msg: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isVoid = kind === "void";
  const label = isVoid ? "作废维修单" : "关闭不返修";
  const pendingReturn = !!r.progress.schedule && !r.progress.schedule.completed;
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const { ok, data } = await postJson(`/api/install/repairs/${r.id}/${isVoid ? "void" : "close"}`, { reason });
      if (!ok) {
        setErr(String(data.error ?? `${label}失败`));
        return;
      }
      await onDone(
        isVoid
          ? `已作废 ${r.repairNo}：首装任务已重新打开${pendingReturn ? "，返修预约已取消" : ""}`
          : `已关闭 ${r.repairNo}（不返修）${pendingReturn ? "：返修预约已取消" : ""}${data.orderStatus === "installed" ? "，工艺单转已安装、进入会计待收尾款" : ""}`,
      );
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogShell label={label} onClose={onClose}>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
        {isVoid ? (
          <>
            <li>只在提交错了时用：维修单作废，不再返修。</li>
            <li>提交维修单的那次安装任务会重新打开，安装工处理各窗后完成收口。</li>
          </>
        ) : (
          <>
            <li>客户接受现状、不再返修时用。</li>
            <li>工艺单转为已安装，进入会计「待收尾款」。</li>
          </>
        )}
        {pendingReturn && <li>已排的返修预约（{fmtWhen(r.progress.schedule!.installAt)}）会取消，并通知安装工。</li>}
      </ul>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">原因（必填，只在详情里显示，不发进通知）</span>
        <textarea aria-label={`${label}原因`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="w-full rounded-md border border-border px-2 py-1.5" />
      </label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <button type="button" disabled={busy || !reason.trim()} onClick={save} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[color:var(--on-accent)] disabled:opacity-50">
        {busy && <Loader2 size={15} className="animate-spin" />}确认{label}
      </button>
    </DialogShell>
  );
}

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
