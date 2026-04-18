"use client";

import { useCallback, useMemo } from "react";
import type { ShadeOrderLine, InstallMode } from "./types";
import { FRACTION_OPTIONS } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import type { ProductName } from "@/lib/blinds/pricing-types";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import { updateLineField, removeLineById, SIGNATURE_DISCLAIMER } from "./order-helpers";
import { computeShadeLinePrice, type DiscountsOverride } from "./pricing-helpers";
import { SkuSelect } from "./sku-select";

const SHADE_PRODUCTS: ProductName[] = [
  "Zebra",
  "Roller",
  "SHANGRILA",
  "Cordless Cellular",
  "SkylightHoneycomb",
];

function RadioGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? "" : opt)}
          className={cn(
            "w-7 h-7 rounded text-[10px] font-medium transition-colors",
            value === opt
              ? "bg-teal-600 text-white"
              : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

interface Props {
  lines: ShadeOrderLine[];
  onChange: (lines: ShadeOrderLine[]) => void;
  valanceType: string;
  onValanceTypeChange: (v: string) => void;
  bracketType: string;
  onBracketTypeChange: (v: string) => void;
  signatureRef: React.RefObject<PencilCanvasRef | null>;
  installMode: InstallMode;
  onSignatureChange?: (strokeCount: number) => void;
  discounts?: DiscountsOverride;
}

function emptyLine(): ShadeOrderLine {
  return {
    id: crypto.randomUUID(),
    location: "",
    widthWhole: "",
    widthFrac: "0",
    heightWhole: "",
    heightFrac: "0",
    product: "Zebra",
    sku: "",
    mount: "",
    lift: "",
    bracket: "",
    valance: "",
    note: "",
  };
}

export function OrderShadesForm({
  lines,
  onChange,
  valanceType,
  onValanceTypeChange,
  bracketType,
  onBracketTypeChange,
  signatureRef,
  installMode,
  onSignatureChange,
  discounts,
}: Props) {
  const updateLine = useCallback(
    (id: string, field: keyof ShadeOrderLine, value: unknown) => {
      onChange(updateLineField(lines, id, field, value));
    },
    [lines, onChange]
  );

  const addLine = () => onChange([...lines, emptyLine()]);

  const removeLine = (id: string) => {
    onChange(removeLineById(lines, id));
  };

  const pricings = useMemo(
    () => lines.map((l) => computeShadeLinePrice(l, installMode, discounts)),
    [lines, installMode, discounts]
  );
  const totalMerch = pricings.reduce((s, p) => s + (p?.merch ?? 0), 0);
  const totalInstall = pricings.reduce((s, p) => s + (p?.install ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">BLINDS & SHADES — ORDER FORM</h2>
          <p className="text-xs text-muted-foreground">
            Warranty: 1 year Labour, 5 years fabric, 15 years components
          </p>
        </div>
        <button
          onClick={addLine}
          className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add Row
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs min-w-[1120px]">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-2 py-2 text-left w-8">#</th>
              <th className="px-2 py-2 text-left min-w-[100px]">Location</th>
              <th className="px-2 py-2 text-center w-24">Width</th>
              <th className="px-2 py-2 text-center w-24">Height</th>
              <th className="px-2 py-2 text-left w-28">Product</th>
              <th className="px-2 py-2 text-left min-w-[180px]">SKU</th>
              <th className="px-2 py-2 text-center w-16">Mount</th>
              <th className="px-2 py-2 text-center w-24">Lift</th>
              <th className="px-2 py-2 text-center w-16">Bracket</th>
              <th className="px-2 py-2 text-left min-w-[70px]">Valance</th>
              <th className="px-2 py-2 text-left min-w-[80px]">Note</th>
              <th className="px-2 py-2 text-right w-28">Price</th>
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const p = pricings[i];
              return (
                <tr key={line.id} className="border-t border-border/50">
                  <td className="px-2 py-0.5 text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={line.location}
                      onChange={(e) => updateLine(line.id, "location", e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px] px-1"
                      placeholder="Room"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="text"
                        value={line.widthWhole}
                        onChange={(e) => updateLine(line.id, "widthWhole", e.target.value)}
                        className="w-10 bg-transparent border-0 outline-none text-xs text-center min-h-[44px]"
                        placeholder="in"
                      />
                      <select
                        value={line.widthFrac}
                        onChange={(e) => updateLine(line.id, "widthFrac", e.target.value)}
                        className="bg-transparent border-0 outline-none text-[10px]"
                      >
                        {FRACTION_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-1 py-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        type="text"
                        value={line.heightWhole}
                        onChange={(e) => updateLine(line.id, "heightWhole", e.target.value)}
                        className="w-10 bg-transparent border-0 outline-none text-xs text-center min-h-[44px]"
                        placeholder="in"
                      />
                      <select
                        value={line.heightFrac}
                        onChange={(e) => updateLine(line.id, "heightFrac", e.target.value)}
                        className="bg-transparent border-0 outline-none text-[10px]"
                      >
                        {FRACTION_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-1 py-0.5">
                    <select
                      value={line.product}
                      onChange={(e) => {
                        const newProduct = e.target.value as ProductName;
                        onChange(
                          lines.map((l) =>
                            l.id === line.id ? { ...l, product: newProduct, sku: "" } : l
                          )
                        );
                      }}
                      className="w-full bg-transparent border-0 outline-none text-[10px] min-h-[44px]"
                    >
                      {SHADE_PRODUCTS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-0.5">
                    <SkuSelect
                      product={line.product}
                      value={line.sku}
                      onChange={(v) => updateLine(line.id, "sku", v)}
                      className="w-full"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <RadioGroup
                      value={line.mount}
                      options={["I", "O"]}
                      onChange={(v) => updateLine(line.id, "mount", v)}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <RadioGroup
                      value={line.lift}
                      options={["L", "R", "M"]}
                      onChange={(v) => updateLine(line.id, "lift", v)}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <RadioGroup
                      value={line.bracket}
                      options={["C", "W"]}
                      onChange={(v) => updateLine(line.id, "bracket", v)}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={line.valance}
                      onChange={(e) => updateLine(line.id, "valance", e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px] px-1"
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={line.note}
                      onChange={(e) => updateLine(line.id, "note", e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px] px-1"
                    />
                  </td>
                  <td className="px-2 py-0.5 text-right align-middle">
                    {p?.error ? (
                      <span className="text-[9px] text-red-500" title={p.error}>
                        —
                      </span>
                    ) : p ? (
                      <div className="leading-tight">
                        <div className="font-mono text-[11px] font-semibold text-teal-700">
                          {formatCAD(p.merch)}
                        </div>
                        {installMode === "pickup" ? (
                          <div className="text-[9px] text-amber-600">Pickup</div>
                        ) : (
                          <div className="text-[9px] text-muted-foreground">
                            +Install {formatCAD(p.install)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <button
                      onClick={() => removeLine(line.id)}
                      className="p-1 text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-teal-200 bg-teal-50/30">
              <td colSpan={11} className="px-2 py-2 text-right text-xs font-medium">
                Merch Subtotal
                {installMode === "pickup" ? (
                  <span className="ml-2 text-[10px] text-amber-600">· Pickup · no install</span>
                ) : (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    · Install {formatCAD(totalInstall)}
                  </span>
                )}
                :
              </td>
              <td className="px-2 py-2 text-right font-mono text-sm font-bold text-teal-700">
                {formatCAD(totalMerch)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Options footer */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Valance Type</label>
          <div className="flex gap-2">
            {["Cassette", "Fascia"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onValanceTypeChange(valanceType === v ? "" : v)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  valanceType === v
                    ? "bg-teal-600 text-white"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Brackets Type</label>
          <div className="flex gap-2">
            {["Ceiling", "Wall"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onBracketTypeChange(bracketType === v ? "" : v)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  bracketType === v
                    ? "bg-teal-600 text-white"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PencilCanvas ref={signatureRef} width={500} height={120} label="Signature" onStrokesChange={onSignatureChange} />
      <p className="text-[9px] text-muted-foreground leading-snug">{SIGNATURE_DISCLAIMER}</p>
    </div>
  );
}
