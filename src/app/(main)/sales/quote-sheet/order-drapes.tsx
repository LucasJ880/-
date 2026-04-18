"use client";

import { useCallback, useMemo } from "react";
import type { DrapeOrderLine, InstallMode } from "./types";
import { FRACTION_OPTIONS } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { getAvailableFabrics } from "@/lib/blinds/pricing-data";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import { updateLineField, removeLineById, SIGNATURE_DISCLAIMER } from "./order-helpers";
import { computeDrapeLinePrice } from "./pricing-helpers";

const DRAPERY_FABRICS = getAvailableFabrics("Drapery");
const SHEER_FABRICS = getAvailableFabrics("Sheer");

function ToggleBtn({
  value,
  current,
  onToggle,
}: {
  value: string;
  current: string;
  onToggle: (v: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(current === value ? "" : value)}
      className={cn(
        "w-7 h-7 rounded text-[10px] font-medium transition-colors",
        current === value
          ? "bg-teal-600 text-white"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
      )}
    >
      {value}
    </button>
  );
}

interface Props {
  lines: DrapeOrderLine[];
  onChange: (lines: DrapeOrderLine[]) => void;
  signatureRef: React.RefObject<PencilCanvasRef | null>;
  installMode: InstallMode;
  onSignatureChange?: (strokeCount: number) => void;
}

function emptyLine(): DrapeOrderLine {
  return {
    id: crypto.randomUUID(),
    location: "",
    drapeWidthWhole: "",
    drapeWidthFrac: "0",
    drapeHeightWhole: "",
    drapeHeightFrac: "0",
    drapeFabricSku: "",
    drapeFullness: "180",
    drapePanels: "S",
    drapePleatStyle: "",
    drapeLiner: false,
    drapeBracket: "",
    sheerWidthWhole: "",
    sheerWidthFrac: "0",
    sheerHeightWhole: "",
    sheerHeightFrac: "0",
    sheerFabricSku: "",
    sheerFullness: "180",
    sheerPanels: "S",
    sheerPleatStyle: "",
    sheerBracket: "",
    accessoriesSku: "",
    note: "",
  };
}

function DimInput({
  whole,
  frac,
  onWholeChange,
  onFracChange,
}: {
  whole: string;
  frac: string;
  onWholeChange: (v: string) => void;
  onFracChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <input
        type="text"
        value={whole}
        onChange={(e) => onWholeChange(e.target.value)}
        className="w-8 bg-transparent border-0 outline-none text-[10px] text-center min-h-[44px]"
        placeholder="in"
      />
      <select
        value={frac}
        onChange={(e) => onFracChange(e.target.value)}
        className="bg-transparent border-0 outline-none text-[9px]"
      >
        {FRACTION_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
    </div>
  );
}

export function OrderDrapesForm({ lines, onChange, signatureRef, installMode, onSignatureChange }: Props) {
  const updateLine = useCallback(
    (id: string, field: keyof DrapeOrderLine, value: unknown) => {
      onChange(updateLineField(lines, id, field, value));
    },
    [lines, onChange]
  );

  const addLine = () => onChange([...lines, emptyLine()]);
  const removeLine = (id: string) => {
    onChange(removeLineById(lines, id));
  };

  const pricings = useMemo(
    () => lines.map((l) => computeDrapeLinePrice(l, installMode)),
    [lines, installMode]
  );
  const grandTotal = pricings.reduce((s, p) => s + (p?.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">DRAPES & SHEER — ORDER FORM</h2>
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

      <div className="space-y-3">
        {lines.map((line, i) => {
          const p = pricings[i];
          return (
          <div key={line.id} className="border border-border rounded-lg p-3 space-y-2 bg-white/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-teal-700 w-6">#{i + 1}</span>
                <input
                  type="text"
                  value={line.location}
                  onChange={(e) => updateLine(line.id, "location", e.target.value)}
                  className="bg-transparent border-b border-dashed border-border outline-none text-sm min-h-[44px] px-1 w-40"
                  placeholder="Location / Room"
                />
              </div>
              <div className="flex items-center gap-3">
                {p?.error ? (
                  <span className="text-[10px] text-red-500" title={p.error}>
                    Err
                  </span>
                ) : p ? (
                  <div className="text-right leading-tight">
                    <div className="font-mono text-xs font-semibold text-teal-700">
                      {formatCAD(p.total)}
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {installMode === "pickup" ? (
                        <span className="text-amber-600">Pickup · no install</span>
                      ) : (
                        <>Install {formatCAD(p.drapeInstall + p.sheerInstall)}</>
                      )}
                    </div>
                  </div>
                ) : null}
                <button
                  onClick={() => removeLine(line.id)}
                  className="p-1 text-muted-foreground hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Drape row */}
            <div className="rounded bg-muted/10 p-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Drape
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                <div>
                  <span className="text-muted-foreground">W:</span>
                  <DimInput
                    whole={line.drapeWidthWhole}
                    frac={line.drapeWidthFrac}
                    onWholeChange={(v) => updateLine(line.id, "drapeWidthWhole", v)}
                    onFracChange={(v) => updateLine(line.id, "drapeWidthFrac", v)}
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">H:</span>
                  <DimInput
                    whole={line.drapeHeightWhole}
                    frac={line.drapeHeightFrac}
                    onWholeChange={(v) => updateLine(line.id, "drapeHeightWhole", v)}
                    onFracChange={(v) => updateLine(line.id, "drapeHeightFrac", v)}
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Fabric:</span>
                  <select
                    value={line.drapeFabricSku}
                    onChange={(e) => updateLine(line.id, "drapeFabricSku", e.target.value)}
                    className="bg-transparent border-b border-dashed border-border outline-none text-[10px] px-1 min-h-[44px]"
                  >
                    <option value="">—</option>
                    {DRAPERY_FABRICS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Full:</span>
                  <ToggleBtn value="180" current={line.drapeFullness} onToggle={(v) => updateLine(line.id, "drapeFullness", v || "180")} />
                  <ToggleBtn value="230" current={line.drapeFullness} onToggle={(v) => updateLine(line.id, "drapeFullness", v || "180")} />
                  <span className="text-muted-foreground ml-0.5">%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Panel:</span>
                  <ToggleBtn value="S" current={line.drapePanels} onToggle={(v) => updateLine(line.id, "drapePanels", v || "S")} />
                  <ToggleBtn value="D" current={line.drapePanels} onToggle={(v) => updateLine(line.id, "drapePanels", v || "S")} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Pleat:</span>
                  <ToggleBtn value="G" current={line.drapePleatStyle} onToggle={(v) => updateLine(line.id, "drapePleatStyle", v)} />
                  <ToggleBtn value="P" current={line.drapePleatStyle} onToggle={(v) => updateLine(line.id, "drapePleatStyle", v)} />
                  <ToggleBtn value="R" current={line.drapePleatStyle} onToggle={(v) => updateLine(line.id, "drapePleatStyle", v)} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Liner:</span>
                  <ToggleBtn value="Y" current={line.drapeLiner ? "Y" : "N"} onToggle={() => updateLine(line.id, "drapeLiner", !line.drapeLiner)} />
                  <ToggleBtn value="N" current={line.drapeLiner ? "Y" : "N"} onToggle={() => updateLine(line.id, "drapeLiner", !line.drapeLiner)} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Bracket:</span>
                  <ToggleBtn value="C" current={line.drapeBracket} onToggle={(v) => updateLine(line.id, "drapeBracket", v)} />
                  <ToggleBtn value="W" current={line.drapeBracket} onToggle={(v) => updateLine(line.id, "drapeBracket", v)} />
                </div>
              </div>
            </div>

            {/* Sheer row */}
            <div className="rounded bg-blue-50/30 p-2">
              <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">
                Sheer
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                <div>
                  <span className="text-muted-foreground">W:</span>
                  <DimInput
                    whole={line.sheerWidthWhole}
                    frac={line.sheerWidthFrac}
                    onWholeChange={(v) => updateLine(line.id, "sheerWidthWhole", v)}
                    onFracChange={(v) => updateLine(line.id, "sheerWidthFrac", v)}
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">H:</span>
                  <DimInput
                    whole={line.sheerHeightWhole}
                    frac={line.sheerHeightFrac}
                    onWholeChange={(v) => updateLine(line.id, "sheerHeightWhole", v)}
                    onFracChange={(v) => updateLine(line.id, "sheerHeightFrac", v)}
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Fabric:</span>
                  <select
                    value={line.sheerFabricSku}
                    onChange={(e) => updateLine(line.id, "sheerFabricSku", e.target.value)}
                    className="bg-transparent border-b border-dashed border-border outline-none text-[10px] px-1 min-h-[44px]"
                  >
                    <option value="">—</option>
                    {SHEER_FABRICS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Full:</span>
                  <ToggleBtn value="180" current={line.sheerFullness} onToggle={(v) => updateLine(line.id, "sheerFullness", v || "180")} />
                  <ToggleBtn value="230" current={line.sheerFullness} onToggle={(v) => updateLine(line.id, "sheerFullness", v || "180")} />
                  <span className="text-muted-foreground ml-0.5">%</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Panel:</span>
                  <ToggleBtn value="S" current={line.sheerPanels} onToggle={(v) => updateLine(line.id, "sheerPanels", v || "S")} />
                  <ToggleBtn value="D" current={line.sheerPanels} onToggle={(v) => updateLine(line.id, "sheerPanels", v || "S")} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Pleat:</span>
                  <ToggleBtn value="G" current={line.sheerPleatStyle} onToggle={(v) => updateLine(line.id, "sheerPleatStyle", v)} />
                  <ToggleBtn value="P" current={line.sheerPleatStyle} onToggle={(v) => updateLine(line.id, "sheerPleatStyle", v)} />
                  <ToggleBtn value="R" current={line.sheerPleatStyle} onToggle={(v) => updateLine(line.id, "sheerPleatStyle", v)} />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Bracket:</span>
                  <ToggleBtn value="C" current={line.sheerBracket} onToggle={(v) => updateLine(line.id, "sheerBracket", v)} />
                  <ToggleBtn value="W" current={line.sheerBracket} onToggle={(v) => updateLine(line.id, "sheerBracket", v)} />
                </div>
              </div>
            </div>

            {/* Accessories & note */}
            <div className="flex gap-3 text-[10px]">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-muted-foreground shrink-0">Accessories:</span>
                <input
                  type="text"
                  value={line.accessoriesSku}
                  onChange={(e) => updateLine(line.id, "accessoriesSku", e.target.value)}
                  className="w-full bg-transparent border-b border-dashed border-border outline-none text-[10px] px-1 min-h-[44px]"
                  placeholder="SKU"
                />
              </div>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-muted-foreground shrink-0">Note:</span>
                <input
                  type="text"
                  value={line.note}
                  onChange={(e) => updateLine(line.id, "note", e.target.value)}
                  className="w-full bg-transparent border-b border-dashed border-border outline-none text-[10px] px-1 min-h-[44px]"
                />
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <div className="rounded-lg border-2 border-teal-200 bg-teal-50/40 px-4 py-2 text-right">
          <span className="text-xs text-muted-foreground">
            Drapes + Sheers Subtotal
            {installMode === "pickup" && (
              <span className="ml-1 text-amber-600">· Pickup · no install</span>
            )}
            :
          </span>
          <span className="ml-3 font-mono text-base font-bold text-teal-700">
            {formatCAD(grandTotal)}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/10 rounded-lg p-3">
        <p><strong>Pleat Style:</strong> G = Grommet, P = Pinch Pleat, R = Ripple Fold</p>
        <p><strong>Bracket:</strong> C = Ceiling, W = Wall</p>
        <p><strong>Fullness:</strong> Standard 180%, Premium 230%</p>
      </div>

      <PencilCanvas ref={signatureRef} width={500} height={120} label="Signature" onStrokesChange={onSignatureChange} />
      <p className="text-[9px] text-muted-foreground leading-snug">
        {SIGNATURE_DISCLAIMER}
      </p>
    </div>
  );
}
