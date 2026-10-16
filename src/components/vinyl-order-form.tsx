"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Calculator, Save, Copy, AlertCircle, AlertTriangle, Settings2,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import {
  FRAME_TYPES, FRAME_COUNTS, IN_OUT, STRUCTURES, LOUVER_SIZES, POST_TYPES,
  VINYL_RULE_VERSION,
} from "@/lib/vinyl/frame-rules";

interface PanelCodeOption {
  code: string;
  louverSize: number | null;
  strips: number;
  caps: number;
  source: "builtin" | "custom";
}

interface CalcResult {
  frameLabel: string | null;
  frameSignature: number;
  cavityWidth: number;
  cavityHeight: number;
  panelWidth: number;
  panelHeight: number;
  midRail: number;
  midRailFromBottom: number;
  topLouvers: number;
  bottomLouvers: number;
  louversPerPanel: number;
  louverPitch: number;
  postLabel: string | null;
  postCount: number;
  panelSpec: { strips: number; caps: number } | null;
  squareFeet: number;
  pieces: {
    name: string; lengthIn: number; qty: number;
    angleA: number | null; angleB: number | null;
    pitchIn?: number | null; informational?: boolean;
  }[];
  warnings: { code: string; message: string }[];
}

interface OrderItem {
  key: string;
  location: string;
  width: string;
  height: string;
  panelCount: string;
  panelCode: string;
  dividerCount: string;
  dividerType: string;      // T | H | ""
  specialMidRail: string;
  midRailRatio: string;
  tiltRodPosition: string;
  frameType: string;
  frameCount: string;
  inOut: string;
  structure: string;
  itemRemark: string;
  calc?: CalcResult;
}

interface OrderForm {
  code: string;
  customerName: string;
  phone: string;
  address: string;
  installDate: string;
  remarks: string;
  louverSize: string;
  color: string;
}

const DEFAULT_ITEM = (): OrderItem => ({
  key: crypto.randomUUID(),
  location: "", width: "", height: "",
  panelCount: "", panelCode: "",
  dividerCount: "", dividerType: "",
  specialMidRail: "", midRailRatio: "", tiltRodPosition: "",
  frameType: "L", frameCount: "4", inOut: "IN", structure: "有框",
  itemRemark: "",
});

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return String(Math.round(v * 10000) / 10000);
}

interface Props {
  initialOrder?: OrderForm;
  initialItems?: OrderItem[];
  orderId?: string;
  mode?: "create" | "edit";
  orderStatus?: string;
}

export function VinylOrderForm({
  initialOrder, initialItems, orderId, mode = "create", orderStatus,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [panelCodes, setPanelCodes] = useState<PanelCodeOption[]>([]);

  const isLocked = orderStatus === "confirmed" || orderStatus === "completed";

  const [form, setForm] = useState<OrderForm>(
    initialOrder ?? {
      code: "", customerName: "", phone: "", address: "",
      installDate: "", remarks: "", louverSize: "3.5", color: "白色",
    },
  );
  const [items, setItems] = useState<OrderItem[]>(
    initialItems?.length ? initialItems : [DEFAULT_ITEM()],
  );

  const louverSize = Number(form.louverSize) || 3.5;

  const [codeLoadError, setCodeLoadError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/vinyl/panel-codes");
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        setPanelCodes(data.codes ?? []);
        setCodeLoadError("");
      } catch (e) {
        // 不阻断录入（仍可手填），但必须说出来 ——
        // 否则下拉是空的会让人误以为"这个码不存在"
        setCodeLoadError(e instanceof Error ? e.message : "加载失败");
      }
    })();
  }, []);

  /** 当前百叶尺寸下可选的方向码 */
  const codeOptions = useMemo(() => {
    const seen = new Map<string, PanelCodeOption>();
    for (const c of panelCodes) {
      if (c.louverSize != null && c.louverSize !== louverSize) continue;
      // 尺寸专属优先于通用
      const prev = seen.get(c.code);
      if (!prev || (prev.louverSize == null && c.louverSize != null)) seen.set(c.code, c);
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [panelCodes, louverSize]);

  function updateForm(field: keyof OrderForm, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    // 百叶尺寸改了会改变所有裁切结果，旧预览必须作废
    if (field === "louverSize") {
      setItems((p) => p.map((it) => ({ ...it, calc: undefined })));
    }
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
    const next = DEFAULT_ITEM();
    if (last) {
      // 同一单里框型/结构通常一致，带过来省录入
      next.frameType = last.frameType;
      next.frameCount = last.frameCount;
      next.inOut = last.inOut;
      next.structure = last.structure;
      next.panelCode = last.panelCode;
      next.tiltRodPosition = last.tiltRodPosition;
    }
    setItems((p) => [...p, next]);
  }

  function duplicateItem(i: number) {
    setItems((p) => [
      ...p.slice(0, i + 1),
      { ...p[i], key: crypto.randomUUID(), calc: undefined },
      ...p.slice(i + 1),
    ]);
  }

  function removeItem(i: number) {
    if (items.length <= 1) return;
    setItems((p) => p.filter((_, idx) => idx !== i));
  }

  function toPayloadItems() {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    return items.map((it) => ({
      location: it.location,
      width: num(it.width) ?? 0,
      height: num(it.height) ?? 0,
      panelCount: num(it.panelCount) ?? 0,
      panelCode: it.panelCode,
      dividerSpec:
        it.dividerCount.trim() && it.dividerType
          ? `${it.dividerCount.trim()}${it.dividerType}`
          : null,
      specialMidRail: num(it.specialMidRail),
      midRailRatio: num(it.midRailRatio),
      tiltRodPosition: it.tiltRodPosition || null,
      frameType: it.frameType,
      frameCount: it.frameCount,
      inOut: it.inOut,
      structure: it.structure,
      itemRemark: it.itemRemark || null,
    }));
  }

  function validate(): { valid: boolean; msgs: string[] } {
    const errs: string[] = [];
    const warns: string[] = [];
    items.forEach((it, i) => {
      const n = i + 1;
      if (!it.location.trim()) errs.push(`#${n}: 位置未填写`);
      const w = Number(it.width);
      const h = Number(it.height);
      const pc = Number(it.panelCount);
      if (!w) errs.push(`#${n}: 宽度未填写`);
      if (!h) errs.push(`#${n}: 高度未填写`);
      if (!pc) errs.push(`#${n}: 扇数未填写`);
      if (!it.panelCode.trim()) errs.push(`#${n}: 开启状态未填写`);
      if (w && (w < 10 || w > 200)) warns.push(`#${n}: 宽度 ${w}" 超出常规范围 (10-200)`);
      if (h && (h < 10 || h > 200)) warns.push(`#${n}: 高度 ${h}" 超出常规范围 (10-200)`);
      if (it.dividerCount.trim() && !it.dividerType) {
        errs.push(`#${n}: 填了柱数就要选柱型（分隔柱 T / 挂柱 H）`);
      }
      if (it.specialMidRail.trim() && it.midRailRatio.trim()) {
        warns.push(`#${n}: 同时填了特殊分隔档与 Mid-Rail 比例，将以特殊分隔档为准`);
      }
      const ratio = Number(it.midRailRatio);
      if (it.midRailRatio.trim() && (!(ratio > 0) || ratio >= 1)) {
        errs.push(`#${n}: Mid-Rail 比例应是 0~1 之间的小数（如 0.5 表示半高）`);
      }
      // 编码表没加载出来时不做这个判断，否则会把所有码都误报成"不在表里"
      if (it.panelCode.trim() && codeOptions.length > 0 && !codeLoadError) {
        const known = codeOptions.some(
          (c) => c.code === it.panelCode.trim().toUpperCase(),
        );
        if (!known) {
          warns.push(
            `#${n}: 开启状态「${it.panelCode}」不在 ${louverSize}" 编码表里，条/盖数量会留空待补`,
          );
        }
      }
    });
    return errs.length ? { valid: false, msgs: errs } : { valid: true, msgs: warns };
  }

  const calculate = useCallback(async () => {
    setCalculating(true);
    setError("");
    try {
      const res = await apiFetch("/api/vinyl/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ louverSize, items: toPayloadItems() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "计算失败");
        return;
      }
      setItems((prev) => prev.map((it, i) => ({ ...it, calc: data.results[i] })));
    } catch {
      setError("计算请求失败");
    } finally {
      setCalculating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, louverSize]);

  async function handleSave() {
    setError("");
    setWarnings([]);
    if (!form.code.trim()) return setError("请填写订单号");
    if (!form.customerName.trim()) return setError("请填写客户名称");

    const { valid, msgs } = validate();
    if (!valid) return setError(msgs.join("；"));
    if (msgs.length) setWarnings(msgs);

    setSaving(true);
    try {
      const res = await apiFetch(
        mode === "edit" ? `/api/vinyl/orders/${orderId}` : "/api/vinyl/orders",
        {
          method: mode === "edit" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, louverSize, items: toPayloadItems() }),
        },
      );
      const data = await res.json();
      if (!res.ok) return setError(data?.error || "保存失败");
      router.push(`/vinyl-orders/${data.id}`);
    } catch {
      setError("保存请求失败");
    } finally {
      setSaving(false);
    }
  }

  const allWarnings = items.flatMap((it, i) =>
    (it.calc?.warnings ?? []).map((w) => `#${i + 1} ${it.location || ""}: ${w.message}`),
  );
  const hasCalc = items.some((it) => it.calc);

  const inputCls =
    "w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-accent";
  const cellCls = "px-2 py-1.5 align-top";

  return (
    <div className="space-y-6">
      {isLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
          <AlertTriangle size={16} className="shrink-0" />
          正在修改已确认工艺单，保存后计算结果将重新生成
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[rgba(26,36,32,0.03)] px-4 py-2 text-xs text-muted">
        <span>规则版本:</span>
        <span className="rounded bg-card-bg px-2 py-0.5 font-mono">{VINYL_RULE_VERSION}</span>
        <span>|</span>
        <span>单位: 英寸</span>
        <span>|</span>
        <Link href="/settings/vinyl-panel-codes" className="inline-flex items-center gap-1 text-accent hover:underline">
          <Settings2 size={12} /> 开启状态编码表（{codeOptions.length} 个可选码）
        </Link>
      </div>

      {codeLoadError && (
        <div className="flex items-start gap-2 rounded-lg border border-[rgba(154,106,47,0.2)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          开启状态编码表加载失败（{codeLoadError}）—— 下拉候选为空不代表这些码不存在，仍可手动输入；
          保存后请到工艺单详情确认条/盖是否算出来了。
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-[rgba(154,106,47,0.15)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-sm text-[#9a6a2f]">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {/* ── 订单头 ── */}
      <div className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="mb-4 text-base font-semibold">订单信息</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <label className="text-xs text-muted">
            订单号 *
            <input className={`${inputCls} mt-1 font-mono`} value={form.code}
              onChange={(e) => updateForm("code", e.target.value)} placeholder="G0829-01V8L120" />
          </label>
          <label className="text-xs text-muted">
            客户名称 *
            <input className={`${inputCls} mt-1`} value={form.customerName}
              onChange={(e) => updateForm("customerName", e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            电话
            <input className={`${inputCls} mt-1`} value={form.phone}
              onChange={(e) => updateForm("phone", e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            安装时间
            <input type="date" className={`${inputCls} mt-1`} value={form.installDate}
              onChange={(e) => updateForm("installDate", e.target.value)} />
          </label>
          <label className="col-span-2 text-xs text-muted">
            地址
            <input className={`${inputCls} mt-1`} value={form.address}
              onChange={(e) => updateForm("address", e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[#9a6a2f]">
            百叶尺寸 *（全单一个值）
            <select className={`${inputCls} mt-1`} value={form.louverSize}
              onChange={(e) => updateForm("louverSize", e.target.value)}>
              {LOUVER_SIZES.map((s) => <option key={s} value={s}>{s}&quot;</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            颜色
            <input className={`${inputCls} mt-1`} value={form.color}
              onChange={(e) => updateForm("color", e.target.value)} />
          </label>
          <label className="col-span-2 text-xs text-muted md:col-span-4">
            备注
            <input className={`${inputCls} mt-1`} value={form.remarks}
              onChange={(e) => updateForm("remarks", e.target.value)} />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          百叶尺寸决定片数、间距和所有下料长度，改它会作废已算出的预览。
        </p>
      </div>

      {/* ── 窗户明细 ── */}
      <div className="rounded-xl border border-border bg-card-bg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">
            窗户明细 <span className="text-sm font-normal text-muted">{items.length} 扇</span>
          </h2>
          <button onClick={addItem}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent-soft">
            <Plus size={14} /> 添加窗户
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-xs text-muted">
                <th className="px-2 py-2.5 font-medium">#</th>
                <th className="px-2 py-2.5 font-medium">位置 *</th>
                <th className="px-2 py-2.5 font-medium">宽 *</th>
                <th className="px-2 py-2.5 font-medium">高 *</th>
                <th className="px-2 py-2.5 font-medium">扇数 *</th>
                <th className="px-2 py-2.5 font-medium">开启状态 *</th>
                <th className="px-2 py-2.5 font-medium">分隔柱</th>
                <th className="px-2 py-2.5 font-medium">分隔档</th>
                <th className="px-2 py-2.5 font-medium">控制杆</th>
                <th className="px-2 py-2.5 font-medium">外框</th>
                <th className="px-2 py-2.5 font-medium">框数</th>
                <th className="px-2 py-2.5 font-medium">IN/OUT</th>
                <th className="px-2 py-2.5 font-medium">结构</th>
                <th className="px-2 py-2.5 font-medium">备注</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it, i) => (
                <tr key={it.key} className="hover:bg-[rgba(43,96,85,0.02)]">
                  <td className={`${cellCls} pt-3 text-muted`}>{i + 1}</td>
                  <td className={`${cellCls} min-w-[110px]`}>
                    <input className={inputCls} value={it.location}
                      onChange={(e) => updateItem(i, "location", e.target.value)} placeholder="客厅" />
                  </td>
                  <td className={`${cellCls} w-[78px]`}>
                    <input className={`${inputCls} font-mono`} value={it.width} inputMode="decimal"
                      onChange={(e) => updateItem(i, "width", e.target.value)} />
                  </td>
                  <td className={`${cellCls} w-[78px]`}>
                    <input className={`${inputCls} font-mono`} value={it.height} inputMode="decimal"
                      onChange={(e) => updateItem(i, "height", e.target.value)} />
                  </td>
                  <td className={`${cellCls} w-[64px]`}>
                    <input className={`${inputCls} font-mono`} value={it.panelCount} inputMode="numeric"
                      onChange={(e) => updateItem(i, "panelCount", e.target.value)} />
                  </td>
                  <td className={`${cellCls} w-[112px]`}>
                    <input className={`${inputCls} font-mono uppercase`} value={it.panelCode}
                      list={`vinyl-codes-${louverSize}`}
                      onChange={(e) => updateItem(i, "panelCode", e.target.value.toUpperCase())}
                      placeholder="LLRR" />
                  </td>
                  <td className={`${cellCls} w-[104px]`}>
                    <div className="flex gap-1">
                      <input className={`${inputCls} font-mono`} value={it.dividerCount} inputMode="numeric"
                        onChange={(e) => updateItem(i, "dividerCount", e.target.value)} placeholder="0" />
                      <select className={inputCls} value={it.dividerType}
                        onChange={(e) => updateItem(i, "dividerType", e.target.value)}>
                        <option value="">—</option>
                        {POST_TYPES.map((t) => (
                          <option key={t} value={t}>{t === "T" ? "分隔柱" : "挂柱"}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className={`${cellCls} w-[128px]`}>
                    <div className="flex gap-1">
                      <input className={`${inputCls} font-mono`} value={it.specialMidRail} inputMode="decimal"
                        onChange={(e) => updateItem(i, "specialMidRail", e.target.value)} placeholder="绝对″" />
                      <input className={`${inputCls} font-mono`} value={it.midRailRatio} inputMode="decimal"
                        onChange={(e) => updateItem(i, "midRailRatio", e.target.value)} placeholder="比例" />
                    </div>
                  </td>
                  <td className={`${cellCls} w-[80px]`}>
                    <input className={inputCls} value={it.tiltRodPosition}
                      onChange={(e) => updateItem(i, "tiltRodPosition", e.target.value)} />
                  </td>
                  <td className={`${cellCls} w-[84px]`}>
                    <select className={inputCls} value={it.frameType}
                      onChange={(e) => updateItem(i, "frameType", e.target.value)}>
                      {FRAME_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className={`${cellCls} w-[76px]`}>
                    <select className={inputCls} value={it.frameCount}
                      onChange={(e) => updateItem(i, "frameCount", e.target.value)}>
                      {FRAME_COUNTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className={`${cellCls} w-[78px]`}>
                    <select className={inputCls} value={it.inOut}
                      onChange={(e) => updateItem(i, "inOut", e.target.value)}>
                      {IN_OUT.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className={`${cellCls} w-[80px]`}>
                    <select className={inputCls} value={it.structure}
                      onChange={(e) => updateItem(i, "structure", e.target.value)}>
                      {STRUCTURES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className={`${cellCls} min-w-[90px]`}>
                    <input className={inputCls} value={it.itemRemark}
                      onChange={(e) => updateItem(i, "itemRemark", e.target.value)} />
                  </td>
                  <td className={`${cellCls} whitespace-nowrap pt-3`}>
                    <button onClick={() => duplicateItem(i)} title="复制此行"
                      className="text-muted hover:text-accent"><Copy size={14} /></button>
                    <button onClick={() => removeItem(i)} title="删除此行" disabled={items.length <= 1}
                      className="ml-2 text-muted hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <datalist id={`vinyl-codes-${louverSize}`}>
          {codeOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.strips}/{c.caps}{c.source === "custom" ? " · 自定义" : ""}
            </option>
          ))}
        </datalist>

        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted">
          <span>分隔档两格：左=特殊分隔档（绝对英寸，优先），右=Mid-Rail 比例（0~1）</span>
          <span>分隔柱格式：数量 + 柱型，如 2 分隔柱 → 2T</span>
        </div>
      </div>

      {/* ── 计算预览 ── */}
      <div className="flex items-center gap-3">
        <button onClick={calculate} disabled={calculating}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent-soft disabled:opacity-40">
          <Calculator size={15} /> {calculating ? "计算中…" : "试算裁切尺寸"}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent/90 disabled:opacity-40">
          <Save size={15} /> {saving ? "保存中…" : mode === "edit" ? "保存修改" : "创建工艺单"}
        </button>
      </div>

      {allWarnings.length > 0 && (
        <div className="rounded-xl border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.03)] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
            <AlertCircle size={15} /> 待人工确认 {allWarnings.length} 项
          </h3>
          <ul className="space-y-1 text-xs text-danger/90">
            {allWarnings.map((w, i) => <li key={i}>· {w}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">
            这些项不会按 0 处理；导出的工艺单表尾会一并列出，等人补齐再下料。
          </p>
        </div>
      )}

      {hasCalc && (
        <div className="space-y-4">
          {items.map((it, i) =>
            it.calc ? (
              <div key={it.key} className="rounded-xl border border-border bg-card-bg">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-3 text-xs">
                  <span className="text-sm font-semibold">#{i + 1} {it.location || "(未命名)"}</span>
                  <span className={it.calc.frameLabel ? "text-muted" : "text-danger"}>
                    {it.calc.frameLabel ?? `外框组合无规则 (J10=${it.calc.frameSignature})`}
                  </span>
                  <span className="text-muted">
                    内空 <b className="font-mono">{fmt(it.calc.cavityWidth)}×{fmt(it.calc.cavityHeight)}</b>
                  </span>
                  <span className="text-muted">
                    成品 <b className="font-mono">{fmt(it.calc.panelWidth)}×{fmt(it.calc.panelHeight)}</b>
                  </span>
                  <span className="text-muted">
                    百叶 上{it.calc.topLouvers}/下{it.calc.bottomLouvers} · 间距 <b className="font-mono">{fmt(it.calc.louverPitch)}</b>
                  </span>
                  {it.calc.midRail > 0 && (
                    <span className="text-muted">
                      分隔档 <b className="font-mono">{fmt(it.calc.midRail)}</b>（从下往上 {fmt(it.calc.midRailFromBottom)}）
                    </span>
                  )}
                  <span className="text-muted">
                    条/盖 {it.calc.panelSpec ? `${it.calc.panelSpec.strips}/${it.calc.panelSpec.caps}` : <b className="text-danger">待补</b>}
                  </span>
                  <span className="text-muted">SF {it.calc.squareFeet}</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-muted">
                      <th className="px-5 py-2 font-medium">品名</th>
                      <th className="px-3 py-2 font-medium">长度(in)</th>
                      <th className="px-3 py-2 font-medium">数量</th>
                      <th className="px-3 py-2 font-medium">角度</th>
                      <th className="px-3 py-2 font-medium">孔距</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {it.calc.pieces.map((p, k) => (
                      <tr key={k} className={p.informational ? "text-muted/70" : ""}>
                        <td className="px-5 py-1.5">
                          {p.name}
                          {p.informational && <span className="ml-1.5 text-[10px]">参考料长，不计入物料</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono">{fmt(p.lengthIn)}</td>
                        <td className="px-3 py-1.5 font-mono">{p.qty}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {p.angleA == null ? "-" : `${p.angleA}° / ${p.angleB}°`}
                        </td>
                        <td className="px-3 py-1.5 font-mono">{p.pitchIn ? fmt(p.pitchIn) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

export type { OrderItem as VinylFormItem, OrderForm as VinylFormOrder };
export { DEFAULT_ITEM as defaultVinylItem };
