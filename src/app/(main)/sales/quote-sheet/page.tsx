"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  FileDown,
  Save,
  ClipboardList,
  Package,
  Wrench,
  Blinds,
  PanelTopOpen,
  Columns3,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import type { QuoteItemInput } from "@/lib/blinds/pricing-types";

import type {
  PartALine,
  PartBAddon,
  PaymentMethod,
  PartCService,
  PartCAddOn,
  ShadeOrderLine,
  ShutterOrderLine,
  DrapeOrderLine,
  QuoteFormState,
} from "./types";
import { INSTALL_PRICES, SERVICE_ADDONS, MIN_INSTALL_CHARGE, DELIVERY_FEE, HST_RATE, generateOrderNumber } from "./types";

import { PartAForm, makeEmptyLine } from "./part-a";
import { PartBForm } from "./part-b";
import { PartCForm, calcSubtotalC } from "./part-c";
import { OrderShadesForm } from "./order-shades";
import { OrderShuttersForm } from "./order-shutters";
import { OrderDrapesForm } from "./order-drapes";

type TabId = "partA" | "partB" | "partC" | "shades" | "shutters" | "drapes";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "partA", label: "Part A", icon: <ClipboardList className="h-4 w-4" /> },
  { id: "partB", label: "Part B", icon: <Package className="h-4 w-4" /> },
  { id: "partC", label: "Part C", icon: <Wrench className="h-4 w-4" /> },
  { id: "shades", label: "Shades", icon: <Blinds className="h-4 w-4" /> },
  { id: "shutters", label: "Shutters", icon: <PanelTopOpen className="h-4 w-4" /> },
  { id: "drapes", label: "Drapes", icon: <Columns3 className="h-4 w-4" /> },
];

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
}

function makeDefaultServices(): PartCService[] {
  return Object.values(INSTALL_PRICES).map((ip) => ({
    type: ip.label,
    priceLabel: `$${ip.price}`,
    unitPrice: ip.price,
    qty: 0,
    total: 0,
  }));
}

function makeDefaultAddOns(): PartCAddOn[] {
  return Object.values(SERVICE_ADDONS).map((sa) => ({
    type: sa.label,
    qty: 0,
    unitPrice: sa.price,
    total: 0,
  }));
}

function makeShadeLines(count: number): ShadeOrderLine[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(), location: "", widthWhole: "", widthFrac: "0",
    heightWhole: "", heightFrac: "0", sku: "", mount: "" as const,
    lift: "" as const, bracket: "" as const, valance: "", note: "",
  }));
}

function makeShutterLines(count: number): ShutterOrderLine[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(), location: "", widthWhole: "", widthFrac: "0",
    heightWhole: "", heightFrac: "0", frame: "", openDirection: "",
    mountType: "", midRail: false, panelCount: null, draft: "",
  }));
}

function makeDrapeLines(count: number): DrapeOrderLine[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(), location: "",
    drapeWidthWhole: "", drapeWidthFrac: "0", drapeHeightWhole: "", drapeHeightFrac: "0",
    drapeFabricSku: "", drapeFullness: "180" as const, drapePanels: "S" as const,
    drapePleatStyle: "" as const, drapeLiner: false, drapeBracket: "" as const,
    sheerWidthWhole: "", sheerWidthFrac: "0", sheerHeightWhole: "", sheerHeightFrac: "0",
    sheerFabricSku: "", sheerFullness: "180" as const, sheerPanels: "S" as const,
    sheerPleatStyle: "" as const, sheerBracket: "" as const,
    accessoriesSku: "", note: "",
  }));
}

export default function QuoteSheetPage() {
  const [activeTab, setActiveTab] = useState<TabId>("partA");
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ time: string; orderNum: string; statusAdvanced?: boolean; quoteId?: string } | null>(null);

  // Customer selector
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [heardUsOn, setHeardUsOn] = useState("");

  // Opportunity selector
  const [opportunities, setOpportunities] = useState<{ id: string; title: string; stage: string }[]>([]);
  const [opportunityId, setOpportunityId] = useState("");

  // Order info
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [salesRep, setSalesRep] = useState("");
  const [measureSequence, setMeasureSequence] = useState(1);

  // Part A — start with 3 cards, user can add more
  const [partALines, setPartALines] = useState<PartALine[]>(() =>
    Array.from({ length: 3 }, () => makeEmptyLine())
  );

  // Part B
  const [partBAddons, setPartBAddons] = useState<PartBAddon[]>([]);
  const [partBNotes, setPartBNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("direct");
  const [depositAmount, setDepositAmount] = useState("");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [financeEligible, setFinanceEligible] = useState("");
  const [financeApproved, setFinanceApproved] = useState("");
  const [financeDifference, setFinanceDifference] = useState("");

  // Part C
  const [partCServices, setPartCServices] = useState<PartCService[]>(makeDefaultServices);
  const [partCAddOns, setPartCAddOns] = useState<PartCAddOn[]>(makeDefaultAddOns);

  // Order forms
  const [shadeOrders, setShadeOrders] = useState<ShadeOrderLine[]>(() => makeShadeLines(15));
  const [shutterOrders, setShutterOrders] = useState<ShutterOrderLine[]>(() => makeShutterLines(20));
  const [drapeOrders, setDrapeOrders] = useState<DrapeOrderLine[]>(() => makeDrapeLines(6));

  // Shutters/Shades global options
  const [shutterMaterial, setShutterMaterial] = useState<"Wooden" | "Vinyl">("Wooden");
  const [shutterLouverSize, setShutterLouverSize] = useState('3-1/2"');
  const [shadeValanceType, setShadeValanceType] = useState("");
  const [shadeBracketType, setShadeBracketType] = useState("");

  // Signatures
  const sigPartBRef = useRef<PencilCanvasRef>(null);
  const sigPartCRef = useRef<PencilCanvasRef>(null);
  const sigShadesRef = useRef<PencilCanvasRef>(null);
  const sigShuttersRef = useRef<PencilCanvasRef>(null);
  const sigDrapesRef = useRef<PencilCanvasRef>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{ customers?: CustomerOption[] }>("/api/sales/customers?limit=200");
        setCustomers((d.customers ?? []) as CustomerOption[]);
      } catch { /* ignore */ }
    })();
  }, []);

  const handleCustomerSelect = useCallback(async (id: string) => {
    setCustomerId(id);
    setLastSaved(null);
    setOpportunityId("");
    setOpportunities([]);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerPhone(c.phone ?? "");
      setCustomerEmail(c.email ?? "");
      setCustomerAddress(c.address ?? "");
      setHeardUsOn(c.source ?? "");

      try {
        const data = await apiJson<{ opportunities?: { id: string; title: string; stage: string }[] }>(`/api/sales/customers/${id}/opportunities`);
        const opps = (data.opportunities ?? []) as { id: string; title: string; stage: string }[];
        setOpportunities(opps);
        if (opps.length === 1) setOpportunityId(opps[0].id);
      } catch { /* ignore */ }
    } else {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setCustomerAddress("");
      setHeardUsOn("");
    }
  }, [customers]);

  // Calculations
  const subtotalA = useMemo(
    () => partALines.reduce((s, l) => s + (l.price ?? 0), 0),
    [partALines]
  );
  const subtotalC = useMemo(
    () => calcSubtotalC(partCServices, partCAddOns),
    [partCServices, partCAddOns]
  );
  const subtotalB = useMemo(
    () => partBAddons.reduce((s, a) => s + a.total, 0),
    [partBAddons]
  );

  // Auto-generate order number
  const orderNumber = useMemo(() => {
    if (!salesRep) return "";
    return generateOrderNumber({
      date: new Date(date),
      measureSequence,
      lines: partALines,
      salesRepInitials: salesRep,
    });
  }, [date, measureSequence, partALines, salesRep]);

  const handleSave = useCallback(async () => {
    if (!customerId) return;
    setSaving(true);
    try {
      const filledLines = partALines.filter((l) => l.product && l.fabric && l.widthIn && l.heightIn);
      if (filledLines.length === 0) {
        console.error("Save failed: no valid Part A lines");
        return;
      }

      const items: QuoteItemInput[] = filledLines.flatMap((line) => {
        const qty = Math.max(1, line.panelCount);
        const item: QuoteItemInput = {
          product: line.product as QuoteItemInput["product"],
          fabric: line.fabric,
          widthIn: line.widthIn!,
          heightIn: line.heightIn!,
          cordless: line.cordless,
          discountOverridePct: line.discountOverride,
          location: line.roomName,
          sku: line.fabric,
        };
        return Array.from({ length: qty }, () => ({ ...item }));
      });

      const fullFormData: QuoteFormState = {
        orderNumber, date, customerId, customerName, customerPhone,
        customerEmail, customerAddress, heardUsOn, salesRep, measureSequence,
        partALines: filledLines,
        partBAddons, partBNotes, paymentMethod, depositAmount, balanceAmount,
        financeEligible, financeApproved, financeDifference,
        partCServices, partCAddOns,
        shadeOrders: shadeOrders.filter((l) => l.location),
        shutterOrders: shutterOrders.filter((l) => l.location),
        drapeOrders: drapeOrders.filter((l) => l.location),
        shutterMaterial, shutterLouverSize, shadeValanceType, shadeBracketType,
      };

      const res = await apiFetch("/api/sales/quotes", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          opportunityId: opportunityId || undefined,
          items,
          orderNumber,
          formDataJson: JSON.stringify(fullFormData),
        }),
      }).then((r) => r.json());

      const statusAdvanced = res.lifecycle?.autoAdvanced ?? false;
      setLastSaved({
        time: new Date().toLocaleTimeString("en-CA"),
        orderNum: orderNumber,
        statusAdvanced,
        quoteId: res.quote?.id,
      });
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [
    orderNumber, date, customerId, opportunityId, customerName, customerPhone,
    customerEmail, customerAddress, heardUsOn, salesRep, measureSequence,
    partALines, partBAddons, partBNotes, paymentMethod, depositAmount, balanceAmount,
    financeEligible, financeApproved, financeDifference, partCServices, partCAddOns,
    shadeOrders, shutterOrders, drapeOrders, shutterMaterial, shutterLouverSize,
    shadeValanceType, shadeBracketType,
  ]);

  const handleSendEmail = useCallback(async () => {
    if (!lastSaved?.quoteId || !customerEmail) return;
    setSendingEmail(true);
    try {
      const res = await apiFetch(`/api/sales/quotes/${lastSaved.quoteId}/send-email`, {
        method: "POST",
        body: JSON.stringify({ to: customerEmail, lang: "en" }),
      }).then((r) => r.json());
      if (res.messageId || res.status === "sent") {
        setLastSaved((prev) => prev ? { ...prev, emailSent: true } as typeof prev : prev);
      }
    } catch (err) {
      console.error("Email send failed:", err);
    } finally {
      setSendingEmail(false);
    }
  }, [lastSaved?.quoteId, customerEmail]);

  // PDF export
  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = 15;

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("SUNNY SHUTTER INC.", margin, y);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("2-680 Progress Avenue, Scarborough, ON, M1H 3A5", margin, y + 5);
    doc.text("Tel: 647-85-SUNNY(78669) | www.sunnyshutter.ca", margin, y + 9);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Order: ${orderNumber}`, pageW - margin - 60, y);
    doc.text(`Date: ${date}`, pageW - margin - 60, y + 5);
    doc.text(`Customer: ${customerName}`, pageW - margin - 60, y + 10);
    if (salesRep) doc.text(`Sales Rep: ${salesRep}`, pageW - margin - 60, y + 15);
    y += 22;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Address: ${customerAddress}`, margin, y);
    doc.text(`Phone: ${customerPhone}   Email: ${customerEmail}`, margin, y + 4);
    y += 10;

    // Part A
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PART A", margin, y);
    y += 2;

    const filledLines = partALines.filter((l) => l.product && l.price);
    if (filledLines.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: [0, 128, 128], fontSize: 6 },
        bodyStyles: { fontSize: 6 },
        head: [["#", "Room", "Product", "Fabric", "W\"", "H\"", "Qty", "Mount", "MSRP", "Disc%", "Price"]],
        body: filledLines.map((l, i) => [
          i + 1,
          l.roomName,
          l.product,
          l.fabric,
          l.widthIn ?? "",
          l.heightIn ?? "",
          l.panelCount,
          [l.mount, l.lift, l.bracket].filter(Boolean).join("/"),
          l.msrp?.toFixed(0) ?? "",
          l.discountPct ? `${(l.discountPct * 100).toFixed(0)}%` : "",
          l.price?.toFixed(2) ?? "",
        ]),
      });
      y = (doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 20;
    }

    y += 4;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`SUBTOTAL (A): ${formatCAD(subtotalA)}`, pageW - margin - 50, y);
    y += 8;

    // Part B
    if (partBAddons.length > 0) {
      doc.setFontSize(11);
      doc.text("PART B — Add-ons", margin, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: [0, 128, 128], fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        head: [["SKU / Item", "QTY", "Price", "Total"]],
        body: partBAddons.map((a) => [a.skuItem, a.qty, `$${a.price.toFixed(2)}`, `$${a.total.toFixed(2)}`]),
      });
      y = (doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 15;
      y += 3;
      doc.setFontSize(9);
      doc.text(`SUBTOTAL (B): ${formatCAD(subtotalB)}`, pageW - margin - 50, y);
      y += 6;
    }

    // Totals
    const preTax = subtotalA + subtotalB + subtotalC;
    const hst = Math.round(preTax * HST_RATE * 100) / 100;
    const total = preTax + hst;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`GRAND SUBTOTAL (A+B): ${formatCAD(subtotalA + subtotalB)}`, margin, y); y += 5;
    doc.text(`SUBTOTAL (C): ${formatCAD(subtotalC)}`, margin, y); y += 5;
    doc.text(`HST (13%): ${formatCAD(hst)}`, margin, y); y += 5;
    doc.setFontSize(11);
    doc.text(`TOTAL: ${formatCAD(total)}`, margin, y); y += 8;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    if (paymentMethod === "direct") {
      doc.text(`Payment: Direct — Deposit: ${depositAmount} / Balance: ${balanceAmount}`, margin, y);
    } else {
      doc.text(`Payment: Financeit — Eligible: ${financeEligible} / Approved: ${financeApproved}`, margin, y);
    }
    y += 6;

    try {
      const sigData = sigPartBRef.current?.toDataURL();
      if (sigData) {
        doc.text("Signature:", margin, y);
        doc.addImage(sigData, "PNG", margin, y + 1, 60, 15);
      }
    } catch { /* no sig */ }

    // Terms page
    doc.addPage();
    y = 15;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Sunny Shutter Inc. - Key Terms of Service Agreement", margin, y);
    y += 7;
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    const terms = [
      "Validity of this quote: 15 days from the date of issuance.",
      "2-hour delivery window will be provided 2 days before the scheduled date.",
      "Rescheduling must be requested at least 3 business days before the scheduled date.",
      "The normal lead time for custom items is approximately 3-4 weeks.",
      "Installation will only be scheduled after the entire balance is received.",
      "Custom-made items, returns or exchanges are only accepted if the product is defective.",
      "Our products are designed to fit standard, straight window frames.",
    ];
    terms.forEach((t) => {
      doc.text(`• ${t}`, margin, y, { maxWidth: pageW - margin * 2 });
      y += 5;
    });

    doc.save(`Quote_${orderNumber || "draft"}_${date}.pdf`);
  }, [
    orderNumber, date, customerName, customerPhone, customerEmail, customerAddress,
    salesRep, partALines, subtotalA, partBAddons, subtotalB, paymentMethod, depositAmount,
    balanceAmount, financeEligible, financeApproved, partCServices, partCAddOns, subtotalC,
  ]);

  const grandTotal = subtotalA + subtotalB + subtotalC + Math.round((subtotalA + subtotalB + subtotalC) * HST_RATE * 100) / 100;

  return (
    <div className="space-y-6 pb-32">
      <PageHeader
        title="Quote Sheet"
        description="Sunny Shutter Inc. — Digital Quote & Order Form"
      />

      {/* Customer selector + Order info */}
      <div className="rounded-xl border border-border bg-white/60 backdrop-blur p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Customer & Order Info</h2>
          <div className="flex items-center gap-2">
            {lastSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <CheckCircle className="h-3.5 w-3.5" />
                Saved: {lastSaved.orderNum} at {lastSaved.time}
                {lastSaved.statusAdvanced && " · Status → 已报价"}
              </span>
            )}
          </div>
        </div>

        {/* Customer selector */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label className="text-xs">Select Customer</Label>
            <div className="relative mt-1">
              <select
                value={customerId}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 pr-8 text-sm appearance-none min-h-[44px]"
              >
                <option value="">— Select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` (${c.phone})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          {!customerId && (
            <span className="flex items-center gap-1 text-xs text-amber-600 pb-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              Please select a customer to save
            </span>
          )}
          {opportunities.length > 1 && (
            <div className="w-56">
              <Label className="text-xs">Opportunity</Label>
              <div className="relative mt-1">
                <select
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 pr-8 text-sm appearance-none min-h-[44px]"
                >
                  <option value="">— Auto-link —</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({o.stage})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Customer Name</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1" placeholder="Full name" />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
              className="mt-1" placeholder="Phone" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
              className="mt-1" placeholder="Email" />
          </div>
          <div>
            <Label className="text-xs">Heard Us On</Label>
            <Input value={heardUsOn} onChange={(e) => setHeardUsOn(e.target.value)}
              className="mt-1" placeholder="Referral" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Address</Label>
            <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)}
              className="mt-1" placeholder="Full address" />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Sales Rep</Label>
              <Input value={salesRep} onChange={(e) => setSalesRep(e.target.value)}
                className="mt-1" placeholder="e.g. Alex" />
            </div>
            <div className="w-16">
              <Label className="text-xs">Meas #</Label>
              <Input type="number" min={1} value={measureSequence}
                onChange={(e) => setMeasureSequence(parseInt(e.target.value) || 1)}
                className="mt-1 text-center" />
            </div>
          </div>
        </div>

        {/* Order Number */}
        {orderNumber && (
          <div className="flex items-center gap-3 rounded-lg bg-teal-50 border border-teal-200 px-4 py-2.5">
            <span className="text-xs text-muted-foreground font-medium">Order #:</span>
            <span className="text-sm font-bold text-teal-700 font-mono tracking-wide">
              {orderNumber}
            </span>
            <button onClick={() => {
              navigator.clipboard.writeText(orderNumber);
            }} className="ml-auto text-xs text-teal-600 hover:text-teal-800 font-medium">
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
              activeTab === tab.id
                ? "bg-teal-600 text-white shadow-md"
                : "bg-white/60 text-muted-foreground hover:bg-teal-50 border border-border"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-border bg-white/60 backdrop-blur p-5">
        {activeTab === "partA" && (
          <PartAForm lines={partALines} onChange={setPartALines} />
        )}
        {activeTab === "partB" && (
          <PartBForm
            addons={partBAddons} onAddonsChange={setPartBAddons}
            notes={partBNotes} onNotesChange={setPartBNotes}
            paymentMethod={paymentMethod} onPaymentMethodChange={setPaymentMethod}
            depositAmount={depositAmount} onDepositChange={setDepositAmount}
            balanceAmount={balanceAmount} onBalanceChange={setBalanceAmount}
            financeEligible={financeEligible} onFinanceEligibleChange={setFinanceEligible}
            financeApproved={financeApproved} onFinanceApprovedChange={setFinanceApproved}
            financeDifference={financeDifference} onFinanceDifferenceChange={setFinanceDifference}
            subtotalA={subtotalA} subtotalC={subtotalC} signatureRef={sigPartBRef}
          />
        )}
        {activeTab === "partC" && (
          <PartCForm services={partCServices} onServicesChange={setPartCServices}
            addOns={partCAddOns} onAddOnsChange={setPartCAddOns} signatureRef={sigPartCRef} />
        )}
        {activeTab === "shades" && (
          <OrderShadesForm lines={shadeOrders} onChange={setShadeOrders}
            valanceType={shadeValanceType} onValanceTypeChange={setShadeValanceType}
            bracketType={shadeBracketType} onBracketTypeChange={setShadeBracketType}
            signatureRef={sigShadesRef} />
        )}
        {activeTab === "shutters" && (
          <OrderShuttersForm lines={shutterOrders} onChange={setShutterOrders}
            material={shutterMaterial} onMaterialChange={setShutterMaterial}
            louverSize={shutterLouverSize} onLouverSizeChange={setShutterLouverSize}
            signatureRef={sigShuttersRef} />
        )}
        {activeTab === "drapes" && (
          <OrderDrapesForm lines={drapeOrders} onChange={setDrapeOrders}
            signatureRef={sigDrapesRef} />
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-border px-4 py-3 flex items-center justify-between z-50 safe-area-bottom">
        <div className="text-sm space-y-0.5">
          {orderNumber && (
            <div className="text-[10px] text-muted-foreground font-mono">{orderNumber}</div>
          )}
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="text-lg font-bold text-teal-700">{formatCAD(grandTotal)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1.5">
            <FileDown className="h-4 w-4" /> Export PDF
          </Button>
          {lastSaved?.quoteId && customerEmail && (
            <Button variant="outline" size="sm" onClick={handleSendEmail}
              disabled={sendingEmail}
              className="gap-1.5">
              {sendingEmail ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sendingEmail ? "Sending..." : "Email to Customer"}
            </Button>
          )}
          <Button size="sm" onClick={handleSave}
            disabled={saving || !customerId}
            className="gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save & Update Status"}
          </Button>
        </div>
      </div>
    </div>
  );
}
