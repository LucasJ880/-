"use client";

import { useCallback } from "react";
import type { PartCService, PartCAddOn } from "./types";
import { INSTALL_PRICES, SERVICE_ADDONS, MIN_INSTALL_CHARGE, DELIVERY_FEE } from "./types";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";

interface PartCProps {
  services: PartCService[];
  onServicesChange: (s: PartCService[]) => void;
  addOns: PartCAddOn[];
  onAddOnsChange: (a: PartCAddOn[]) => void;
  signatureRef: React.RefObject<PencilCanvasRef | null>;
}

export function PartCForm({ services, onServicesChange, addOns, onAddOnsChange, signatureRef }: PartCProps) {
  const updateService = useCallback(
    (idx: number, qty: number) => {
      const updated = services.map((s, i) => {
        if (i !== idx) return s;
        return { ...s, qty, total: qty * s.unitPrice };
      });
      onServicesChange(updated);
    },
    [services, onServicesChange]
  );

  const updateAddOn = useCallback(
    (idx: number, qty: number) => {
      const updated = addOns.map((a, i) => {
        if (i !== idx) return a;
        return { ...a, qty, total: qty * a.unitPrice };
      });
      onAddOnsChange(updated);
    },
    [addOns, onAddOnsChange]
  );

  const installTotal = services.reduce((s, v) => s + v.total, 0);
  const actualInstall = Math.max(installTotal, MIN_INSTALL_CHARGE);
  const addOnTotal = addOns.reduce((s, v) => s + v.total, 0);
  const subtotalC = actualInstall + DELIVERY_FEE + addOnTotal;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold">PART C — Service Pricing Details</h2>

      {/* Install pricing reference */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 text-xs">
        <h3 className="font-semibold mb-2 text-sm">Installation Pricing</h3>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="font-medium">Horizontal Blinds</p>
            <p className="text-muted-foreground">0-70": $18/panel</p>
            <p className="text-muted-foreground">70-180": $26/panel</p>
          </div>
          <div>
            <p className="font-medium">Vertical Blinds</p>
            <p className="text-muted-foreground">0-70": $55/rod</p>
            <p className="text-muted-foreground">70-180": $90/rod</p>
          </div>
          <div>
            <p className="font-medium">Shutters</p>
            <p className="text-muted-foreground">$18/panel (max 35")</p>
          </div>
        </div>
      </div>

      {/* Service counting */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-center w-16">QTY</th>
              <th className="px-3 py-2 text-right w-20">Price</th>
              <th className="px-3 py-2 text-right w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => (
              <tr key={s.type} className="border-t border-border/50">
                <td className="px-3 py-1 text-xs">{s.type}</td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    value={s.qty || ""}
                    onChange={(e) => updateService(i, parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent border-0 outline-none text-sm text-center min-h-[44px]"
                  />
                </td>
                <td className="px-3 py-1 text-right text-xs text-muted-foreground">
                  ${s.unitPrice}
                </td>
                <td className="px-3 py-1 text-right font-mono text-xs">
                  {s.total > 0 ? `$${s.total.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Minimum Installation Charge: ${MIN_INSTALL_CHARGE}
        </span>
        <span>
          Install: <span className="font-bold">${actualInstall.toFixed(2)}</span>
          {installTotal > 0 && installTotal < MIN_INSTALL_CHARGE && (
            <span className="text-xs text-amber-600 ml-1">(min applied)</span>
          )}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Delivery</span>
        <span className="font-bold">${DELIVERY_FEE.toFixed(2)}</span>
      </div>

      {/* Add-on services */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-3 py-2 text-left">Add-On Service</th>
              <th className="px-3 py-2 text-center w-16">QTY</th>
              <th className="px-3 py-2 text-right w-20">Price</th>
              <th className="px-3 py-2 text-right w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {addOns.map((a, i) => (
              <tr key={a.type} className="border-t border-border/50">
                <td className="px-3 py-1 text-xs">{a.type}</td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    value={a.qty || ""}
                    onChange={(e) => updateAddOn(i, parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent border-0 outline-none text-sm text-center min-h-[44px]"
                  />
                </td>
                <td className="px-3 py-1 text-right text-xs text-muted-foreground">
                  ${a.unitPrice}
                </td>
                <td className="px-3 py-1 text-right font-mono text-xs">
                  {a.total > 0 ? `$${a.total.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <div className="rounded-lg border-2 border-teal-300 bg-teal-50 px-6 py-3 text-right">
          <span className="text-sm text-muted-foreground mr-3">SUBTOTAL (C):</span>
          <span className="text-xl font-bold text-teal-700">${subtotalC.toFixed(2)}</span>
        </div>
      </div>

      {/* Signature */}
      <div className="space-y-2 pt-2">
        <PencilCanvas ref={signatureRef} width={500} height={120} label="Customer Signature (Part C)" />
        <p className="text-[9px] text-muted-foreground leading-snug max-w-lg">
          By signing, I confirm that I have reviewed and understood all details as presented. I acknowledge that any discrepancies not reported prior to signing may not be the responsibility of Sunny Shutter Inc.
        </p>
      </div>
    </div>
  );
}

export function calcSubtotalC(services: PartCService[], addOns: PartCAddOn[]): number {
  const installTotal = services.reduce((s, v) => s + v.total, 0);
  const actualInstall = Math.max(installTotal, MIN_INSTALL_CHARGE);
  const addOnTotal = addOns.reduce((s, v) => s + v.total, 0);
  return actualInstall + DELIVERY_FEE + addOnTotal;
}
