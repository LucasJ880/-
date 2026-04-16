"use client";

import { useCallback, useState } from "react";
import type { PartALine, ProductName, ProductCategory, InstallMode } from "./types";
import { getProductCategory } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2, AlertCircle, Lock, Unlock, Settings2 } from "lucide-react";
import { priceFor, isCordlessEligible, formatCAD } from "@/lib/blinds/pricing-engine";
import { getAvailableFabrics, ALL_PRODUCTS, DEFAULT_DISCOUNTS } from "@/lib/blinds/pricing-data";

const DISCOUNT_CODE = "Sunny2026";

function recalcLine(line: PartALine): PartALine {
  if (!line.product || !line.fabric || !line.widthIn || !line.heightIn) {
    return { ...line, msrp: null, price: null, discountValue: null, installFee: null, error: null };
  }

  const result = priceFor(
    line.product as ProductName,
    line.fabric,
    line.widthIn,
    line.heightIn,
    line.discountOverride,
    line.cordless
  );

  if ("error" in result) {
    return { ...line, msrp: null, price: null, discountValue: null, installFee: null, error: result.error };
  }

  const qty = Math.max(1, line.panelCount);
  return {
    ...line,
    msrp: result.msrp,
    discountPct: result.discountPct,
    discountValue: result.discountValue * qty,
    price: result.price * qty,
    installFee: result.install * qty,
    error: null,
  };
}

function DiscountPanel({
  unlocked,
  onUnlock,
  discountOverride,
  product,
  onDiscountChange,
}: {
  unlocked: boolean;
  onUnlock: () => void;
  discountOverride: number | null;
  product: ProductName | "";
  onDiscountChange: (v: number | null) => void;
}) {
  const [codeInput, setCodeInput] = useState("");
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeError, setCodeError] = useState(false);

  const defaultDiscount = product ? (DEFAULT_DISCOUNTS[product as ProductName] ?? 0) : 0;
  const currentPct = discountOverride !== null ? discountOverride : defaultDiscount;
  const isCustom = discountOverride !== null;

  const handleCodeSubmit = () => {
    if (codeInput === DISCOUNT_CODE) {
      onUnlock();
      setShowCodeInput(false);
      setCodeError(false);
      setCodeInput("");
    } else {
      setCodeError(true);
    }
  };

  if (!unlocked) {
    if (showCodeInput) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={codeInput}
            onChange={(e) => { setCodeInput(e.target.value); setCodeError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleCodeSubmit()}
            className={cn(
              "w-28 rounded border px-2 py-1 text-xs outline-none min-h-[32px]",
              codeError ? "border-red-400 bg-red-50" : "border-border"
            )}
            placeholder="Enter code"
            autoFocus
          />
          <button onClick={handleCodeSubmit}
            className="rounded bg-teal-600 px-2 py-1 text-[10px] text-white font-medium hover:bg-teal-700">
            OK
          </button>
          <button onClick={() => { setShowCodeInput(false); setCodeError(false); }}
            className="text-[10px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button onClick={() => setShowCodeInput(true)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-teal-700 transition-colors"
        title="Adjust discount rate">
        <Lock className="h-3 w-3" />
        <span>{(currentPct * 100).toFixed(0)}%</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Unlock className="h-3 w-3 text-teal-600" />
      <input
        type="range"
        min={0} max={60} step={1}
        value={Math.round(currentPct * 100)}
        onChange={(e) => {
          const val = parseInt(e.target.value) / 100;
          onDiscountChange(val === defaultDiscount ? null : val);
        }}
        className="w-20 h-1.5 accent-teal-600"
      />
      <input
        type="number"
        min={0} max={60} step={1}
        value={Math.round(currentPct * 100)}
        onChange={(e) => {
          const val = (parseInt(e.target.value) || 0) / 100;
          onDiscountChange(val === defaultDiscount ? null : val);
        }}
        className="w-12 rounded border border-border px-1.5 py-0.5 text-xs text-center min-h-[28px]"
      />
      <span className="text-[10px] text-muted-foreground">%</span>
      {isCustom && (
        <button onClick={() => onDiscountChange(null)}
          className="text-[9px] text-amber-600 hover:text-amber-800 font-medium">
          Reset to {(defaultDiscount * 100).toFixed(0)}%
        </button>
      )}
    </div>
  );
}

function ToggleBtn({ value, current, onToggle, size = "default" }: {
  value: string; current: string; onToggle: (v: string) => void; size?: "default" | "sm";
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(current === value ? "" : value)}
      className={cn(
        "rounded font-medium transition-colors",
        size === "sm" ? "w-6 h-6 text-[9px]" : "w-8 h-8 text-xs",
        current === value
          ? "bg-teal-600 text-white"
          : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
      )}
    >
      {value}
    </button>
  );
}

function ShadeFields({ line, onUpdate }: { line: PartALine; onUpdate: (u: Partial<PartALine>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Mount:</span>
        <ToggleBtn value="I" current={line.mount} onToggle={(v) => onUpdate({ mount: v as "I" | "O" | "" })} />
        <ToggleBtn value="O" current={line.mount} onToggle={(v) => onUpdate({ mount: v as "I" | "O" | "" })} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Lift:</span>
        <ToggleBtn value="L" current={line.lift} onToggle={(v) => onUpdate({ lift: v as "L" | "R" | "M" | "" })} />
        <ToggleBtn value="R" current={line.lift} onToggle={(v) => onUpdate({ lift: v as "L" | "R" | "M" | "" })} />
        <ToggleBtn value="M" current={line.lift} onToggle={(v) => onUpdate({ lift: v as "L" | "R" | "M" | "" })} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Bracket:</span>
        <ToggleBtn value="C" current={line.bracket} onToggle={(v) => onUpdate({ bracket: v as "C" | "W" | "" })} />
        <ToggleBtn value="W" current={line.bracket} onToggle={(v) => onUpdate({ bracket: v as "C" | "W" | "" })} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Valance:</span>
        {["Cassette", "Fascia"].map((v) => (
          <button key={v} type="button" onClick={() => onUpdate({ valance: line.valance === v ? "" : v })}
            className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors",
              line.valance === v ? "bg-teal-600 text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted/70")}>
            {v}
          </button>
        ))}
      </div>
      {isCordlessEligible(line.product as ProductName) && (
        <label className="flex items-center gap-1.5 text-[10px]">
          <input type="checkbox" checked={line.cordless} onChange={(e) => onUpdate({ cordless: e.target.checked })}
            className="h-4 w-4 rounded" />
          <span className="font-medium">Cordless (+15%)</span>
        </label>
      )}
    </div>
  );
}

function ShutterFields({ line, onUpdate }: { line: PartALine; onUpdate: (u: Partial<PartALine>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Material:</span>
        {(["Wooden", "Vinyl"] as const).map((m) => (
          <button key={m} type="button" onClick={() => onUpdate({ shutterMaterial: line.shutterMaterial === m ? "" : m })}
            className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors",
              line.shutterMaterial === m ? "bg-teal-600 text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted/70")}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Frame:</span>
        <select value={line.frame} onChange={(e) => onUpdate({ frame: e.target.value })}
          className="bg-transparent border border-border rounded px-2 py-1 text-[10px] min-h-[32px]">
          <option value="">—</option>
          {["L", "Z", "S", "G", "M", "Casing"].map((f) => <option key={f} value={f}>{f} Frame</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Open:</span>
        <select value={line.openDirection} onChange={(e) => onUpdate({ openDirection: e.target.value })}
          className="bg-transparent border border-border rounded px-2 py-1 text-[10px] min-h-[32px]">
          <option value="">—</option>
          <option value="L">Left</option>
          <option value="R">Right</option>
          <option value="LR">L/R Split</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Mount:</span>
        <ToggleBtn value="I" current={line.mount} onToggle={(v) => onUpdate({ mount: v as "I" | "O" | "" })} />
        <ToggleBtn value="O" current={line.mount} onToggle={(v) => onUpdate({ mount: v as "I" | "O" | "" })} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Louver:</span>
        {['2½"', '3½"', '4½"', "Arch"].map((s) => (
          <button key={s} type="button" onClick={() => onUpdate({ louverSize: line.louverSize === s ? "" : s })}
            className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors",
              line.louverSize === s ? "bg-teal-600 text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted/70")}>
            {s}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-[10px]">
        <input type="checkbox" checked={line.midRail} onChange={(e) => onUpdate({ midRail: e.target.checked })}
          className="h-4 w-4 rounded" />
        <span className="font-medium">Mid Rail</span>
      </label>
    </div>
  );
}

function DrapeFields({ line, onUpdate }: { line: PartALine; onUpdate: (u: Partial<PartALine>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Fullness:</span>
        <ToggleBtn value="180" current={line.fullness} onToggle={(v) => onUpdate({ fullness: (v || "180") as "180" | "230" })} />
        <ToggleBtn value="230" current={line.fullness} onToggle={(v) => onUpdate({ fullness: (v || "180") as "180" | "230" })} />
        <span className="text-[9px] text-muted-foreground">%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Panels:</span>
        <ToggleBtn value="S" current={line.panels} onToggle={(v) => onUpdate({ panels: (v || "S") as "S" | "D" })} />
        <ToggleBtn value="D" current={line.panels} onToggle={(v) => onUpdate({ panels: (v || "S") as "S" | "D" })} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Pleat:</span>
        <ToggleBtn value="G" current={line.pleatStyle} onToggle={(v) => onUpdate({ pleatStyle: v as "G" | "P" | "R" | "" })} />
        <ToggleBtn value="P" current={line.pleatStyle} onToggle={(v) => onUpdate({ pleatStyle: v as "G" | "P" | "R" | "" })} />
        <ToggleBtn value="R" current={line.pleatStyle} onToggle={(v) => onUpdate({ pleatStyle: v as "G" | "P" | "R" | "" })} />
        <span className="text-[8px] text-muted-foreground">(G=Grommet P=Pinch R=Ripple)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium">Bracket:</span>
        <ToggleBtn value="C" current={line.bracket} onToggle={(v) => onUpdate({ bracket: v as "C" | "W" | "" })} />
        <ToggleBtn value="W" current={line.bracket} onToggle={(v) => onUpdate({ bracket: v as "C" | "W" | "" })} />
      </div>
      {line.product === "Drapery" && (
        <label className="flex items-center gap-1.5 text-[10px]">
          <input type="checkbox" checked={line.liner} onChange={(e) => onUpdate({ liner: e.target.checked })}
            className="h-4 w-4 rounded" />
          <span className="font-medium">Liner</span>
        </label>
      )}
    </div>
  );
}

export function PartAForm({
  lines,
  onChange,
  installMode = "default",
}: {
  lines: PartALine[];
  onChange: (lines: PartALine[]) => void;
  installMode?: InstallMode;
}) {
  const [discountUnlocked, setDiscountUnlocked] = useState(false);

  const updateLine = useCallback(
    (id: string, updates: Partial<PartALine>) => {
      onChange(
        lines.map((l) => {
          if (l.id !== id) return l;
          const merged = { ...l, ...updates };
          if ("product" in updates && updates.product !== l.product) {
            merged.fabric = "";
            merged.msrp = null;
            merged.price = null;
            merged.discountValue = null;
            merged.installFee = null;
            merged.error = null;
            merged.cordless = false;
          }
          return recalcLine(merged);
        })
      );
    },
    [lines, onChange]
  );

  const addLine = useCallback(() => {
    onChange([...lines, makeEmptyLine()]);
  }, [lines, onChange]);

  const removeLine = useCallback(
    (id: string) => {
      if (lines.length <= 1) return;
      onChange(lines.filter((l) => l.id !== id));
    },
    [lines, onChange]
  );

  const filledLines = lines.filter((l) => l.product);
  const subtotal = lines.reduce((s, l) => s + (l.price ?? 0), 0);
  const isPickup = installMode === "pickup";
  const installTotal = isPickup ? 0 : lines.reduce((s, l) => s + (l.installFee ?? 0), 0);
  const msrpTotal = lines.reduce((s, l) => s + ((l.msrp ?? 0) * Math.max(1, l.panelCount)), 0);
  const discountTotal = lines.reduce((s, l) => s + (l.discountValue ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">PART A — Product Details</h2>
        <button onClick={addLine}
          className="flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800 font-medium">
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => {
          const fabrics = line.product ? getAvailableFabrics(line.product as ProductName) : [];
          const cat = getProductCategory(line.product);
          const qty = Math.max(1, line.panelCount);

          return (
            <div key={line.id}
              className={cn(
                "rounded-xl border p-4 space-y-3 transition-colors",
                line.error ? "border-red-200 bg-red-50/30" : line.price ? "border-teal-200 bg-white/60" : "border-border bg-white/40"
              )}>
              {/* Row 1: # + Room + Product + Fabric + Dimensions + Qty */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-teal-700 w-8">#{i + 1}</span>
                  <button onClick={() => removeLine(line.id)}
                    className="p-1 text-muted-foreground hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1 min-w-[100px]">
                  <label className="text-[10px] text-muted-foreground font-medium">Room / Location</label>
                  <input type="text" value={line.roomName}
                    onChange={(e) => updateLine(line.id, { roomName: e.target.value })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm outline-none min-h-[44px]"
                    placeholder="e.g. Master Bedroom" />
                </div>

                <div className="w-36">
                  <label className="text-[10px] text-muted-foreground font-medium">Product</label>
                  <select value={line.product}
                    onChange={(e) => updateLine(line.id, { product: (e.target.value || "") as ProductName | "" })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm outline-none min-h-[44px]">
                    <option value="">Select...</option>
                    {ALL_PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="w-44">
                  <label className="text-[10px] text-muted-foreground font-medium">Fabric / SKU</label>
                  <select value={line.fabric}
                    onChange={(e) => updateLine(line.id, { fabric: e.target.value })}
                    disabled={!line.product}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm outline-none min-h-[44px] disabled:opacity-50">
                    <option value="">Select fabric...</option>
                    {fabrics.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                <div className="w-20">
                  <label className="text-[10px] text-muted-foreground font-medium">Width"</label>
                  <input type="number" step="0.0625" value={line.widthIn ?? ""}
                    onChange={(e) => updateLine(line.id, { widthIn: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm text-center outline-none min-h-[44px]"
                    placeholder="W" />
                </div>

                <div className="w-20">
                  <label className="text-[10px] text-muted-foreground font-medium">Height"</label>
                  <input type="number" step="0.0625" value={line.heightIn ?? ""}
                    onChange={(e) => updateLine(line.id, { heightIn: e.target.value ? parseFloat(e.target.value) : null })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm text-center outline-none min-h-[44px]"
                    placeholder="H" />
                </div>

                <div className="w-16">
                  <label className="text-[10px] text-muted-foreground font-medium">Qty</label>
                  <input type="number" min={1} value={line.panelCount || ""}
                    onChange={(e) => updateLine(line.id, { panelCount: parseInt(e.target.value) || 1 })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm text-center outline-none min-h-[44px]"
                    placeholder="1" />
                </div>

                <div className="min-w-[70px]">
                  <label className="text-[10px] text-muted-foreground font-medium">Note</label>
                  <input type="text" value={line.note}
                    onChange={(e) => updateLine(line.id, { note: e.target.value })}
                    className="w-full rounded border border-border bg-white/80 px-2 py-1.5 text-sm outline-none min-h-[44px]"
                    placeholder="—" />
                </div>
              </div>

              {/* Row 2: Product-specific fields */}
              {cat === "shade" && <ShadeFields line={line} onUpdate={(u) => updateLine(line.id, u)} />}
              {cat === "shutter" && <ShutterFields line={line} onUpdate={(u) => updateLine(line.id, u)} />}
              {cat === "drape" && <DrapeFields line={line} onUpdate={(u) => updateLine(line.id, u)} />}

              {/* Row 3: Pricing breakdown + discount control */}
              {(line.msrp || line.error) && (
                <div className={cn(
                  "flex flex-wrap items-center gap-4 rounded-lg px-3 py-2 text-xs",
                  line.error ? "bg-red-100/50" : "bg-teal-50/70"
                )}>
                  {line.error ? (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertCircle className="h-3.5 w-3.5" /> {line.error}
                    </span>
                  ) : (
                    <>
                      <div>
                        <span className="text-muted-foreground">MSRP: </span>
                        <span className="font-mono line-through text-muted-foreground">
                          {formatCAD(line.msrp! * qty)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Discount: </span>
                        <DiscountPanel
                          unlocked={discountUnlocked}
                          onUnlock={() => setDiscountUnlocked(true)}
                          discountOverride={line.discountOverride}
                          product={line.product}
                          onDiscountChange={(v) => updateLine(line.id, { discountOverride: v })}
                        />
                        {!discountUnlocked && (
                          <span className="font-mono text-red-600">
                            −{formatCAD(line.discountValue ?? 0)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Price: </span>
                        <span className="font-mono font-bold text-teal-700 text-sm">
                          {formatCAD(line.price ?? 0)}
                        </span>
                      </div>
                      <div className="ml-auto text-[10px] text-muted-foreground">
                        {isPickup ? (
                          <span className="text-amber-600 font-medium">Pickup · no install</span>
                        ) : (
                          <>Install: {formatCAD(line.installFee ?? 0)}</>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="flex flex-wrap justify-end gap-3">
        <div className="rounded-lg border border-border bg-muted/10 px-4 py-2 text-right text-xs">
          <span className="text-muted-foreground mr-1">MSRP Total:</span>
          <span className="font-mono line-through">{formatCAD(msrpTotal)}</span>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50/50 px-4 py-2 text-right text-xs">
          <span className="text-muted-foreground mr-1">Discount:</span>
          <span className="font-mono text-red-600">−{formatCAD(discountTotal)}</span>
        </div>
        <div className={cn(
          "rounded-lg border px-4 py-2 text-right text-xs",
          isPickup ? "border-amber-300 bg-amber-50" : "border-border bg-muted/10"
        )}>
          <span className="text-muted-foreground mr-1">Install:</span>
          <span className={cn("font-mono", isPickup && "text-amber-700 font-semibold")}>
            {isPickup ? "Pickup · $0" : formatCAD(installTotal)}
          </span>
        </div>
        <div className="rounded-lg border-2 border-teal-300 bg-teal-50 px-6 py-3 text-right">
          <span className="text-sm text-muted-foreground mr-3">SUBTOTAL (A):</span>
          <span className="text-xl font-bold text-teal-700">{formatCAD(subtotal)}</span>
        </div>
      </div>
    </div>
  );
}

export function makeEmptyLine(): PartALine {
  return {
    id: crypto.randomUUID(),
    roomName: "",
    product: "",
    fabric: "",
    widthIn: null,
    heightIn: null,
    cordless: false,
    panelCount: 1,
    discountOverride: null,
    msrp: null,
    discountPct: null,
    discountValue: null,
    price: null,
    installFee: null,
    error: null,
    mount: "",
    lift: "",
    bracket: "",
    valance: "",
    frame: "",
    openDirection: "",
    midRail: false,
    louverSize: "",
    shutterMaterial: "",
    fullness: "180",
    panels: "S",
    pleatStyle: "",
    liner: false,
    note: "",
  };
}
