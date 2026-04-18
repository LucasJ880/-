"use client";

import { useCallback, useMemo } from "react";
import type { ShutterOrderLine, InstallMode } from "./types";
import { FRACTION_OPTIONS } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import { updateLineField, removeLineById, SIGNATURE_DISCLAIMER } from "./order-helpers";
import { computeShutterLinePrice } from "./pricing-helpers";

interface Props {
  lines: ShutterOrderLine[];
  onChange: (lines: ShutterOrderLine[]) => void;
  material: "Wooden" | "Vinyl";
  onMaterialChange: (v: "Wooden" | "Vinyl") => void;
  louverSize: string;
  onLouverSizeChange: (v: string) => void;
  signatureRef: React.RefObject<PencilCanvasRef | null>;
  installMode: InstallMode;
  onSignatureChange?: (strokeCount: number) => void;
}

function emptyLine(): ShutterOrderLine {
  return {
    id: crypto.randomUUID(),
    location: "",
    widthWhole: "",
    widthFrac: "0",
    heightWhole: "",
    heightFrac: "0",
    frame: "",
    openDirection: "",
    mountType: "",
    midRail: false,
    panelCount: null,
    draft: "",
  };
}

export function OrderShuttersForm({
  lines,
  onChange,
  material,
  onMaterialChange,
  louverSize,
  onLouverSizeChange,
  signatureRef,
  installMode,
  onSignatureChange,
}: Props) {
  const updateLine = useCallback(
    (id: string, field: keyof ShutterOrderLine, value: unknown) => {
      onChange(updateLineField(lines, id, field, value));
    },
    [lines, onChange]
  );

  const addLine = () => onChange([...lines, emptyLine()]);
  const removeLine = (id: string) => {
    onChange(removeLineById(lines, id));
  };

  const pricings = useMemo(
    () => lines.map((l) => computeShutterLinePrice(l, material, installMode)),
    [lines, material, installMode]
  );
  const totalMerch = pricings.reduce((s, p) => s + (p?.merch ?? 0), 0);
  const totalInstall = pricings.reduce((s, p) => s + (p?.install ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">CALIFORNIA SHUTTERS — ORDER FORM</h2>
          <div className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
            <p>Max panel width: Wood 35", Vinyl 32"</p>
            <p>Max bi-fold panel: Wood 52", Vinyl 40"</p>
            <p>All panel height over 60" requires mid-rail</p>
          </div>
        </div>
        <button
          onClick={addLine}
          className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add Row
        </button>
      </div>

      {/* Material & Louver */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Material</label>
          <div className="flex gap-2">
            {(["Wooden", "Vinyl"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMaterialChange(m)}
                className={cn(
                  "px-4 py-2 rounded-md text-xs font-medium transition-colors",
                  material === m
                    ? "bg-teal-600 text-white"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Louver Size</label>
          <div className="flex gap-2">
            {['2-1/2"', '3-1/2"', '4-1/2"', "Arch"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onLouverSizeChange(louverSize === s ? "" : s)}
                className={cn(
                  "px-3 py-2 rounded-md text-xs font-medium transition-colors",
                  louverSize === s
                    ? "bg-teal-600 text-white"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs min-w-[1050px]">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-2 py-2 text-left w-8">#</th>
              <th className="px-2 py-2 text-left min-w-[100px]">Location</th>
              <th className="px-2 py-2 text-center w-24">Width</th>
              <th className="px-2 py-2 text-center w-24">Height</th>
              <th className="px-2 py-2 text-left w-20">Frame</th>
              <th className="px-2 py-2 text-left w-20">Open Dir</th>
              <th className="px-2 py-2 text-center w-16">Mount</th>
              <th className="px-2 py-2 text-center w-16">Mid Rail</th>
              <th className="px-2 py-2 text-center w-16"># Panels</th>
              <th className="px-2 py-2 text-left min-w-[80px]">Draft</th>
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
                        <option key={f.value} value={f.value}>{f.label}</option>
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
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-1 py-0.5">
                  <select
                    value={line.frame}
                    onChange={(e) => updateLine(line.id, "frame", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px]"
                  >
                    <option value="">—</option>
                    <option value="L">L Frame</option>
                    <option value="Z">Z Frame</option>
                    <option value="S">S Frame</option>
                    <option value="G">G Frame</option>
                    <option value="M">M Frame</option>
                    <option value="Casing">Casing</option>
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <select
                    value={line.openDirection}
                    onChange={(e) => updateLine(line.id, "openDirection", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px]"
                  >
                    <option value="">—</option>
                    <option value="L">Left</option>
                    <option value="R">Right</option>
                    <option value="LR">L/R Split</option>
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <select
                    value={line.mountType}
                    onChange={(e) => updateLine(line.id, "mountType", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px]"
                  >
                    <option value="">—</option>
                    <option value="I">Inside</option>
                    <option value="O">Outside</option>
                  </select>
                </td>
                <td className="px-1 py-0.5 text-center">
                  <input
                    type="checkbox"
                    checked={line.midRail}
                    onChange={(e) => updateLine(line.id, "midRail", e.target.checked)}
                    className="h-5 w-5 rounded border-muted-foreground"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number"
                    value={line.panelCount ?? ""}
                    onChange={(e) =>
                      updateLine(line.id, "panelCount", e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="w-full bg-transparent border-0 outline-none text-xs text-center min-h-[44px]"
                    placeholder="—"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="text"
                    value={line.draft}
                    onChange={(e) => updateLine(line.id, "draft", e.target.value)}
                    className="w-full bg-transparent border-0 outline-none text-xs min-h-[44px] px-1"
                  />
                </td>
                <td className="px-2 py-0.5 text-right align-middle">
                  {p?.error ? (
                    <span className="text-[9px] text-red-500" title={p.error}>—</span>
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
              <td colSpan={10} className="px-2 py-2 text-right text-xs font-medium">
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

      {material === "Wooden" && pricings.some((p) => p?.error) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Wooden shutters pricing data is not available in current catalog. Switch to Vinyl for automatic pricing, or set price manually in Part B.
        </div>
      )}

      <PencilCanvas ref={signatureRef} width={500} height={120} label="Signature" onStrokesChange={onSignatureChange} />
      <p className="text-[9px] text-muted-foreground leading-snug">
        {SIGNATURE_DISCLAIMER}
      </p>
    </div>
  );
}
