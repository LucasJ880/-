"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Calculator, Save, ArrowLeft, Copy, AlertCircle, AlertTriangle } from "lucide-react";
import {
  HEADRAIL_TYPES,
  CONTROL_TYPES,
  PRODUCT_TYPES,
  MEASURE_TYPES,
  CONTROL_SIDES,
  MOUNT_TYPES,
  RULE_VERSION,
  SUPPORTED_FABRIC_RATIOS,
} from "@/lib/blinds/deduction-rules";
import { apiFetch } from "@/lib/api-fetch";

interface OrderItem {
  key: string;
  location: string;
  width: string;
  height: string;
  fabricSku: string;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: string;
  silkRatio: string;
  bottomBarWidth: string;
  itemRemark: string;
  // calc results
  calc?: {
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
    squareFeet: number;
    sortOrder: number;
  };
}

interface OrderForm {
  code: string;
  customerName: string;
  phone: string;
  address: string;
  installDate: string;
  remarks: string;
  projectId: string;
}

interface Props {
  initialOrder?: OrderForm;
  initialItems?: OrderItem[];
  orderId?: string;
  mode?: "create" | "edit";
  orderStatus?: string;
}

const DEFAULT_ITEM: () => OrderItem = () => ({
  key: crypto.randomUUID(),
  location: "",
  width: "",
  height: "",
  fabricSku: "",
  productType: "斑马帘",
  measureType: "IN",
  controlType: "普通",
  controlSide: "R",
  headrailType: "亮白插片圆盒",
  mountType: "顶装",
  fabricRatio: "3",
  silkRatio: "2",
  bottomBarWidth: "",
  itemRemark: "",
});

function fmt(v: number | null | undefined): string {
  if (v == null) return "-";
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function BlindsOrderForm({
  initialOrder,
  initialItems,
  orderId,
  mode = "create",
  orderStatus,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [triedSave, setTriedSave] = useState(false);

  const isConfirmed = orderStatus === "confirmed" || orderStatus === "completed";

  const [form, setForm] = useState<OrderForm>(
    initialOrder || {
      code: "",
      customerName: "",
      phone: "",
      address: "",
      installDate: "",
      remarks: "",
      projectId: "",
    }
  );

  const [items, setItems] = useState<OrderItem[]>(
    initialItems && initialItems.length > 0 ? initialItems : [DEFAULT_ITEM()]
  );

  function updateForm(field: keyof OrderForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateItem(index: number, field: keyof OrderItem, value: string) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value, calc: undefined };
      return next;
    });
  }

  function addItem() {
    const last = items[items.length - 1];
    const newItem = DEFAULT_ITEM();
    if (last) {
      newItem.fabricSku = last.fabricSku;
      newItem.productType = last.productType;
      newItem.measureType = last.measureType;
      newItem.controlType = last.controlType;
      newItem.controlSide = last.controlSide;
      newItem.headrailType = last.headrailType;
      newItem.mountType = last.mountType;
      newItem.fabricRatio = last.fabricRatio;
      newItem.silkRatio = last.silkRatio;
    }
    setItems((prev) => [...prev, newItem]);
  }

  function duplicateItem(index: number) {
    const src = items[index];
    const newItem: OrderItem = { ...src, key: crypto.randomUUID(), calc: undefined };
    setItems((prev) => [...prev.slice(0, index + 1), newItem, ...prev.slice(index + 1)]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function validateItems(): { valid: boolean; warns: string[] } {
    const errs: string[] = [];
    const warns: string[] = [];
    items.forEach((item, i) => {
      const n = i + 1;
      if (!item.location.trim()) errs.push(`#${n}: 位置未填写`);
      const w = parseFloat(item.width);
      const h = parseFloat(item.height);
      if (!w) errs.push(`#${n}: 宽度未填写`);
      if (!h) errs.push(`#${n}: 高度未填写`);
      if (w && (w < 10 || w > 200)) warns.push(`#${n}: 宽度 ${w}" 超出常规范围 (10-200)`);
      if (h && (h < 10 || h > 200)) warns.push(`#${n}: 高度 ${h}" 超出常规范围 (10-200)`);
      const bw = item.bottomBarWidth ? parseFloat(item.bottomBarWidth) : null;
      if (bw && w && bw > w) warns.push(`#${n}: 底杆覆盖值 ${bw}" 大于宽度 ${w}"`);
      if (!item.fabricSku.trim()) warns.push(`#${n}: 面料号未填写`);
    });
    if (errs.length > 0) return { valid: false, warns: errs };
    return { valid: true, warns };
  }

  const calculate = useCallback(async () => {
    setCalculating(true);
    setError("");
    try {
      const apiItems = items.map((item) => ({
        width: parseFloat(item.width) || 0,
        height: parseFloat(item.height) || 0,
        productType: item.productType,
        measureType: item.measureType,
        controlType: item.controlType,
        headrailType: item.headrailType,
        fabricRatio: item.productType === "斑马帘" ? parseFloat(item.fabricRatio) || null : null,
        silkRatio: item.productType === "斑马帘" ? parseFloat(item.silkRatio) || null : null,
        bottomBarWidth: item.bottomBarWidth ? parseFloat(item.bottomBarWidth) : null,
      }));

      const res = await apiFetch("/api/blinds-orders/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: apiItems }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "计算失败");
        return;
      }

      const data = await res.json();
      setItems((prev) =>
        prev.map((item, i) => ({
          ...item,
          calc: data.results[i]?.error ? undefined : data.results[i],
        }))
      );
    } catch {
      setError("计算请求失败");
    } finally {
      setCalculating(false);
    }
  }, [items]);

  async function handleSave() {
    setError("");
    setWarnings([]);
    setTriedSave(true);

    if (!form.code.trim()) { setError("请填写订单号"); return; }
    if (!form.customerName.trim()) { setError("请填写客户名称"); return; }

    const { valid, warns } = validateItems();
    if (!valid) {
      setError(warns.join("；"));
      return;
    }
    if (warns.length > 0) setWarnings(warns);

    setSaving(true);
    try {
      const payload = {
        ...form,
        items: items.map((item) => ({
          location: item.location,
          width: parseFloat(item.width),
          height: parseFloat(item.height),
          fabricSku: item.fabricSku,
          productType: item.productType,
          measureType: item.measureType,
          controlType: item.controlType,
          controlSide: item.controlSide,
          headrailType: item.headrailType,
          mountType: item.mountType,
          fabricRatio: item.productType === "斑马帘" ? parseFloat(item.fabricRatio) || null : null,
          silkRatio: item.productType === "斑马帘" ? parseFloat(item.silkRatio) || null : null,
          bottomBarWidth: item.bottomBarWidth ? parseFloat(item.bottomBarWidth) : null,
          itemRemark: item.itemRemark || null,
        })),
      };

      const url = mode === "edit" ? `/api/blinds-orders/${orderId}` : "/api/blinds-orders";
      const method = mode === "edit" ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "保存失败");
        return;
      }

      const data = await res.json();
      router.push(`/blinds-orders/${data.id}`);
    } catch {
      setError("保存请求失败");
    } finally {
      setSaving(false);
    }
  }

  const hasCalcResults = items.some((item) => item.calc);

  function isRowInvalid(item: OrderItem): boolean {
    if (!triedSave) return false;
    return !item.location.trim() || !parseFloat(item.width) || !parseFloat(item.height);
  }

  return (
    <div className="space-y-6">
      {/* Confirmed order warning */}
      {isConfirmed && (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
          <AlertTriangle size={16} className="shrink-0" />
          正在修改已确认工艺单，保存后计算结果将重新生成
        </div>
      )}

      {/* Header info bar */}
      <div className="flex items-center gap-3 rounded-lg bg-[rgba(26,36,32,0.03)] px-4 py-2 text-xs text-muted">
        <span>规则版本:</span>
        <span className="rounded bg-white px-2 py-0.5 font-mono">{RULE_VERSION}</span>
        <span className="mx-2">|</span>
        <span>布纱比: 仅支持 {SUPPORTED_FABRIC_RATIOS.join(", ")}</span>
        <span className="mx-2">|</span>
        <span>单位: 英寸（内部）</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} className="shrink-0" />
            请注意以下提示（不影响保存）
          </div>
          <ul className="ml-6 mt-1 list-disc text-xs">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Order header form */}
      <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-foreground">订单信息</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              订单号 <span className="text-[#a63d3d]">*</span>
            </label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => updateForm("code", e.target.value)}
              placeholder="G0303-Z127L(P)"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              客户名称 <span className="text-[#a63d3d]">*</span>
            </label>
            <input
              type="text"
              value={form.customerName}
              onChange={(e) => updateForm("customerName", e.target.value)}
              placeholder="客户名称"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">电话</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => updateForm("phone", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">安装地址</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => updateForm("address", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">安装时间</label>
            <input
              type="text"
              value={form.installDate}
              onChange={(e) => updateForm("installDate", e.target.value)}
              placeholder="2025-03-15"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium text-muted">备注</label>
            <input
              type="text"
              value={form.remarks}
              onChange={(e) => updateForm("remarks", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
            />
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            窗户明细 ({items.length} 扇)
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={calculate}
              disabled={calculating}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(43,96,85,0.15)] bg-[rgba(43,96,85,0.04)] px-3 py-1.5 text-xs font-medium text-[#2b6055] transition-colors hover:bg-[rgba(43,96,85,0.08)] disabled:opacity-50"
            >
              <Calculator size={14} />
              {calculating ? "计算中..." : "计算裁切"}
            </button>
            <button
              onClick={addItem}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-[rgba(26,36,32,0.03)]"
            >
              <Plus size={14} />
              添加窗户
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
                <th className="px-2 py-2.5 font-medium">#</th>
                <th className="min-w-[120px] px-2 py-2.5 font-medium">位置 *</th>
                <th className="min-w-[80px] px-2 py-2.5 font-medium">宽度 *</th>
                <th className="min-w-[80px] px-2 py-2.5 font-medium">高度 *</th>
                <th className="min-w-[100px] px-2 py-2.5 font-medium">面料号</th>
                <th className="min-w-[80px] px-2 py-2.5 font-medium">产品类型</th>
                <th className="min-w-[60px] px-2 py-2.5 font-medium">测量</th>
                <th className="min-w-[60px] px-2 py-2.5 font-medium">操控</th>
                <th className="min-w-[40px] px-2 py-2.5 font-medium">侧</th>
                <th className="min-w-[120px] px-2 py-2.5 font-medium">罩盒类型</th>
                <th className="min-w-[60px] px-2 py-2.5 font-medium">安装</th>
                <th className="min-w-[80px] px-2 py-2.5 font-medium">底杆覆盖</th>
                <th className="min-w-[100px] px-2 py-2.5 font-medium">备注</th>
                <th className="px-2 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item, i) => (
                <tr key={item.key} className={`group ${isRowInvalid(item) ? "bg-[rgba(166,61,61,0.02)]" : "hover:bg-[rgba(43,96,85,0.02)]"}`}>
                  <td className="px-2 py-1.5 text-muted">{i + 1}</td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      value={item.location}
                      onChange={(e) => updateItem(i, "location", e.target.value)}
                      placeholder="Kitchen"
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.0625"
                      value={item.width}
                      onChange={(e) => updateItem(i, "width", e.target.value)}
                      placeholder="85.1875"
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.0625"
                      value={item.height}
                      onChange={(e) => updateItem(i, "height", e.target.value)}
                      placeholder="87.75"
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      value={item.fabricSku}
                      onChange={(e) => updateItem(i, "fabricSku", e.target.value)}
                      placeholder="ECO BL201"
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.productType}
                      onChange={(e) => updateItem(i, "productType", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.measureType}
                      onChange={(e) => updateItem(i, "measureType", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {MEASURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.controlType}
                      onChange={(e) => updateItem(i, "controlType", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.controlSide}
                      onChange={(e) => updateItem(i, "controlSide", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {CONTROL_SIDES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.headrailType}
                      onChange={(e) => updateItem(i, "headrailType", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {HEADRAIL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={item.mountType}
                      onChange={(e) => updateItem(i, "mountType", e.target.value)}
                      className="w-full rounded border border-border px-1 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    >
                      {MOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.0625"
                      value={item.bottomBarWidth}
                      onChange={(e) => updateItem(i, "bottomBarWidth", e.target.value)}
                      placeholder="手动"
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      value={item.itemRemark}
                      onChange={(e) => updateItem(i, "itemRemark", e.target.value)}
                      placeholder=""
                      className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-[#2b6055]"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => duplicateItem(i)}
                        className="rounded p-1 text-muted transition-colors hover:bg-[rgba(26,36,32,0.05)] hover:text-foreground"
                        title="复制"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={() => removeItem(i)}
                        disabled={items.length <= 1}
                        className="rounded p-1 text-muted transition-colors hover:bg-[rgba(166,61,61,0.04)] hover:text-[#a63d3d] disabled:opacity-30"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border px-5 py-3">
          <button
            onClick={addItem}
            className="text-xs text-[#2b6055] hover:underline"
          >
            + 添加一行
          </button>
        </div>
      </div>

      {/* Calculation results preview */}
      {hasCalcResults && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">
              裁切计算结果预览
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              规则版本: {RULE_VERSION} · 仅支持 3:2 布纱比自动计算
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">位置</th>
                  <th className="px-3 py-2.5 font-medium">罩盒</th>
                  <th className="px-3 py-2.5 font-medium">38管</th>
                  <th className="px-3 py-2.5 font-medium">下杆</th>
                  <th className="px-3 py-2.5 font-medium">圆芯杆</th>
                  <th className="px-3 py-2.5 font-medium">面料宽</th>
                  <th className="px-3 py-2.5 font-medium">面料长</th>
                  <th className="px-3 py-2.5 font-medium">插片</th>
                  <th className="px-3 py-2.5 font-medium">拉绳(m)</th>
                  <th className="px-3 py-2.5 font-medium">绳套(m)</th>
                  <th className="px-3 py-2.5 font-medium">SF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item, i) => {
                  const c = item.calc;
                  if (!c) return (
                    <tr key={item.key}>
                      <td className="px-3 py-2 text-muted">{i + 1}</td>
                      <td className="px-3 py-2 text-muted" colSpan={11}>
                        未计算（请确保宽度和高度有效）
                      </td>
                    </tr>
                  );

                  const barVal =
                    item.productType === "卷帘" ? c.cutRollerBar
                    : item.productType === "斑马帘" ? c.cutZebraBar
                    : c.cutShangrilaBar;

                  return (
                    <tr key={item.key} className="hover:bg-[rgba(43,96,85,0.02)]">
                      <td className="px-3 py-2 text-muted">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-foreground/80">{item.location || "-"}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cutHeadrail)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cutTube38)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(barVal)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cutCoreRod)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cutFabricWidth)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cutFabricLength)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.insertSize)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cordLength)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(c.cordSleeveLen)}</td>
                      <td className="px-3 py-2 font-mono">{c.squareFeet.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {hasCalcResults && (
                <tfoot>
                  <tr className="border-t border-border bg-[rgba(26,36,32,0.02)] font-medium">
                    <td className="px-3 py-2" colSpan={11}>
                      总面积
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {items.reduce((sum, item) => sum + (item.calc?.squareFeet || 0), 0).toFixed(2)} SF
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[rgba(26,36,32,0.03)]"
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={calculate}
            disabled={calculating}
            className="flex items-center gap-2 rounded-lg border border-[rgba(43,96,85,0.15)] bg-[rgba(43,96,85,0.04)] px-4 py-2.5 text-sm font-medium text-[#2b6055] transition-colors hover:bg-[rgba(43,96,85,0.08)] disabled:opacity-50"
          >
            <Calculator size={16} />
            {calculating ? "计算中..." : "计算裁切"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#2b6055] px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2b6055]/90 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "保存中..." : mode === "edit" ? "更新工艺单" : "保存工艺单"}
          </button>
        </div>
      </div>
    </div>
  );
}
