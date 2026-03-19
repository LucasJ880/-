"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit,
  Trash2,
  FileText,
  CheckCircle,
  Clock,
  Ruler,
  Scissors,
  Download,
} from "lucide-react";
import { getCordLengthTier } from "@/lib/blinds/calculation-engine";

interface BlindsOrderItem {
  id: string;
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  fabricSku: string;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: number | null;
  silkRatio: number | null;
  bottomBarWidth: number | null;
  itemRemark: string | null;
  cutHeadrail: number | null;
  cutTube38: number | null;
  cutRollerBar: number | null;
  cutZebraBar: number | null;
  cutCoreRod: number | null;
  cutShangrilaBar: number | null;
  cutFabricWidth: number | null;
  cutFabricLength: number | null;
  insertSize: number | null;
  cordLength: number | null;
  cordSleeveLen: number | null;
  squareFeet: number | null;
  sortOrder: number;
}

interface BlindsOrder {
  id: string;
  code: string;
  status: string;
  ruleVersion: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  items: BlindsOrderItem[];
  project: { id: string; name: string; color: string } | null;
  creator: { id: string; name: string };
}

const STATUS_MAP: Record<string, { label: string; color: string; next?: string; nextLabel?: string }> = {
  draft: { label: "草稿", color: "bg-gray-100 text-gray-700", next: "confirmed", nextLabel: "确认工艺单" },
  confirmed: { label: "已确认", color: "bg-blue-100 text-blue-700", next: "completed", nextLabel: "标记完成" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700" },
};

function fmt(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function BlindsOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<BlindsOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "parts" | "fabric">("overview");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [id]);

  async function loadOrder() {
    const res = await fetch(`/api/blinds-orders/${id}`);
    if (res.ok) {
      setOrder(await res.json());
    }
    setLoading(false);
  }

  async function updateStatus(newStatus: string) {
    const res = await fetch(`/api/blinds-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setOrder(await res.json());
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/blinds-orders/${id}/export`);
      if (!res.ok) {
        alert("导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order?.code || "blinds"}_工艺单.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("导出请求失败");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("确定删除此工艺单？此操作不可恢复。")) return;
    const res = await fetch(`/api/blinds-orders/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/blinds-orders");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">工艺单不存在</p>
        <Link href="/blinds-orders" className="mt-4 text-blue-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const st = STATUS_MAP[order.status] || STATUS_MAP.draft;
  const totalSF = order.items.reduce((sum, item) => sum + (item.squareFeet || 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/blinds-orders" className="text-gray-400 transition-colors hover:text-gray-600">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{order.code}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
              {st.label}
            </span>
          </div>
          <p className="mt-1 ml-8 text-sm text-gray-500">
            {order.customerName}
            {order.address ? ` · ${order.address}` : ""}
            {order.installDate ? ` · 安装: ${order.installDate}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            <Download size={14} />
            {exporting ? "导出中..." : "导出 Excel"}
          </button>
          {st.next && (
            <button
              onClick={() => updateStatus(st.next!)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {st.nextLabel}
            </button>
          )}
          <Link
            href={`/blinds-orders/${id}/edit`}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Edit size={14} />
            编辑
          </Link>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">窗户数</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{order.items.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">总面积</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{totalSF.toFixed(2)} <span className="text-sm font-normal">SF</span></div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">规则版本</div>
          <div className="mt-1 font-mono text-sm text-gray-700">{order.ruleVersion}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">创建时间</div>
          <div className="mt-1 text-sm text-gray-700">
            {new Date(order.createdAt).toLocaleString("zh-CN")}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: "overview" as const, label: "订单总览", icon: FileText },
          { key: "parts" as const, label: "配件开料表", icon: Ruler },
          { key: "fabric" as const, label: "面料开料表", icon: Scissors },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab order={order} />}
      {tab === "parts" && <PartsCuttingTab items={order.items} />}
      {tab === "fabric" && <FabricCuttingTab items={order.items} />}
    </div>
  );
}

function OverviewTab({ order }: { order: BlindsOrder }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-gray-500">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">位置</th>
              <th className="px-3 py-2.5 font-medium">宽×高</th>
              <th className="px-3 py-2.5 font-medium">面料号</th>
              <th className="px-3 py-2.5 font-medium">产品</th>
              <th className="px-3 py-2.5 font-medium">测量</th>
              <th className="px-3 py-2.5 font-medium">操控</th>
              <th className="px-3 py-2.5 font-medium">侧</th>
              <th className="px-3 py-2.5 font-medium">罩盒</th>
              <th className="px-3 py-2.5 font-medium">安装</th>
              <th className="px-3 py-2.5 font-medium">底杆覆盖</th>
              <th className="px-3 py-2.5 font-medium">SF</th>
              <th className="px-3 py-2.5 font-medium">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {order.items.map((item) => (
              <tr key={item.id} className="hover:bg-blue-50/30">
                <td className="px-3 py-2 text-gray-400">{item.itemNumber}</td>
                <td className="px-3 py-2 font-medium text-gray-700">{item.location}</td>
                <td className="px-3 py-2 font-mono">{item.width} × {item.height}</td>
                <td className="px-3 py-2">{item.fabricSku}</td>
                <td className="px-3 py-2">{item.productType}</td>
                <td className="px-3 py-2">{item.measureType}</td>
                <td className="px-3 py-2">{item.controlType}</td>
                <td className="px-3 py-2">{item.controlSide}</td>
                <td className="px-3 py-2">{item.headrailType}</td>
                <td className="px-3 py-2">{item.mountType}</td>
                <td className="px-3 py-2 font-mono">{item.bottomBarWidth ?? "-"}</td>
                <td className="px-3 py-2 font-mono">{item.squareFeet?.toFixed(2) ?? "-"}</td>
                <td className="px-3 py-2 text-gray-500">{item.itemRemark || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartsCuttingTab({ items }: { items: BlindsOrderItem[] }) {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-gray-500">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">位置</th>
              <th className="px-3 py-2.5 font-medium">产品</th>
              <th className="px-3 py-2.5 font-medium">操控</th>
              <th className="px-3 py-2.5 font-medium">罩盒</th>
              <th className="px-3 py-2.5 font-medium">罩盒尺寸</th>
              <th className="px-3 py-2.5 font-medium">38管</th>
              <th className="px-3 py-2.5 font-medium">下杆</th>
              <th className="px-3 py-2.5 font-medium">圆芯杆</th>
              <th className="px-3 py-2.5 font-medium">面料宽</th>
              <th className="px-3 py-2.5 font-medium">插片</th>
              <th className="px-3 py-2.5 font-medium">数量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((item) => {
              const barLabel =
                item.productType === "卷帘" ? "卷帘下杆"
                : item.productType === "斑马帘" ? "斑马帘下杆"
                : "香格里拉下杆";
              const barVal =
                item.productType === "卷帘" ? item.cutRollerBar
                : item.productType === "斑马帘" ? item.cutZebraBar
                : item.cutShangrilaBar;

              return (
                <tr key={item.id} className="hover:bg-blue-50/30">
                  <td className="px-3 py-2 text-gray-400">{item.itemNumber}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.location}</td>
                  <td className="px-3 py-2">{item.productType}</td>
                  <td className="px-3 py-2">{item.controlType}</td>
                  <td className="px-3 py-2">{item.headrailType}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutHeadrail)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutTube38)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(barVal)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutCoreRod)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricWidth)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.insertSize)}</td>
                  <td className="px-3 py-2">1</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FabricCuttingTab({ items }: { items: BlindsOrderItem[] }) {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const totalCord = sorted.reduce((s, i) => s + (i.cordLength || 0), 0);
  const totalSleeve = sorted.reduce((s, i) => s + (i.cordSleeveLen || 0), 0);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-gray-500">
                <th className="px-3 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">面料号</th>
                <th className="px-3 py-2.5 font-medium">面料宽</th>
                <th className="px-3 py-2.5 font-medium">面料长</th>
                <th className="px-3 py-2.5 font-medium">拉绳(m)</th>
                <th className="px-3 py-2.5 font-medium">绳套(m)</th>
                <th className="px-3 py-2.5 font-medium">拉绳分档</th>
                <th className="px-3 py-2.5 font-medium">操控侧</th>
                <th className="px-3 py-2.5 font-medium">位置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((item) => (
                <tr key={item.id} className="hover:bg-blue-50/30">
                  <td className="px-3 py-2 text-gray-400">{item.itemNumber}</td>
                  <td className="px-3 py-2 font-medium">{item.fabricSku}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricWidth)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cutFabricLength)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cordLength)}</td>
                  <td className="px-3 py-2 font-mono">{fmt(item.cordSleeveLen)}</td>
                  <td className="px-3 py-2">
                    {getCordLengthTier(item.height, item.controlType) || "-"}
                  </td>
                  <td className="px-3 py-2">{item.controlSide}</td>
                  <td className="px-3 py-2 text-gray-500">{item.location}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                <td className="px-3 py-2" colSpan={4}>合计</td>
                <td className="px-3 py-2 font-mono">{totalCord.toFixed(4)} m</td>
                <td className="px-3 py-2 font-mono">{totalSleeve.toFixed(4)} m</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
