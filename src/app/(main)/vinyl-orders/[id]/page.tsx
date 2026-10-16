"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, Pencil, AlertCircle, AlertTriangle, ChevronRight, Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  VINYL_STATUS_LABELS, getNextStatuses, type VinylOrderStatus,
} from "@/lib/vinyl/order-state-machine";

interface Item {
  id: string;
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  panelCount: number;
  panelCode: string;
  dividerSpec: string | null;
  frameType: string;
  frameCount: string;
  inOut: string;
  structure: string;
  cavityWidth: number | null;
  cavityHeight: number | null;
  panelWidth: number | null;
  panelHeight: number | null;
  midRail: number | null;
  topLouvers: number | null;
  bottomLouvers: number | null;
  louverPitch: number | null;
  strips: number | null;
  caps: number | null;
  squareFeet: number | null;
  warningsJson: string | null;
  itemRemark: string | null;
}

interface Order {
  id: string;
  code: string;
  status: string;
  ruleVersion: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  louverSize: number;
  color: string;
  quoteId: string | null;
  createdAt: string;
  items: Item[];
  statusLogs: { id: string; fromStatus: string; toStatus: string; note: string | null; createdAt: string }[];
}

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return String(Math.round(v * 10000) / 10000);
}

export default function VinylOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/vinyl/orders/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOrder(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * 导出必须走 apiFetch —— 裸 <a href> 会绕过 orgId 注入，
   * 平台管理员身份下 resolveTradeOrgId 强制要求显式 orgId，链接必 400。
   */
  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      const res = await apiFetch(`/api/vinyl/orders/${id}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order?.code || "vinyl"}_Vinyl工艺单.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? `导出失败：${e.message}` : "导出请求失败");
    } finally {
      setExporting(false);
    }
  }

  async function transition(toStatus: string) {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/vinyl/orders/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "状态推进失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-danger">{error || "工艺单不存在"}</p>
      </div>
    );
  }

  // 签名自动生成的单会带两类记录：
  //   todo    必须人工补齐（补齐前不能下料）
  //   default 用了默认值，请工厂确认
  // 手工录入的单只有引擎告警（无 kind 字段），按 todo 处理。
  type RowNote = { code: string; message: string; kind?: "todo" | "default" };
  const allNotes: RowNote[] = order.items.flatMap((it) => {
    if (!it.warningsJson) return [];
    try {
      const parsed = JSON.parse(it.warningsJson);
      return Array.isArray(parsed) ? (parsed as RowNote[]) : [];
    } catch {
      // 坏 JSON 不能让整页白屏
      return [];
    }
  });
  const todoNotes = allNotes.filter((n) => (n.kind ?? "todo") === "todo");
  const defaultNotes = allNotes.filter((n) => n.kind === "default");

  const nexts = getNextStatuses(order.status);
  const editable = order.status === "draft" || order.status === "confirmed";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Link href="/vinyl-orders" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={15} /> 返回工艺单列表
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-bold text-foreground">{order.code}</h1>
          <p className="mt-1 text-sm text-muted">
            {order.customerName} · {order.items.length} 扇 · 百叶 {order.louverSize}&quot; · {order.color}
            {order.quoteId && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">报价签约生成</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent-soft disabled:opacity-40">
            <Download size={15} /> {exporting ? "导出中…" : "导出 Excel"}
          </button>
          {editable && (
            <Link href={`/vinyl-orders/${order.id}/edit`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent-soft">
              <Pencil size={15} /> 编辑
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* 状态与推进 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4">
        <span className="text-sm text-muted">当前状态</span>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
          {VINYL_STATUS_LABELS[order.status as VinylOrderStatus] ?? order.status}
        </span>
        {nexts.length > 0 && <ChevronRight size={16} className="text-muted" />}
        {nexts.map((s) => (
          <button key={s} onClick={() => transition(s)} disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-40">
            推进到「{VINYL_STATUS_LABELS[s as VinylOrderStatus] ?? s}」
          </button>
        ))}
        <span className="ml-auto rounded bg-[rgba(26,36,32,0.04)] px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {order.ruleVersion}
        </span>
      </div>

      {todoNotes.length > 0 && (
        <div className="rounded-xl border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.03)] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
            <AlertCircle size={15} /> 待补齐（{todoNotes.length} 项）
          </h3>
          <ul className="space-y-1 text-xs text-danger/90">
            {todoNotes.map((n, i) => (
              <li key={`todo-${i}`}>· {n.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            补齐前不要下料 —— 这些项报价单里没有对应信息，系统不猜；导出的工艺单表尾也会列出。
          </p>
        </div>
      )}

      {defaultNotes.length > 0 && (
        <div className="rounded-xl border border-[rgba(154,106,47,0.2)] bg-[rgba(154,106,47,0.03)] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#9a6a2f]">
            <AlertTriangle size={15} /> 默认值待确认（{defaultNotes.length} 项）
          </h3>
          <ul className="space-y-1 text-xs text-[#9a6a2f]/90">
            {defaultNotes.map((n, i) => (
              <li key={`def-${i}`}>· {n.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            这些已按默认值算出尺寸，与实际不符请在「编辑」里改后重算。
          </p>
        </div>
      )}

      {/* 基本信息 */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card-bg p-5 text-sm md:grid-cols-4">
        {[
          ["电话", order.phone || "-"],
          ["地址", order.address || "-"],
          ["安装时间", order.installDate || "-"],
          ["备注", order.remarks || "-"],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-0.5 text-foreground/85">{v}</div>
          </div>
        ))}
      </div>

      {/* 窗户明细 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">窗户明细</h2>
          <p className="mt-0.5 text-xs text-muted">
            下方为签入时的计算快照；导出 Excel 时会按本单的规则版本重新计算，以导出件为准下料。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">位置</th>
                <th className="px-3 py-2.5 font-medium">测量</th>
                <th className="px-3 py-2.5 font-medium">扇/码</th>
                <th className="px-3 py-2.5 font-medium">外框</th>
                <th className="px-3 py-2.5 font-medium">内空</th>
                <th className="px-3 py-2.5 font-medium">成品</th>
                <th className="px-3 py-2.5 font-medium">百叶 上/下</th>
                <th className="px-3 py-2.5 font-medium">间距</th>
                <th className="px-3 py-2.5 font-medium">条/盖</th>
                <th className="px-3 py-2.5 font-medium">SF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((it) => (
                <tr key={it.id} className="hover:bg-[rgba(43,96,85,0.02)]">
                  <td className="px-4 py-2 text-muted">{it.itemNumber}</td>
                  <td className="px-3 py-2">
                    {it.location}
                    {it.itemRemark && <div className="text-xs text-muted">{it.itemRemark}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono">{fmt(it.width)}×{fmt(it.height)}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono">{it.panelCount}</span>
                    <span className="ml-1 font-mono text-muted">{it.panelCode}</span>
                    {it.dividerSpec && <span className="ml-1 text-xs text-muted">/{it.dividerSpec}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {it.frameType}/{it.frameCount}/{it.inOut}
                    {it.structure === "无框" && <span className="ml-1">·无框</span>}
                  </td>
                  <td className="px-3 py-2 font-mono">{fmt(it.cavityWidth)}×{fmt(it.cavityHeight)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(it.panelWidth)}×{fmt(it.panelHeight)}</td>
                  <td className="px-3 py-2 font-mono">{it.topLouvers ?? "-"}/{it.bottomLouvers ?? "-"}</td>
                  <td className="px-3 py-2 font-mono">{fmt(it.louverPitch)}</td>
                  <td className="px-3 py-2 font-mono">
                    {it.strips == null ? <span className="text-danger">待补</span> : `${it.strips}/${it.caps}`}
                  </td>
                  <td className="px-3 py-2 font-mono">{it.squareFeet ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.statusLogs.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <h2 className="mb-3 text-base font-semibold">状态变更</h2>
          <ul className="space-y-2 text-sm">
            {order.statusLogs.map((log) => (
              <li key={log.id} className="flex items-center gap-2 text-muted">
                <span className="font-mono text-xs">
                  {new Date(log.createdAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}
                </span>
                <span>
                  {VINYL_STATUS_LABELS[log.fromStatus as VinylOrderStatus] ?? log.fromStatus}
                  {" → "}
                  {VINYL_STATUS_LABELS[log.toStatus as VinylOrderStatus] ?? log.toStatus}
                </span>
                {log.note && <span className="text-xs">{log.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
