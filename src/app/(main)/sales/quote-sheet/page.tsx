"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Trash2,
  FileDown,
  ChevronDown,
  Save,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { priceFor, calculateQuoteTotal, formatCAD } from "@/lib/blinds/pricing-engine";
import { getAvailableFabrics, ALL_PRODUCTS } from "@/lib/blinds/pricing-data";
import type { ProductName } from "@/lib/blinds/pricing-types";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { offlineDb } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-engine";
import { useOnlineStatus } from "@/lib/offline/hooks";

interface QuoteItem {
  id: string;
  room: string;
  product: ProductName;
  fabric: string;
  widthIn: number;
  heightIn: number;
  cordless: boolean;
  qty: number;
}

function newItem(): QuoteItem {
  const product: ProductName = "Zebra";
  const fabrics = getAvailableFabrics(product);
  return {
    id: crypto.randomUUID(),
    room: "",
    product,
    fabric: fabrics[0] ?? "",
    widthIn: 0,
    heightIn: 0,
    cordless: false,
    qty: 1,
  };
}

export default function QuoteSheetPage() {
  const isOnline = useOnlineStatus();
  const notesRef = useRef<PencilCanvasRef>(null);
  const signatureRef = useRef<PencilCanvasRef>(null);

  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
  });
  const [items, setItems] = useState<QuoteItem[]>([newItem()]);
  const [installMode, setInstallMode] = useState<"default" | "pickup">("default");
  const [showNotes, setShowNotes] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateItem = useCallback((id: string, field: string, value: unknown) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === "product") {
          const fabrics = getAvailableFabrics(value as ProductName);
          updated.fabric = fabrics[0] ?? "";
        }
        return updated;
      })
    );
  }, []);

  const pricedItems = useMemo(() => {
    return items.map((item) => {
      if (item.widthIn <= 0 || item.heightIn <= 0) return { item, pricing: null };
      const res = priceFor(item.product, item.fabric, item.widthIn, item.heightIn, null, item.cordless);
      if ("error" in res) return { item, pricing: null };
      return { item, pricing: res };
    });
  }, [items]);

  const totals = useMemo(() => {
    const validItems = pricedItems
      .filter((p) => p.pricing)
      .map((p) => ({
        product: p.item.product,
        fabric: p.item.fabric,
        widthIn: p.item.widthIn,
        heightIn: p.item.heightIn,
        cordless: p.item.cordless,
      }));
    if (validItems.length === 0) return null;
    return calculateQuoteTotal({ items: validItems, installMode });
  }, [pricedItems, installMode]);

  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(20);
    doc.setTextColor(15, 118, 110);
    doc.text("SUNNY SHUTTER", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Window Covering Specialist", 14, 27);

    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text("QUOTATION", pageWidth - 14, 20, { align: "right" });
    doc.setFontSize(9);
    doc.text(`Date: ${new Date().toLocaleDateString("en-CA")}`, pageWidth - 14, 27, { align: "right" });

    doc.setDrawColor(200);
    doc.line(14, 32, pageWidth - 14, 32);

    let y = 38;
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text("Customer:", 14, y);
    doc.setTextColor(30);
    doc.text(customer.name || "—", 50, y);
    y += 6;
    doc.setTextColor(60);
    doc.text("Phone:", 14, y);
    doc.setTextColor(30);
    doc.text(customer.phone || "—", 50, y);
    doc.setTextColor(60);
    doc.text("Email:", pageWidth / 2, y);
    doc.setTextColor(30);
    doc.text(customer.email || "—", pageWidth / 2 + 20, y);
    y += 6;
    doc.setTextColor(60);
    doc.text("Address:", 14, y);
    doc.setTextColor(30);
    doc.text(customer.address || "—", 50, y);
    y += 10;

    const tableBody = pricedItems
      .filter((p) => p.pricing)
      .map((p, i) => [
        String(i + 1),
        p.item.room || "—",
        p.item.product,
        p.item.fabric,
        `${p.item.widthIn}" × ${p.item.heightIn}"`,
        p.item.cordless ? "Yes" : "No",
        formatCAD(p.pricing!.price),
        formatCAD(p.pricing!.install),
      ]);

    autoTable(doc, {
      startY: y,
      head: [["#", "Room", "Product", "Fabric", "Size", "Cordless", "Price", "Install"]],
      body: tableBody,
      theme: "striped",
      headStyles: { fillColor: [15, 118, 110], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    if (totals) {
      const summaryLines = [
        ["Merchandise Subtotal", formatCAD(totals.merchSubtotal)],
        ["Installation", formatCAD(totals.installApplied)],
        ["Delivery", formatCAD(totals.deliveryFee)],
        ["Pre-tax Total", formatCAD(totals.preTaxTotal)],
        [`HST (${(totals.taxRate * 100).toFixed(0)}%)`, formatCAD(totals.taxAmount)],
      ];
      for (const [label, val] of summaryLines) {
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(label, pageWidth - 80, y);
        doc.setTextColor(30);
        doc.text(val, pageWidth - 14, y, { align: "right" });
        y += 6;
      }
      y += 2;
      doc.setDrawColor(15, 118, 110);
      doc.line(pageWidth - 80, y - 2, pageWidth - 14, y - 2);
      doc.setFontSize(12);
      doc.setTextColor(15, 118, 110);
      doc.text("TOTAL", pageWidth - 80, y + 4);
      doc.text(formatCAD(totals.grandTotal), pageWidth - 14, y + 4, { align: "right" });
    }

    if (notesRef.current && !notesRef.current.isEmpty()) {
      const notesUrl = notesRef.current.toDataURL();
      doc.addPage();
      doc.setFontSize(12);
      doc.text("Notes / Sketches", 14, 20);
      doc.addImage(notesUrl, "PNG", 14, 28, pageWidth - 28, 100);
    }

    if (signatureRef.current && !signatureRef.current.isEmpty()) {
      const sigUrl = signatureRef.current.toDataURL();
      const sigY = y + 20;
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text("Customer Signature:", 14, sigY);
      doc.addImage(sigUrl, "PNG", 14, sigY + 4, 80, 30);
      doc.line(14, sigY + 36, 94, sigY + 36);
      doc.text(`Date: ${new Date().toLocaleDateString("en-CA")}`, 14, sigY + 42);
    }

    doc.save(`Quote-${customer.name || "draft"}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [customer, pricedItems, totals, installMode]);

  const handleSave = useCallback(async () => {
    if (!customer.name.trim()) return;
    setSaving(true);
    try {
      const validItems = pricedItems.filter((p) => p.pricing);
      if (validItems.length === 0) return;

      const now = new Date().toISOString();
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await offlineDb.quotes.add({
        localId,
        customerLocalId: localId,
        installMode,
        items: validItems.map((p) => ({
          product: p.item.product,
          fabric: p.item.fabric,
          widthIn: p.item.widthIn,
          heightIn: p.item.heightIn,
          cordless: p.item.cordless,
          msrp: p.pricing!.msrp,
          discountPct: p.pricing!.discountPct,
          price: p.pricing!.price,
          installFee: p.pricing!.install,
          location: p.item.room,
        })),
        addons: [],
        merchSubtotal: totals?.merchSubtotal ?? 0,
        addonsSubtotal: 0,
        installSubtotal: totals?.installSubtotal ?? 0,
        installApplied: totals?.installApplied ?? 0,
        deliveryFee: totals?.deliveryFee ?? 50,
        preTaxTotal: totals?.preTaxTotal ?? 0,
        taxRate: totals?.taxRate ?? 0.13,
        taxAmount: totals?.taxAmount ?? 0,
        grandTotal: totals?.grandTotal ?? 0,
        notes: customer.address,
        syncStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });

      if (notesRef.current && !notesRef.current.isEmpty()) {
        const blob = await notesRef.current.toBlob();
        if (blob) {
          await offlineDb.sketches.add({
            localId: `sketch-${localId}`,
            relatedType: "quote",
            relatedLocalId: localId,
            imageBlob: blob,
            createdAt: now,
          });
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }, [customer, pricedItems, totals, installMode]);

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="电子报价单"
        description="数字化报价 · 支持 Apple Pencil 手写 · 离线可用 · 导出 PDF"
      />

      {/* Company Header (preview) */}
      <div className="rounded-xl border border-border bg-white/80 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-teal-700">SUNNY SHUTTER</h2>
            <p className="text-sm text-muted-foreground">Window Covering Specialist</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>QUOTATION</p>
            <p>{new Date().toLocaleDateString("en-CA")}</p>
          </div>
        </div>
      </div>

      {/* Customer Info */}
      <div className="rounded-xl border border-border bg-white/60 p-5 space-y-3">
        <h3 className="text-sm font-semibold">Customer Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              placeholder="John Smith"
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              placeholder="416-xxx-xxxx"
              value={customer.phone}
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              placeholder="email@example.com"
              value={customer.email}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              placeholder="123 Main St, Toronto"
              value={customer.address}
              onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Products</h3>
        {items.map((item, idx) => {
          const fabrics = getAvailableFabrics(item.product);
          const p = pricedItems[idx];
          return (
            <div key={item.id} className="rounded-xl border border-border bg-white/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground">
                  #{idx + 1}
                </span>
                {items.length > 1 && (
                  <button
                    onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                    className="rounded p-1 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Room</Label>
                  <Input
                    placeholder="Living Room"
                    value={item.room}
                    onChange={(e) => updateItem(item.id, "room", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Product</Label>
                  <div className="relative">
                    <select
                      value={item.product}
                      onChange={(e) => updateItem(item.id, "product", e.target.value)}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm appearance-none"
                    >
                      {ALL_PRODUCTS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Fabric</Label>
                  <div className="relative">
                    <select
                      value={item.fabric}
                      onChange={(e) => updateItem(item.id, "fabric", e.target.value)}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm appearance-none"
                    >
                      {fabrics.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-end gap-1">
                  <div className="space-y-1 flex-1">
                    <Label className="text-[11px]">Width (in)</Label>
                    <Input
                      type="number"
                      step="0.0625"
                      value={item.widthIn || ""}
                      onChange={(e) => updateItem(item.id, "widthIn", parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <span className="pb-2 text-muted-foreground">×</span>
                  <div className="space-y-1 flex-1">
                    <Label className="text-[11px]">Height (in)</Label>
                    <Input
                      type="number"
                      step="0.0625"
                      value={item.heightIn || ""}
                      onChange={(e) => updateItem(item.id, "heightIn", parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={item.cordless}
                    onChange={(e) => updateItem(item.id, "cordless", e.target.checked)}
                    className="rounded border-border"
                  />
                  Cordless (+15%)
                </label>
                {p?.pricing && (
                  <span className="text-sm font-semibold text-emerald-700">
                    {formatCAD(p.pricing.price)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <button
          onClick={() => setItems((prev) => [...prev, newItem()])}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:border-teal-300 hover:text-teal-700 transition-colors"
        >
          <Plus size={16} />
          Add Item
        </button>
      </div>

      {/* Install mode */}
      <div className="flex items-center gap-3">
        <Label className="text-sm">Installation:</Label>
        <div className="flex gap-2">
          {(["default", "pickup"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setInstallMode(mode)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm transition-colors",
                installMode === mode
                  ? "border-teal-400 bg-teal-50 text-teal-800 font-medium"
                  : "border-border text-muted-foreground hover:border-teal-200"
              )}
            >
              {mode === "default" ? "With Install" : "Pick Up"}
            </button>
          ))}
        </div>
      </div>

      {/* Totals */}
      {totals && (
        <div className="rounded-xl border-2 border-teal-200 bg-gradient-to-br from-teal-50/80 to-white p-5">
          <h3 className="text-base font-bold mb-3">Quote Summary</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Merchandise</span>
              <span>{formatCAD(totals.merchSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Installation</span>
              <span>{formatCAD(totals.installApplied)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery</span>
              <span>{formatCAD(totals.deliveryFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">HST ({(totals.taxRate * 100).toFixed(0)}%)</span>
              <span>{formatCAD(totals.taxAmount)}</span>
            </div>
            <div className="flex justify-between items-center text-lg font-bold text-teal-700 border-t border-teal-200 pt-2">
              <span>TOTAL</span>
              <span>{formatCAD(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Pencil Notes */}
      <div className="space-y-2">
        <button
          onClick={() => setShowNotes((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil size={16} />
          {showNotes ? "Hide Notes / Sketches" : "Add Notes / Sketches (Apple Pencil)"}
        </button>
        {showNotes && (
          <PencilCanvas
            ref={notesRef}
            width={1000}
            height={400}
            label="Handwritten notes, window sketches, special instructions"
          />
        )}
      </div>

      {/* Signature */}
      <div className="space-y-2">
        <button
          onClick={() => setShowSignature((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil size={16} />
          {showSignature ? "Hide Signature" : "Customer Signature (Apple Pencil)"}
        </button>
        {showSignature && (
          <PencilCanvas
            ref={signatureRef}
            width={600}
            height={200}
            label="Customer signature"
          />
        )}
      </div>

      {/* Action bar */}
      <div className="sticky bottom-4 z-10">
        <div className="rounded-xl border border-border bg-white/95 shadow-lg backdrop-blur-sm p-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {!isOnline && (
              <span className="text-amber-600 mr-2">
                [Offline]
              </span>
            )}
            {totals ? (
              <span>
                {totals.itemResults.length} items ·{" "}
                <span className="font-bold text-teal-700">{formatCAD(totals.grandTotal)}</span>
              </span>
            ) : (
              "Add items to see pricing"
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={saving || !customer.name.trim()}
            >
              <Save className="h-4 w-4 mr-1" />
              {saved ? "Saved!" : "Save"}
            </Button>
            <Button onClick={handleExportPDF} disabled={!totals}>
              <FileDown className="h-4 w-4 mr-1" />
              Export PDF
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
