"use client";

import { Plus, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { LINE_CATEGORY_LABELS, type QuoteLineItemData, type LineCategory } from "@/lib/quote/types";
import { calculateLineTotalPrice } from "@/lib/quote/calculate";

interface Props {
  lines: QuoteLineItemData[];
  onChange: (lines: QuoteLineItemData[]) => void;
  disabled?: boolean;
}

const CATEGORIES = Object.entries(LINE_CATEGORY_LABELS) as [LineCategory, string][];

function emptyLine(sortOrder: number): QuoteLineItemData {
  return {
    sortOrder,
    category: "product",
    itemName: "",
    specification: "",
    unit: "",
    quantity: null,
    unitPrice: null,
    totalPrice: null,
    remarks: "",
    costPrice: null,
    isInternal: false,
  };
}

export function QuoteLineTable({ lines, onChange, disabled }: Props) {
  function updateLine(idx: number, patch: Partial<QuoteLineItemData>) {
    const updated = lines.map((l, i) => {
      if (i !== idx) return l;
      const merged = { ...l, ...patch };
      if ("quantity" in patch || "unitPrice" in patch) {
        merged.totalPrice = calculateLineTotalPrice(merged.quantity, merged.unitPrice);
      }
      return merged;
    });
    onChange(updated);
  }

  function addLine() {
    onChange([...lines, emptyLine(lines.length)]);
  }

  function insertLine(category: LineCategory, itemName: string) {
    const newLine = emptyLine(lines.length);
    newLine.category = category;
    newLine.itemName = itemName;
    onChange([...lines, newLine]);
  }

  function removeLine(idx: number) {
    onChange(lines.filter((_, i) => i !== idx).map((l, i) => ({ ...l, sortOrder: i })));
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="border-b border-border/40 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">行项目</h3>
          <span className="text-xs text-muted">{lines.length} 项</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border/40 bg-muted/5 text-[11px] font-medium text-muted">
              <th className="w-8 px-2 py-2" />
              <th className="w-8 px-1 py-2 text-center">#</th>
              <th className="w-24 px-2 py-2 text-left">类型</th>
              <th className="min-w-[140px] px-2 py-2 text-left">品名</th>
              <th className="min-w-[100px] px-2 py-2 text-left">规格</th>
              <th className="w-16 px-2 py-2 text-left">单位</th>
              <th className="w-20 px-2 py-2 text-right">数量</th>
              <th className="w-24 px-2 py-2 text-right">单价</th>
              <th className="w-24 px-2 py-2 text-right">总价</th>
              <th className="w-24 px-2 py-2 text-right text-accent/60">成本价</th>
              <th className="min-w-[80px] px-2 py-2 text-left">备注</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={12} className="py-8 text-center">
                  <div className="text-xs text-muted">
                    暂无行项目 · 可手动添加或使用右侧 AI 生成草稿
                  </div>
                </td>
              </tr>
            )}
            {lines.map((line, idx) => (
              <tr key={idx} className="border-b border-border/30 hover:bg-muted/5">
                <td className="px-1 py-1.5 text-center">
                  <GripVertical size={12} className="mx-auto text-muted/40" />
                </td>
                <td className="px-1 py-1.5 text-center text-xs text-muted">{idx + 1}</td>
                <td className="px-1 py-1.5">
                  <select
                    value={line.category}
                    onChange={(e) => updateLine(idx, { category: e.target.value as LineCategory })}
                    disabled={disabled}
                    className="w-full rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px] outline-none focus:border-accent"
                  >
                    {CATEGORIES.map(([val, lab]) => (
                      <option key={val} value={val}>{lab}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1.5">
                  <CellInput
                    value={line.itemName}
                    onChange={(v) => updateLine(idx, { itemName: v })}
                    disabled={disabled}
                    placeholder="品名"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <CellInput
                    value={line.specification}
                    onChange={(v) => updateLine(idx, { specification: v })}
                    disabled={disabled}
                    placeholder="规格"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <CellInput
                    value={line.unit}
                    onChange={(v) => updateLine(idx, { unit: v })}
                    disabled={disabled}
                    placeholder="单位"
                    className="w-14"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <NumInput
                    value={line.quantity}
                    onChange={(v) => updateLine(idx, { quantity: v })}
                    disabled={disabled}
                  />
                </td>
                <td className="px-1 py-1.5">
                  <NumInput
                    value={line.unitPrice}
                    onChange={(v) => updateLine(idx, { unitPrice: v })}
                    disabled={disabled}
                  />
                </td>
                <td className="px-1 py-1.5">
                  <div className="text-right text-[13px] font-medium tabular-nums">
                    {line.totalPrice != null ? formatNum(line.totalPrice) : "—"}
                  </div>
                </td>
                <td className="px-1 py-1.5">
                  <NumInput
                    value={line.costPrice}
                    onChange={(v) => updateLine(idx, { costPrice: v })}
                    disabled={disabled}
                    className="text-accent/70"
                  />
                </td>
                <td className="px-1 py-1.5">
                  <CellInput
                    value={line.remarks}
                    onChange={(v) => updateLine(idx, { remarks: v })}
                    disabled={disabled}
                    placeholder=""
                  />
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={disabled}
                    className="rounded p-1 text-muted hover:bg-[rgba(166,61,61,0.08)] hover:text-[#a63d3d] disabled:opacity-30"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!disabled && (
        <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2">
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10"
          >
            <Plus size={12} />
            添加行
          </button>
        </div>
      )}
    </div>
  );
}

// Re-export for AI panel to call
export { emptyLine as createEmptyLine };

function CellInput({
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={cn(
        "w-full rounded border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none",
        "hover:border-border/60 focus:border-accent focus:bg-background",
        "transition-colors border",
        className
      )}
    />
  );
}

function NumInput({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      className={cn(
        "w-full rounded border-transparent bg-transparent px-1 py-0.5 text-right text-[13px] tabular-nums outline-none",
        "hover:border-border/60 focus:border-accent focus:bg-background",
        "transition-colors border",
        className
      )}
      step="any"
      min="0"
    />
  );
}

function formatNum(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
