"use client";

/**
 * 工艺单详情：来源报价 / 待核对 / 国内下单 / 窗帘 / Vinyl / 外采购
 * 参数存于 /api/blinds-orders/[id]/spec（AuditLog 版本化）；计算用与导出相同的纯函数实时重算。
 */

import { useState, type ReactNode } from "react";
import { AlertTriangle, Info, Plus, Trash2 } from "lucide-react";
import { computeDomesticRow, DOMESTIC_CONTROLS, DOMESTIC_MEASURES, DOMESTIC_MOUNTS, DOMESTIC_PRODUCTS, DOMESTIC_SIDES } from "@/lib/sunny-process/domestic-calc";
import {
  computeDrapeRow,
  DRAPE_CRAFTS,
  DRAPE_LAYERS,
  DRAPE_LINERS,
  DRAPE_MOUNTS,
  DRAPE_ROD_COLORS,
  DRAPE_RODS,
  DRAPE_VERSIONS,
  totalDrapeMaterials,
  type DrapeVersion,
} from "@/lib/sunny-process/drapes-calc";
import { SECTION_LABEL_ZH, cuttableVinylLines, vinylHeaderOf, type ProcessIssue } from "@/lib/sunny-process/issues";
import { canReturnToInHouse } from "@/lib/sunny-process/line-moves";
import type { DomesticSpecRow, DrapeSpecRow, ProcessSpec, PurchaseLine, VinylSpecWindow } from "@/lib/sunny-process/process-spec";
import {
  buildVinylCutList,
  computeVinylWindow,
  VINYL_FRAMES,
  VINYL_IN_OUT,
  VINYL_LOUVER_SIZES,
  VINYL_POSTS,
  VINYL_RODS,
  VINYL_SPLITS,
  VINYL_STRUCTURES,
} from "@/lib/sunny-process/vinyl-calc";
import { sixteenthsText } from "@/lib/sunny-process/excel-fns";

// ── 通用可编辑表格 ──

type ColType = "text" | "number" | "select";
interface Col<T> {
  key: keyof T & string;
  label: string;
  type: ColType;
  options?: readonly (string | number)[];
  width?: string;
}

const inputCls = "w-full rounded border border-border bg-transparent px-1.5 py-1 text-xs outline-none focus:border-accent disabled:opacity-60";

function EditCell<T extends object>({ col, row, onChange, disabled }: { col: Col<T>; row: T; onChange: (v: unknown) => void; disabled: boolean }) {
  const v = (row as Record<string, unknown>)[col.key];
  if (col.type === "select") {
    return (
      <select className={inputCls} value={v == null ? "" : String(v)} disabled={disabled} onChange={(e) => {
        const raw = e.target.value;
        const opt = col.options?.find((o) => String(o) === raw);
        onChange(opt === undefined ? raw : opt);
      }}>
        <option value="">—</option>
        {col.options?.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  }
  if (col.type === "number") return <NumberInput value={v} disabled={disabled} onCommit={onChange} />;
  return <input className={inputCls} disabled={disabled} value={v == null ? "" : String(v)} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * 数字输入：编辑中保留原始文本（"1."、"0.0" 这类中间态不被 Number() 吞掉小数点），
 * 文本是完整数字时才回写数值；失焦时以文本为准（非法 / 空 → null，由待核对拦下）。
 */
function NumberInput({ value, disabled, onCommit }: { value: unknown; disabled: boolean; onCommit: (v: number | null) => void }) {
  const external = value == null ? "" : String(value);
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (t: string): number | null | undefined => {
    const x = t.trim();
    if (x === "") return null;
    return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : undefined;
  };
  return (
    <input
      className={inputCls}
      disabled={disabled}
      inputMode="decimal"
      value={draft ?? external}
      onFocus={() => setDraft(external)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n !== undefined) onCommit(n);
      }}
      onBlur={() => {
        if (draft !== null) {
          const n = parse(draft);
          onCommit(n === undefined ? null : n);
        }
        setDraft(null);
      }}
    />
  );
}

function issueMarks(issues: ProcessIssue[], section: ProcessIssue["section"], line: number) {
  const mine = issues.filter((i) => i.section === section && i.line === line);
  if (mine.length === 0) return null;
  const blocked = mine.some((i) => i.level === "block");
  return (
    <span title={mine.map((i) => i.messageZh).join("\n")} className={blocked ? "text-danger" : "text-[#9a6a2f]"}>
      {blocked ? <AlertTriangle size={13} /> : <Info size={13} />}
    </span>
  );
}

function EditableTable<T extends object>({
  rows, cols, onChange, editable, issues, section, results, resultCols, newRow, rowAction, wrapResults,
}: {
  rows: T[];
  cols: Col<T>[];
  onChange: (rows: T[]) => void;
  editable: boolean;
  issues: ProcessIssue[];
  section: ProcessIssue["section"];
  results?: (string | number | null)[][];
  resultCols?: string[];
  newRow?: () => T;
  /** 行尾额外操作（如「退回自产」） */
  rowAction?: (row: T, index: number) => ReactNode;
  /** 结果列为长文本时换行显示（外采购的销售填写原值） */
  wrapResults?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card-bg shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
              <th className="px-2 py-2 font-medium">#</th>
              {editable && rowAction && <th className="px-2 py-2" />}
              {cols.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium" style={{ minWidth: c.width ?? (c.type === "select" ? "92px" : undefined) }}>{c.label}</th>
              ))}
              {resultCols?.map((c) => <th key={c} className="whitespace-nowrap bg-[rgba(43,96,85,0.04)] px-2 py-2 font-medium text-accent">{c}</th>)}
              {editable && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1 text-muted"><span className="flex items-center gap-1">{i + 1}{issueMarks(issues, section, i + 1)}</span></td>
                {editable && rowAction && <td className="whitespace-nowrap px-1 py-1">{rowAction(row, i)}</td>}
                {cols.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    <EditCell col={c} row={row} disabled={!editable} onChange={(v) => onChange(rows.map((r, k) => (k === i ? ({ ...r, [c.key]: v } as T) : r)))} />
                  </td>
                ))}
                {results?.[i]?.map((v, k) => (
                  <td key={k} className={`${wrapResults ? "min-w-[220px] max-w-[420px] whitespace-normal break-words" : "whitespace-nowrap font-mono"} bg-[rgba(43,96,85,0.02)] px-2 py-1 text-foreground/80`}>{v ?? "-"}</td>
                ))}
                {editable && (
                  <td className="px-1 py-1">
                    <button type="button" className="text-muted hover:text-danger" title="删除此行" onClick={() => onChange(rows.filter((_, k) => k !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && newRow && (
        <button type="button" onClick={() => onChange([...rows, newRow()])} className="flex w-full items-center justify-center gap-1 border-t border-border py-2 text-xs text-accent hover:bg-accent-soft">
          <Plus size={13} /> 添加一行
        </button>
      )}
    </div>
  );
}

const num = (v: number, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : "错误");

// ── 待核对 / 来源 ──

export function SourceBanner({ spec }: { spec: ProcessSpec | null }) {
  if (!spec?.source) return null;
  const s = spec.source;
  return (
    <div className="rounded-lg border border-border bg-[rgba(43,96,85,0.03)] px-4 py-2 text-xs text-muted">
      来源报价 <span className="font-mono text-foreground/80">{s.orderNumber || s.quoteId}</span>
      {s.signedAt ? ` · 客户签字 ${new Date(s.signedAt).toLocaleString("zh-CN", { timeZone: "America/Toronto" })}` : ""}
      {` · 工艺参数 v${spec.version}`}
    </div>
  );
}

export function IssuesPanel({ issues }: { issues: ProcessIssue[] }) {
  if (issues.length === 0) {
    return <div className="rounded-lg border border-border bg-card-bg px-4 py-2 text-xs text-[#2e7a56]">待核对：无</div>;
  }
  const blocks = issues.filter((i) => i.level === "block");
  const infos = issues.filter((i) => i.level === "info");
  const line = (i: ProcessIssue, k: number) => (
    <li key={k} className="flex gap-2">
      <span className="shrink-0 text-muted">{SECTION_LABEL_ZH[i.section]}{i.line ? ` #${i.line}` : ""}</span>
      <span>{i.messageZh}</span>
    </li>
  );
  return (
    <div className="space-y-2">
      {blocks.length > 0 && (
        <div className="rounded-lg border border-[rgba(166,61,61,0.25)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-xs text-danger">
          <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> 阻断 {blocks.length} 项（清零后才能确认工艺单）</div>
          <ul className="space-y-0.5">{blocks.map(line)}</ul>
        </div>
      )}
      {infos.length > 0 && (
        <details className="rounded-lg border border-[rgba(154,106,47,0.2)] bg-[rgba(154,106,47,0.04)] px-4 py-3 text-xs text-[#9a6a2f]">
          <summary className="cursor-pointer font-semibold">提示 {infos.length} 项（报价单默认推导，请核对）</summary>
          <ul className="mt-1 space-y-0.5">{infos.map(line)}</ul>
        </details>
      )}
    </div>
  );
}

// ── 国内下单 ──

const DOMESTIC_COLS: Col<DomesticSpecRow>[] = [
  { key: "code", label: "编号/位置", type: "text", width: "110px" },
  { key: "widthIn", label: "宽(in)", type: "number", width: "60px" },
  { key: "heightIn", label: "高(in)", type: "number", width: "60px" },
  { key: "productType", label: "产品", type: "select", options: DOMESTIC_PRODUCTS },
  { key: "sku", label: "货号", type: "text", width: "110px" },
  { key: "measure", label: "测量", type: "select", options: DOMESTIC_MEASURES },
  { key: "control", label: "操控", type: "select", options: DOMESTIC_CONTROLS },
  { key: "side", label: "拉杆", type: "select", options: DOMESTIC_SIDES },
  { key: "headrail", label: "罩盒", type: "text", width: "100px" },
  { key: "mount", label: "安装", type: "select", options: DOMESTIC_MOUNTS },
  { key: "remark", label: "备注", type: "text", width: "120px" },
];

export function DomesticSection({ spec, onChange, editable, issues, onReturnInHouse }: SectionProps & { onReturnInHouse?: (line: number) => void }) {
  const results = spec.domestic.map((d) => {
    const r = computeDomesticRow(d);
    return [num(r.widthCm, 2), num(r.heightCm, 2), num(r.sqm, 3)];
  });
  return (
    <EditableTable
      rows={spec.domestic} cols={DOMESTIC_COLS} editable={editable} issues={issues} section="domestic"
      onChange={(domestic) => onChange({ ...spec, domestic })}
      results={results} resultCols={["宽(cm)", "高(cm)", "平方(㎡)"]}
      rowAction={onReturnInHouse ? (row, i) => (canReturnToInHouse(row)
        ? <button type="button" className="text-xs text-accent hover:underline" title="移回 Blinds 自产行（按自产工艺计算）" onClick={() => onReturnInHouse(i + 1)}>退回自产</button>
        : null) : undefined}
      newRow={(): DomesticSpecRow => ({ location: "", code: "", widthIn: 0, heightIn: 0, productType: "蜂窝帘", sku: "", measure: "内装", control: "普通", side: "左", headrail: "", mount: "顶装", remark: "", quoteProduct: "" })}
    />
  );
}

// ── 窗帘 ──

const DRAPE_COLS: Col<DrapeSpecRow>[] = [
  { key: "location", label: "位置", type: "text", width: "90px" },
  { key: "widthIn", label: "宽(in)", type: "number", width: "60px" },
  { key: "heightIn", label: "高(in)", type: "number", width: "60px" },
  { key: "sku", label: "色号", type: "text", width: "70px" },
  { key: "qty", label: "数量", type: "number", width: "44px" },
  { key: "craft", label: "工艺", type: "select", options: DRAPE_CRAFTS },
  { key: "layer", label: "布/纱", type: "select", options: DRAPE_LAYERS },
  { key: "liner", label: "遮光底布", type: "select", options: DRAPE_LINERS },
  { key: "fullness", label: "倍数", type: "number", width: "48px" },
  { key: "mount", label: "安装", type: "select", options: DRAPE_MOUNTS },
  { key: "rod", label: "杆型", type: "select", options: DRAPE_RODS },
  { key: "rodColor", label: "杆色", type: "select", options: DRAPE_ROD_COLORS },
];

export function DrapesSection({ spec, onChange, editable, issues }: SectionProps) {
  const version = spec.settings.drapeVersion;
  const computed = spec.drapes.map((d) => computeDrapeRow(d, version));
  const tot = totalDrapeMaterials(computed);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">蛇形帘版本</span>
        {DRAPE_VERSIONS.map((v) => (
          <button key={v} type="button" disabled={!editable}
            onClick={() => onChange({ ...spec, settings: { ...spec.settings, drapeVersion: v as DrapeVersion } })}
            className={`rounded px-2.5 py-1 ${version === v ? "bg-accent text-[color:var(--on-accent)]" : "border border-border text-muted"}`}>{v}</button>
        ))}
      </div>
      <EditableTable
        rows={spec.drapes} cols={DRAPE_COLS} editable={editable} issues={issues} section="drapes"
        onChange={(drapes) => onChange({ ...spec, drapes })}
        results={computed.map((r) => [r.widthCm, r.heightCm, r.pleatTopCm || null, r.finishedWidthCm, r.finishedHeightCm, r.beadBagCount || null, r.beadClip])}
        resultCols={["宽cm", "成品高cm", "韩褶上端cm", "成品宽cm/扇", "成品帘高cm(−2)", "走珠布袋/扇", "走珠扣"]}
        newRow={(): DrapeSpecRow => ({ location: "", part: "drape", widthIn: 0, heightIn: 0, sku: "", qty: 1, craft: "蛇型R", layer: "布", liner: "否", fullness: 1.8, mount: "顶装C", rod: "", rodColor: "" })}
      />
      <div className="text-xs text-muted">
        物料合计：杆子 {num(tot.rodM, 2)} 米（含 20%）· 布料 {num(tot.fabricSqm, 2)} ㎡（含 30%）· 走珠布袋 {num(tot.beadBagM, 2)} 米 · 安装码 {tot.hooks} 个 · 韩褶走珠 {tot.pleatBeads} 个
      </div>
    </div>
  );
}

// ── Vinyl ──

const VINYL_COLS: Col<VinylSpecWindow>[] = [
  { key: "location", label: "位置", type: "text", width: "80px" },
  { key: "width", label: "宽", type: "number", width: "56px" },
  { key: "height", label: "高", type: "number", width: "56px" },
  { key: "panels", label: "扇数", type: "number", width: "40px" },
  { key: "openCode", label: "开合编码", type: "text", width: "80px" },
  { key: "posts", label: "分隔柱", type: "select", options: VINYL_POSTS },
  { key: "rail1In", label: "第一档(in)", type: "number", width: "56px" },
  { key: "rail1Ratio", label: "第一档比例", type: "number", width: "56px" },
  { key: "rail2In", label: "第二档(in)", type: "number", width: "56px" },
  { key: "rod", label: "控制杆", type: "select", options: VINYL_RODS },
  { key: "split", label: "切分", type: "select", options: VINYL_SPLITS },
  { key: "frame", label: "外框", type: "select", options: VINYL_FRAMES },
  { key: "frameCount", label: "外框数", type: "select", options: [4, "3+1"] as const },
  { key: "inOut", label: "IN/OUT", type: "select", options: VINYL_IN_OUT },
  { key: "structure", label: "结构", type: "select", options: VINYL_STRUCTURES },
];

export function VinylSection({ spec, onChange, editable, issues, orderCode }: SectionProps & { orderCode: string }) {
  const header = vinylHeaderOf(spec, orderCode);
  const computed = spec.vinyl.map((w, k) => ({ input: w, result: computeVinylWindow(w, header), windowNo: k + 1 }));
  const cuttable = cuttableVinylLines(spec, issues);
  const cut = buildVinylCutList(computed.filter((c) => cuttable.has(c.windowNo)), header, { includePosts: true });
  const excluded = computed.length - cuttable.size;
  const sv = spec.settings.vinyl;
  const setV = (patch: Partial<ProcessSpec["settings"]["vinyl"]>) => onChange({ ...spec, settings: { ...spec.settings, vinyl: { ...sv, ...patch } } });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1 text-muted">百叶尺寸
          <select className={inputCls} disabled={!editable} value={sv.louver ?? ""} onChange={(e) => setV({ louver: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {VINYL_LOUVER_SIZES.map((v) => <option key={v} value={v}>{v}&quot;</option>)}
          </select>
        </label>
        {sv.louverQuote && <span className="text-muted">报价：{sv.louverQuote}</span>}
        <label className="flex items-center gap-1 text-muted">颜色 <input className={inputCls} disabled={!editable} value={sv.color} onChange={(e) => setV({ color: e.target.value })} /></label>
        <label className="flex items-center gap-1 text-muted">默认控制杆
          <select className={inputCls} disabled={!editable} value={sv.defaultRod} onChange={(e) => setV({ defaultRod: e.target.value })}>
            <option value="">—</option>
            {VINYL_RODS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>
      <EditableTable
        rows={spec.vinyl} cols={VINYL_COLS} editable={editable} issues={issues} section="vinyl"
        onChange={(vinyl) => onChange({ ...spec, vinyl })}
        results={computed.map(({ result: r }, k) => {
          // 有阻断的窗不显示计算值（原件此时也只会算出 0 / 负数）
          if (issues.some((i) => i.section === "vinyl" && i.line === k + 1 && i.level === "block")) return ["-", "-", "-", "-", "-"];
          return [
            `${num(r.innerWidth)}×${num(r.innerHeight)}`,
            `${num(r.panelWidth)}×${num(r.panelHeight)}`,
            Number.isFinite(r.louverTotal) ? `${r.louverUpper}/${r.louverLower}${r.rail2 ? `/${r.louverMiddle}` : ""}` : "错误",
            num(r.pitch),
            r.openKey === 0 ? "-" : r.openKey,
          ];
        })}
        resultCols={["内空宽×高", "扇宽×高", "百叶 上/下(/中)", "孔距", "开启代码"]}
        newRow={(): VinylSpecWindow => ({ location: "", width: 0, height: 0, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "不切分", frame: "L", frameCount: 4, inOut: "IN", structure: "有框", rail2In: null, quoteFrame: "", quoteOpenDirection: "", quoteMidRail: "" })}
      />
      {cut.length > 0 && (
        <details className="rounded-xl border border-border bg-card-bg px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground/80">
            下料总表（{cut.length} 行，合计 {cut.reduce((s, c) => s + c.qty, 0)} 件{excluded > 0 ? `；${excluded} 窗有阻断未计入` : ""}）
          </summary>
          <table className="mt-2 w-full">
            <thead><tr className="text-left text-muted"><th>顺序</th><th>料型</th><th>规格</th><th>长度</th><th>数量</th><th>端头</th><th>窗号×数量</th></tr></thead>
            <tbody>
              {cut.map((c) => (
                <tr key={c.seq} className="border-t border-border/50">
                  <td>{c.seq}</td><td>{c.type}</td><td>{c.spec}</td><td className="font-mono">{sixteenthsText(c.length)}</td><td>{c.qty}</td><td>{c.ends}</td><td className="text-muted">{c.windows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

// ── 外采购 ──

const PURCHASE_COLS: Col<PurchaseLine>[] = [
  { key: "categoryZh", label: "品类", type: "text", width: "150px" },
  { key: "location", label: "位置", type: "text", width: "100px" },
  { key: "widthIn", label: "宽(in)", type: "number", width: "60px" },
  { key: "heightIn", label: "高(in)", type: "number", width: "60px" },
  { key: "qty", label: "数量", type: "number", width: "44px" },
  { key: "remark", label: "备注", type: "text", width: "140px" },
];

/** 外采购行：按销售在报价单上写的原样生成，不做工艺计算、不阻断确认 */
export function PurchaseSection({ spec, onChange, editable, issues }: SectionProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Wooden 百叶（含 S/G/M/Casing 外框）、打孔窗帘、4-1/2&quot; / Arch 百叶和没有工艺模板的帘子按销售填写原样列出，导出为「外采购单」，交外采购下单。</p>
      <EditableTable
        rows={spec.purchase} cols={PURCHASE_COLS} editable={editable} issues={issues} section="purchase"
        onChange={(purchase) => onChange({ ...spec, purchase })}
        results={spec.purchase.map((p) => [p.fields.map((f) => `${f.label}: ${f.value}`).join("；") || null, p.reasonZh || null])}
        resultCols={["销售填写（报价原值）", "外采购原因"]}
        wrapResults
        newRow={(): PurchaseLine => ({ section: "shutter", categoryZh: "", location: "", widthIn: 0, heightIn: 0, qty: 1, fields: [], reasonZh: "工厂手工添加", remark: "" })}
      />
    </div>
  );
}

export interface SectionProps {
  spec: ProcessSpec;
  onChange: (spec: ProcessSpec) => void;
  editable: boolean;
  issues: ProcessIssue[];
}
