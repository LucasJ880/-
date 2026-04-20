"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  FileDown,
  Save,
  Package,
  Wrench,
  Wrench as InstallIcon,
  Truck,
  Blinds,
  PanelTopOpen,
  Columns3,
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Send,
  Sparkles,
  FileClock,
  X,
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
  InstallMode,
} from "./types";
import { INSTALL_PRICES, SERVICE_ADDONS, MIN_INSTALL_CHARGE, DELIVERY_FEE, HST_RATE, generateOrderNumber } from "./types";

import { PartAForm, makeEmptyLine } from "./part-a";
import { PartBForm } from "./part-b";
import { PartCForm, calcSubtotalC } from "./part-c";
import { OrderShadesForm } from "./order-shades";
import { OrderShuttersForm } from "./order-shutters";
import { OrderDrapesForm } from "./order-drapes";
import {
  sumShadeTotals,
  sumShutterTotals,
  sumDrapeTotals,
  sumAllMsrp,
  type DiscountsOverride,
} from "./pricing-helpers";
import { fractionToInches } from "./types";
import { exportQuotePdf, loadLogoAsDataUrl } from "./quote-pdf";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  isDraftMeaningful,
  formatDraftAge,
  type QuoteDraftV1,
} from "./quote-draft";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

// Part A 已从主流程隐藏（保留数据结构以便老单还能打开），
// Tab、主页显示、总价和 PDF 输出都不再包含 Part A。
type TabId = "partB" | "partC" | "shades" | "shutters" | "drapes";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "shades", label: "Shades", icon: <Blinds className="h-4 w-4" /> },
  { id: "shutters", label: "Shutters", icon: <PanelTopOpen className="h-4 w-4" /> },
  { id: "drapes", label: "Drapes", icon: <Columns3 className="h-4 w-4" /> },
  { id: "partB", label: "Part B", icon: <Package className="h-4 w-4" /> },
  { id: "partC", label: "Part C", icon: <Wrench className="h-4 w-4" /> },
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
    heightWhole: "", heightFrac: "0", product: "Zebra" as const, sku: "", mount: "" as const,
    lift: "" as const, bracket: "" as const, valance: "", note: "",
  }));
}

function makeShutterLines(count: number): ShutterOrderLine[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(), location: "", widthWhole: "", widthFrac: "0",
    heightWhole: "", heightFrac: "0", frame: "", openDirection: "",
    mountType: "", midRail: "", panelCount: null, draft: "",
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
  const [activeTab, setActiveTab] = useState<TabId>("shades");
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedFlash, setGeneratedFlash] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{ time: string; orderNum: string; statusAdvanced?: boolean; quoteId?: string } | null>(null);

  // Customer selector
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  // 同一客户可能有多个历史地址（老客户新地址），这里存候选列表供选择
  const [customerAddressOptions, setCustomerAddressOptions] = useState<string[]>([]);
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
  const [specialPromotion, setSpecialPromotion] = useState(""); // Step 4：销售手填让利金额（税前直减）

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

  // Install mode (default = installation, pickup = no install fee)
  const [installMode, setInstallMode] = useState<InstallMode>("default");

  // Signatures
  const sigPartBRef = useRef<PencilCanvasRef>(null);
  const sigPartCRef = useRef<PencilCanvasRef>(null);
  const sigShadesRef = useRef<PencilCanvasRef>(null);
  const sigShuttersRef = useRef<PencilCanvasRef>(null);
  const sigDrapesRef = useRef<PencilCanvasRef>(null);

  // 每个 tab 的"是否已签名"状态（任一有笔画即可解锁"生成报价单"）
  const [sigPartBCount, setSigPartBCount] = useState(0);
  const [sigPartCCount, setSigPartCCount] = useState(0);
  const [sigShadesCount, setSigShadesCount] = useState(0);
  const [sigShuttersCount, setSigShuttersCount] = useState(0);
  const [sigDrapesCount, setSigDrapesCount] = useState(0);
  const hasAnySignature =
    sigPartBCount + sigPartCCount + sigShadesCount + sigShuttersCount + sigDrapesCount > 0;

  // ── localStorage 草稿（防丢失）───────────────────────────────────
  // 发现待恢复草稿时，在页面顶部显示横幅由用户决定"恢复 / 丢弃"
  const [pendingDraft, setPendingDraft] = useState<QuoteDraftV1 | null>(null);
  // 首屏检查完成前不允许自动保存，避免把刚挂载的空表覆盖掉尚未恢复的草稿
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    const d = loadDraft();
    if (d && isDraftMeaningful(d)) {
      setPendingDraft(d);
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{ customers?: CustomerOption[] }>("/api/sales/customers?limit=200");
        setCustomers((d.customers ?? []) as CustomerOption[]);
      } catch { /* ignore */ }
    })();
  }, []);

  // 自动带入销售个人设置里的 Sales Rep 代号（在驾驶舱填写）
  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{ salesRepInitials?: string }>(
          "/api/users/me/sales-settings"
        );
        if (d.salesRepInitials) {
          setSalesRep((prev) => (prev ? prev : d.salesRepInitials!));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // 拉取全局折扣率 & Special Promotion 阈值（Order Form / AI 工具 共用数据源）
  const [discounts, setDiscounts] = useState<DiscountsOverride | undefined>(undefined);
  const [promoWarnPct, setPromoWarnPct] = useState(0.06);
  const [promoDangerPct, setPromoDangerPct] = useState(0.15);
  const [promoMaxPct, setPromoMaxPct] = useState(0.25);
  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{
          zebra: number; shangrila: number; cellular: number; roller: number;
          drapery: number; sheer: number; shutters: number; honeycomb: number;
          promoWarnPct?: number; promoDangerPct?: number; promoMaxPct?: number;
        }>("/api/sales/quote-settings/discounts");
        setDiscounts({
          Zebra: d.zebra,
          SHANGRILA: d.shangrila,
          "Cordless Cellular": d.cellular,
          Roller: d.roller,
          Drapery: d.drapery,
          Sheer: d.sheer,
          Shutters: d.shutters,
          SkylightHoneycomb: d.honeycomb,
        });
        if (typeof d.promoWarnPct === "number") setPromoWarnPct(d.promoWarnPct);
        if (typeof d.promoDangerPct === "number") setPromoDangerPct(d.promoDangerPct);
        if (typeof d.promoMaxPct === "number") setPromoMaxPct(d.promoMaxPct);
      } catch {
        // 拉取失败时保留默认值
      }
    })();
  }, []);

  // 当前用户角色 —— admin/super_admin 不受 promoMaxPct 约束
  const { isSuperAdmin } = useCurrentUser();

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
      // 老客户多地址：切成数组，默认第一条，剩下的放候选
      const addrs = (c.address ?? "")
        .split(/\r?\n|;/)
        .map((s) => s.trim())
        .filter(Boolean);
      setCustomerAddressOptions(addrs);
      setCustomerAddress(addrs[0] ?? "");
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
      setCustomerAddressOptions([]);
      setHeardUsOn("");
    }
  }, [customers]);

  // Calculations
  // Part A 已从总价/Tab/PDF 全部隐藏，数据结构暂留以便老单打开
  const subtotalC = useMemo(
    () => (installMode === "pickup" ? 0 : calcSubtotalC(partCServices, partCAddOns)),
    [partCServices, partCAddOns, installMode]
  );
  const subtotalB = useMemo(
    () => partBAddons.reduce((s, a) => s + a.total, 0),
    [partBAddons]
  );
  // 新主档：三个电子订单表的小计
  const shadeTotals = useMemo(
    () => sumShadeTotals(shadeOrders, installMode, discounts),
    [shadeOrders, installMode, discounts]
  );
  const shutterTotals = useMemo(
    () => sumShutterTotals(shutterOrders, shutterMaterial, installMode, discounts),
    [shutterOrders, shutterMaterial, installMode, discounts]
  );
  const drapeTotals = useMemo(
    () => sumDrapeTotals(drapeOrders, installMode, discounts),
    [drapeOrders, installMode, discounts]
  );
  const productsSubtotal =
    shadeTotals.total + shutterTotals.total + drapeTotals.total;

  // Step 4：折扣率追踪 —— 提前计算，供 handleSave 引用
  const specialPromotionNum = Math.max(0, parseFloat(specialPromotion) || 0);
  const totalMsrp = useMemo(
    () => sumAllMsrp(shadeOrders, shutterOrders, shutterMaterial, drapeOrders),
    [shadeOrders, shutterOrders, shutterMaterial, drapeOrders],
  );
  const finalDiscountPct = totalMsrp > 0
    ? Math.max(0, Math.min(1, 1 - Math.max(0, productsSubtotal - specialPromotionNum) / totalMsrp))
    : 0;

  // Special Promotion 硬门槛：ratio > promoMaxPct 时，非 admin 禁止保存/生成
  const productsPreTax = productsSubtotal + subtotalC;
  const promoRatio = productsPreTax > 0 ? specialPromotionNum / productsPreTax : 0;
  const promoBlocked = !isSuperAdmin && promoRatio > promoMaxPct;

  // 客户当日序号（由后端按「该销售今日接触的 distinct 客户顺序」分配）
  // - 选中客户 + date 变化时拉取
  // - 未选客户或 API 未返回时 = 0（order# 用 ?? 占位）
  const [customerDailySeq, setCustomerDailySeq] = useState(0);
  useEffect(() => {
    if (!customerId) {
      setCustomerDailySeq(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ seq: number }>(
          `/api/sales/quote-sheet/customer-daily-seq?customerId=${encodeURIComponent(customerId)}&date=${encodeURIComponent(date)}`
        );
        if (!cancelled && typeof d?.seq === "number") {
          setCustomerDailySeq(d.seq);
        }
      } catch {
        if (!cancelled) setCustomerDailySeq(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, date]);

  // Auto-generate order number（新规则：基于 Shades/Shutters/Drapes/PartB + 客户当日序号）
  const orderNumber = useMemo(() => {
    return generateOrderNumber({
      date: new Date(date),
      customerSeq: customerDailySeq,
      shadeOrders,
      shutterOrders,
      drapeOrders,
      partBAddons,
      shutterMaterial,
      salesRepInitials: salesRep,
      installMode,
    });
  }, [
    date,
    customerDailySeq,
    shadeOrders,
    shutterOrders,
    drapeOrders,
    partBAddons,
    shutterMaterial,
    salesRep,
    installMode,
  ]);

  // 自动保存草稿到 localStorage（debounce 1s），首屏检查完成后才启用
  useEffect(() => {
    if (!draftReady) return;
    if (pendingDraft) return; // 用户还没决定恢复/丢弃前，不要覆盖草稿
    const timer = setTimeout(() => {
      saveDraft({
        customerId, customerName, customerPhone, customerEmail, customerAddress,
        heardUsOn, opportunityId,
        date, salesRep, measureSequence,
        partALines,
        partBAddons, partBNotes, paymentMethod,
        depositAmount, balanceAmount, financeEligible, financeApproved, financeDifference,
        partCServices, partCAddOns,
        shadeOrders, shutterOrders, drapeOrders,
        shutterMaterial, shutterLouverSize, shadeValanceType, shadeBracketType,
        installMode,
        specialPromotion,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    draftReady, pendingDraft,
    customerId, customerName, customerPhone, customerEmail, customerAddress,
    heardUsOn, opportunityId,
    date, salesRep, measureSequence,
    partALines,
    partBAddons, partBNotes, paymentMethod,
    depositAmount, balanceAmount, financeEligible, financeApproved, financeDifference,
    partCServices, partCAddOns,
    shadeOrders, shutterOrders, drapeOrders,
    shutterMaterial, shutterLouverSize, shadeValanceType, shadeBracketType,
    installMode, specialPromotion,
  ]);

  // 当 customerId 或 customers 变化时派生候选地址列表
  // （handleRestoreDraft 或外部 query 串设置 customerId 时会触发）
  useEffect(() => {
    if (!customerId) {
      setCustomerAddressOptions([]);
      return;
    }
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    const addrs = (c.address ?? "")
      .split(/\r?\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    setCustomerAddressOptions(addrs);
  }, [customerId, customers]);

  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    const d = pendingDraft;
    setCustomerId(d.customerId);
    setCustomerName(d.customerName);
    setCustomerPhone(d.customerPhone);
    setCustomerEmail(d.customerEmail);
    setCustomerAddress(d.customerAddress);
    setHeardUsOn(d.heardUsOn);
    setOpportunityId(d.opportunityId);
    setDate(d.date);
    setSalesRep(d.salesRep);
    setMeasureSequence(d.measureSequence);
    setPartALines(d.partALines);
    setPartBAddons(d.partBAddons);
    setPartBNotes(d.partBNotes);
    setPaymentMethod(d.paymentMethod);
    setDepositAmount(d.depositAmount);
    setBalanceAmount(d.balanceAmount);
    setFinanceEligible(d.financeEligible);
    setFinanceApproved(d.financeApproved);
    setFinanceDifference(d.financeDifference);
    setPartCServices(d.partCServices);
    setPartCAddOns(d.partCAddOns);
    setShadeOrders(d.shadeOrders);
    // midRail 历史为 boolean，现统一为 string；兼容老草稿
    setShutterOrders(
      d.shutterOrders.map((l) => ({
        ...l,
        midRail:
          typeof l.midRail === "string"
            ? l.midRail
            : l.midRail
              ? "Yes"
              : "",
      })),
    );
    setDrapeOrders(d.drapeOrders);
    setShutterMaterial(d.shutterMaterial);
    setShutterLouverSize(d.shutterLouverSize);
    setShadeValanceType(d.shadeValanceType);
    setShadeBracketType(d.shadeBracketType);
    setInstallMode(d.installMode);
    if (typeof d.specialPromotion === "string") setSpecialPromotion(d.specialPromotion);
    setPendingDraft(null);
  }, [pendingDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setPendingDraft(null);
  }, []);

  const handleSave = useCallback(async (): Promise<{ quoteId: string } | null> => {
    if (!customerId) return null;
    // 硬门槛：Special Promotion 超过公司上限，非 admin 禁止提交
    if (promoBlocked) {
      alert(
        `Special Promotion 已达产品税前小计的 ${(promoRatio * 100).toFixed(1)}%，超过公司设定的最高让利上限 ${Math.round(promoMaxPct * 100)}%。\n\n请降低让利金额，或由管理员账号登录后提交。`,
      );
      return null;
    }
    setSaving(true);
    try {
      // 从三个电子订单表构造报价单 items（代替原来的 Part A 行）
      const items: QuoteItemInput[] = [];

      // Shades
      for (const l of shadeOrders) {
        if (!l.sku || !l.widthWhole || !l.heightWhole) continue;
        const w = fractionToInches(l.widthWhole, l.widthFrac);
        const h = fractionToInches(l.heightWhole, l.heightFrac);
        if (!w || !h) continue;
        items.push({
          product: l.product,
          fabric: l.sku,
          widthIn: w,
          heightIn: h,
          cordless: l.lift === "L" || l.lift === "R",
          location: l.location,
          sku: l.sku,
        });
      }

      // Shutters
      for (const l of shutterOrders) {
        if (!l.widthWhole || !l.heightWhole) continue;
        const w = fractionToInches(l.widthWhole, l.widthFrac);
        const h = fractionToInches(l.heightWhole, l.heightFrac);
        if (!w || !h) continue;
        const qty = Math.max(1, l.panelCount ?? 1);
        const base: QuoteItemInput = {
          product: "Shutters",
          fabric: shutterMaterial,
          widthIn: w,
          heightIn: h,
          location: l.location,
          sku: shutterMaterial,
        };
        for (let i = 0; i < qty; i++) items.push({ ...base });
      }

      // Drapes（每行可能包含 Drape 和/或 Sheer，分别作为 item）
      for (const l of drapeOrders) {
        if (l.drapeFabricSku && l.drapeWidthWhole && l.drapeHeightWhole) {
          const w = fractionToInches(l.drapeWidthWhole, l.drapeWidthFrac);
          const h = fractionToInches(l.drapeHeightWhole, l.drapeHeightFrac);
          if (w && h) {
            items.push({
              product: "Drapery",
              fabric: l.drapeFabricSku,
              widthIn: w,
              heightIn: h,
              location: l.location,
              sku: l.drapeFabricSku,
            });
          }
        }
        if (l.sheerFabricSku && l.sheerWidthWhole && l.sheerHeightWhole) {
          const w = fractionToInches(l.sheerWidthWhole, l.sheerWidthFrac);
          const h = fractionToInches(l.sheerHeightWhole, l.sheerHeightFrac);
          if (w && h) {
            items.push({
              product: "Sheer",
              fabric: l.sheerFabricSku,
              widthIn: w,
              heightIn: h,
              location: l.location,
              sku: l.sheerFabricSku,
            });
          }
        }
      }

      if (items.length === 0) {
        console.error("Save failed: please fill at least one Shade / Shutter / Drape line");
        alert("请至少在 Shades / Shutters / Drapes 中填写一行完整的尺寸和 SKU/材质");
        return null;
      }

      const fullFormData: QuoteFormState = {
        orderNumber, date, customerId, customerName, customerPhone,
        customerEmail, customerAddress, heardUsOn, salesRep, measureSequence,
        partALines,
        partBAddons, partBNotes, paymentMethod, depositAmount, balanceAmount,
        financeEligible, financeApproved, financeDifference,
        partCServices, partCAddOns,
        shadeOrders: shadeOrders.filter((l) => l.location || l.sku),
        shutterOrders: shutterOrders.filter((l) => l.location || l.widthWhole),
        drapeOrders: drapeOrders.filter((l) => l.location || l.drapeFabricSku || l.sheerFabricSku),
        shutterMaterial, shutterLouverSize, shadeValanceType, shadeBracketType,
        installMode,
      };

      const res = await apiFetch("/api/sales/quotes", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          opportunityId: opportunityId || undefined,
          items,
          installMode,
          orderNumber,
          formDataJson: JSON.stringify(fullFormData),
          // Step 4：折扣率追踪
          totalMsrp,
          specialPromotion: specialPromotionNum,
          finalDiscountPct,
        }),
      }).then((r) => r.json());

      const statusAdvanced = res.lifecycle?.autoAdvanced ?? false;
      const quoteId: string | undefined = res.quote?.id;
      setLastSaved({
        time: new Date().toLocaleTimeString("en-CA"),
        orderNum: orderNumber,
        statusAdvanced,
        quoteId,
      });
      // 后端已持久化，本地草稿使命完成
      clearDraft();
      return quoteId ? { quoteId } : null;
    } catch (err) {
      console.error("Save failed:", err);
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    orderNumber, date, customerId, opportunityId, customerName, customerPhone,
    customerEmail, customerAddress, heardUsOn, salesRep, measureSequence,
    installMode,
    partALines, partBAddons, partBNotes, paymentMethod, depositAmount, balanceAmount,
    financeEligible, financeApproved, financeDifference, partCServices, partCAddOns,
    shadeOrders, shutterOrders, drapeOrders, shutterMaterial, shutterLouverSize,
    shadeValanceType, shadeBracketType,
    totalMsrp, specialPromotionNum, finalDiscountPct,
    promoBlocked, promoRatio, promoMaxPct,
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

  // PDF export — 委托给 ./quote-pdf 模块（橙色品牌四页式设计）
  const handleExportPDF = useCallback(async () => {
    const logoDataUrl = await loadLogoAsDataUrl("/logo.png");
    let signatureDataUrl: string | null = null;
    try {
      signatureDataUrl = sigPartBRef.current?.toDataURL() ?? null;
    } catch {
      signatureDataUrl = null;
    }

    await exportQuotePdf({
      orderNumber,
      date,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      salesRep,
      installMode,
      shadeOrders,
      shutterOrders,
      shutterMaterial,
      shutterLouverSize,
      drapeOrders,
      partBAddons,
      partCServices,
      partCAddOns,
      subtotalB,
      subtotalC,
      shadeTotals,
      shutterTotals,
      drapeTotals,
      productsSubtotal,
      paymentMethod,
      depositAmount,
      balanceAmount,
      financeEligible,
      financeApproved,
      signatureDataUrl,
      logoDataUrl,
      discounts,
      specialPromotion: specialPromotionNum,
      totalMsrp,
      finalDiscountPct,
    });
  }, [
    orderNumber, date, customerName, customerPhone, customerEmail, customerAddress,
    salesRep, partBAddons, subtotalB, paymentMethod, depositAmount,
    balanceAmount, financeEligible, financeApproved, partCServices, partCAddOns, subtotalC,
    shadeOrders, shutterOrders, drapeOrders, shutterMaterial, shutterLouverSize,
    installMode, productsSubtotal, shadeTotals, shutterTotals, drapeTotals,
    discounts,
    specialPromotionNum, totalMsrp, finalDiscountPct,
  ]);

  /**
   * 客户签完名后 → 一键"生成报价单"
   *
   * 1) 保存报价单到后端（若尚未保存 / 有新改动）
   * 2) 调 /mark-signed：把 quote.status 改成 signed，把 opportunity.stage 推进到 signed（已成单）
   * 3) 导出 PDF 到本地
   *
   * 任一签字框有笔画即可触发（由父组件 hasAnySignature 控制 disabled 态）。
   */
  const handleGenerateQuote = useCallback(async () => {
    if (!customerId) {
      alert("请先选择客户");
      return;
    }
    if (!hasAnySignature) {
      alert("请让客户在任一签字框完成签名后再生成报价单");
      return;
    }

    setGenerating(true);
    try {
      // 1) 保存报价单
      const saved = await handleSave();
      if (!saved?.quoteId) {
        setGenerating(false);
        return;
      }

      // 2) 标记为已签名 + 推进 opportunity.stage=signed
      let stageAdvanced = false;
      try {
        const res = await apiFetch(
          `/api/sales/quotes/${saved.quoteId}/mark-signed`,
          { method: "POST" },
        );
        const data = await res.json();
        if (res.ok) stageAdvanced = Boolean(data.stageAdvanced);
        else console.error("mark-signed failed:", data);
      } catch (err) {
        console.error("mark-signed error:", err);
      }

      // 3) 导出 PDF
      await handleExportPDF();

      setGeneratedFlash(
        stageAdvanced
          ? "报价单已生成 · 客户状态已更新为「已成单」"
          : "报价单已生成 · PDF 已导出"
      );
      setTimeout(() => setGeneratedFlash(null), 5000);
    } catch (err) {
      console.error("Generate quote failed:", err);
    } finally {
      setGenerating(false);
    }
  }, [customerId, hasAnySignature, handleSave, handleExportPDF]);

  const preTax = Math.max(0, productsSubtotal + subtotalB + subtotalC - specialPromotionNum);
  const hst = Math.round(preTax * HST_RATE * 100) / 100;
  const grandTotal = preTax + hst;

  return (
    <div className="space-y-4 md:space-y-6 pb-44 md:pb-32">
      <PageHeader
        title="Quote Sheet"
        description="Sunny Shutter Inc. — Digital Quote & Order Form"
      />

      {/* 草稿恢复横幅：检测到未保存的草稿时提示用户 */}
      {pendingDraft && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <FileClock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <div className="font-semibold text-amber-900">
              检测到未保存的报价单草稿
            </div>
            <div className="mt-0.5 text-xs text-amber-800">
              上次编辑于 {formatDraftAge(pendingDraft.savedAt)}
              {pendingDraft.customerName ? ` · 客户：${pendingDraft.customerName}` : ""}
              。签字图像不包含在草稿中，需要客户重新签名。
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={handleRestoreDraft} className="h-7 text-xs">
                恢复草稿
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscardDraft}
                className="h-7 text-xs"
              >
                <X className="mr-1 h-3 w-3" />
                丢弃草稿
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Customer selector + Order info */}
      <div className="rounded-xl border border-border bg-white/60 backdrop-blur p-3 md:p-5 space-y-3 md:space-y-4">
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
          <div className="w-full md:w-64">
            <Label className="text-xs">Select Customer</Label>
            <div className="relative mt-1">
              <select
                value={customerId}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 pr-8 text-base md:text-sm appearance-none min-h-[44px]"
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
            <div className="w-full md:w-56">
              <Label className="text-xs">Opportunity</Label>
              <div className="relative mt-1">
                <select
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 pr-8 text-base md:text-sm appearance-none min-h-[44px]"
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Address</Label>
              {customerAddressOptions.length > 1 && (
                <span className="text-[10px] text-muted-foreground">
                  该客户共有 {customerAddressOptions.length} 个历史地址
                </span>
              )}
            </div>
            {customerAddressOptions.length > 1 && (
              <div className="relative mt-1">
                <select
                  value={
                    customerAddressOptions.includes(customerAddress)
                      ? customerAddress
                      : ""
                  }
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 pr-8 text-xs appearance-none"
                >
                  <option value="">— 选择历史地址或在下方自定义 —</option>
                  {customerAddressOptions.map((addr, i) => (
                    <option key={`${i}-${addr}`} value={addr}>
                      {addr}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            )}
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
            <div className="w-20">
              <Label className="text-xs" title="系统按今日该销售接触的独立客户顺序自动分配">
                Cust #
              </Label>
              <Input
                value={customerDailySeq > 0 ? String(customerDailySeq).padStart(2, "0") : "--"}
                readOnly
                className="mt-1 text-center bg-muted/40 cursor-not-allowed"
                title={customerId ? "系统自动分配" : "请先选择客户"}
              />
            </div>
          </div>
        </div>

        {/* Delivery Method */}
        <div className="rounded-lg border border-border bg-muted/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold">Delivery Method</Label>
              <span className="text-[10px] text-muted-foreground">
                Pickup = no install fee · Installation = full service
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInstallMode("default")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all",
                  installMode === "default"
                    ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                    : "bg-white text-muted-foreground border-border hover:bg-teal-50"
                )}
              >
                <InstallIcon className="h-3.5 w-3.5" />
                Installation
              </button>
              <button
                type="button"
                onClick={() => setInstallMode("pickup")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all",
                  installMode === "pickup"
                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                    : "bg-white text-muted-foreground border-border hover:bg-amber-50"
                )}
              >
                <Truck className="h-3.5 w-3.5" />
                Pickup
              </button>
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
      <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1 -mx-4 md:-mx-1 px-4 md:px-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 md:px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0",
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

      {/* Products Summary — 让用户实时看到三类订单小计 */}
      <div className="rounded-xl border border-teal-200 bg-teal-50/40 px-3 md:px-4 py-2.5 md:py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:text-sm">
          <span className="font-semibold text-teal-800">Order Totals</span>
          <span className="flex items-center gap-1">
            <Blinds className="h-3.5 w-3.5 text-teal-700" />
            Shades:{" "}
            <span className="font-mono font-semibold text-teal-700">
              {formatCAD(shadeTotals.total)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <PanelTopOpen className="h-3.5 w-3.5 text-teal-700" />
            Shutters:{" "}
            <span className="font-mono font-semibold text-teal-700">
              {formatCAD(shutterTotals.total)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Columns3 className="h-3.5 w-3.5 text-teal-700" />
            Drapes:{" "}
            <span className="font-mono font-semibold text-teal-700">
              {formatCAD(drapeTotals.total)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            Part B:{" "}
            <span className="font-mono text-muted-foreground">
              {formatCAD(subtotalB)}
            </span>
          </span>
          {installMode !== "pickup" && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
              Part C:{" "}
              <span className="font-mono text-muted-foreground">
                {formatCAD(subtotalC)}
              </span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 font-semibold">
            Products:{" "}
            <span className="font-mono text-teal-800">
              {formatCAD(productsSubtotal)}
            </span>
          </span>
        </div>
      </div>

      {/* Tab content — mobile 下可横向滚动防止表格溢出 */}
      <div className="rounded-xl border border-border bg-white/60 backdrop-blur p-3 md:p-5 overflow-x-auto">
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
            subtotalA={productsSubtotal} subtotalC={subtotalC} signatureRef={sigPartBRef}
            onSignatureChange={setSigPartBCount}
            specialPromotion={specialPromotion}
            onSpecialPromotionChange={setSpecialPromotion}
            totalMsrp={totalMsrp}
            productsPreTax={productsPreTax}
            promoWarnPct={promoWarnPct}
            promoDangerPct={promoDangerPct}
            promoMaxPct={promoMaxPct}
            isAdmin={isSuperAdmin}
          />
        )}
        {activeTab === "partC" && (
          <>
            {installMode === "pickup" && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <span className="font-semibold">Pickup mode active.</span> Installation services
                  in Part C are waived (subtotal = $0). Switch Delivery Method to &ldquo;Installation&rdquo;
                  above to include install charges.
                </div>
              </div>
            )}
            <PartCForm services={partCServices} onServicesChange={setPartCServices}
              addOns={partCAddOns} onAddOnsChange={setPartCAddOns} signatureRef={sigPartCRef}
              onSignatureChange={setSigPartCCount} />
          </>
        )}
        {activeTab === "shades" && (
          <OrderShadesForm lines={shadeOrders} onChange={setShadeOrders}
            valanceType={shadeValanceType} onValanceTypeChange={setShadeValanceType}
            bracketType={shadeBracketType} onBracketTypeChange={setShadeBracketType}
            signatureRef={sigShadesRef} installMode={installMode}
            onSignatureChange={setSigShadesCount}
            discounts={discounts} />
        )}
        {activeTab === "shutters" && (
          <OrderShuttersForm lines={shutterOrders} onChange={setShutterOrders}
            material={shutterMaterial} onMaterialChange={setShutterMaterial}
            louverSize={shutterLouverSize} onLouverSizeChange={setShutterLouverSize}
            signatureRef={sigShuttersRef} installMode={installMode}
            onSignatureChange={setSigShuttersCount}
            discounts={discounts} />
        )}
        {activeTab === "drapes" && (
          <OrderDrapesForm lines={drapeOrders} onChange={setDrapeOrders}
            signatureRef={sigDrapesRef} installMode={installMode}
            onSignatureChange={setSigDrapesCount}
            discounts={discounts} />
        )}
      </div>

      {/* Sticky action bar — mobile 下避让底部 Tab Bar */}
      <div
        className="fixed left-0 right-0 bottom-[var(--mobile-tabbar-height)] md:bottom-0 bg-white/95 backdrop-blur border-t border-border px-3 md:px-4 py-2.5 md:py-3 flex items-center justify-between gap-2 z-40"
        style={{
          paddingBottom: "max(0.625rem, env(safe-area-inset-bottom, 0))",
        }}
      >
        <div className="min-w-0 text-sm space-y-0.5">
          {orderNumber && (
            <div className="text-[10px] text-muted-foreground font-mono truncate">{orderNumber}</div>
          )}
          <div className="truncate">
            <span className="text-muted-foreground text-xs md:text-sm">Total: </span>
            <span className="text-base md:text-lg font-bold text-teal-700">{formatCAD(grandTotal)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            className="gap-1.5 px-2 md:px-3"
            aria-label="Export PDF"
          >
            <FileDown className="h-4 w-4" />
            <span className="hidden md:inline">Export PDF</span>
          </Button>
          {lastSaved?.quoteId && customerEmail && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendEmail}
              disabled={sendingEmail}
              className="gap-1.5 px-2 md:px-3"
              aria-label="Email to Customer"
            >
              {sendingEmail ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="hidden md:inline">
                {sendingEmail ? "Sending..." : "Email to Customer"}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving || !customerId || promoBlocked}
            className="gap-1.5 px-2 md:px-3"
            aria-label="Save"
            title={
              promoBlocked
                ? `Special Promotion 超过 ${Math.round(promoMaxPct * 100)}% 上限，需 admin 账号提交`
                : undefined
            }
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="hidden md:inline">{saving ? "Saving..." : "Save"}</span>
          </Button>
          <Button
            size="sm"
            onClick={handleGenerateQuote}
            disabled={generating || saving || !customerId || !hasAnySignature || promoBlocked}
            className="gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
            aria-label={hasAnySignature ? "生成报价单（已签名）" : "请先让客户签名"}
            title={
              promoBlocked
                ? `Special Promotion 超过 ${Math.round(promoMaxPct * 100)}% 上限，需 admin 账号提交`
                : !hasAnySignature
                  ? "请让客户在任一签字框完成签名后再生成报价单"
                  : "保存 + 导出 PDF + 将客户状态改为已成单"
            }
          >
            {generating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden md:inline">
              {generating ? "生成中..." : "生成报价单"}
            </span>
            <span className="md:hidden">{generating ? "..." : "生成"}</span>
          </Button>
        </div>
      </div>

      {/* 生成后的提示条 */}
      {generatedFlash && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(var(--mobile-tabbar-height)+4.5rem)] md:bottom-20 z-50 rounded-full bg-emerald-600 text-white text-sm px-4 py-2 shadow-lg flex items-center gap-2"
        >
          <CheckCircle className="h-4 w-4" />
          {generatedFlash}
        </div>
      )}
    </div>
  );
}
