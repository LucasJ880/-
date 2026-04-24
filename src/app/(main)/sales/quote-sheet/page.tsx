"use client";

import { useState, useRef, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  Mail,
  Sparkles,
  FileClock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type PencilCanvasRef } from "@/components/pencil-canvas";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import type { QuoteItemInput } from "@/lib/blinds/pricing-types";
import { isManualPriceShadeProduct } from "@/lib/blinds/pricing-types";
import { skuToPricingFabric } from "@/lib/blinds/sku-catalog";

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
  return (
    <Suspense fallback={null}>
      <QuoteSheetPageInner />
    </Suspense>
  );
}

function QuoteSheetPageInner() {
  const searchParams = useSearchParams();
  const editingQuoteIdFromUrl = searchParams.get("quoteId");

  const [activeTab, setActiveTab] = useState<TabId>("shades");
  // 编辑模式：当 URL 带 ?quoteId=xxx 时，加载已有报价单并切换到 PUT 保存
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingQuoteVersion, setEditingQuoteVersion] = useState<number | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedFlash, setGeneratedFlash] = useState<string | null>(null);
  // 发送 Quote 弹窗（让销售选择：发邮件 / 本地保存 PDF）
  const [sendQuoteOpen, setSendQuoteOpen] = useState(false);
  const [sendQuoteBusy, setSendQuoteBusy] = useState<null | "email" | "local">(null);
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

  // Signatures — 签名统一收敛到 Part B，其它 tab 不再展示签名框
  const sigPartBRef = useRef<PencilCanvasRef>(null);

  // Part B 签字笔画数（>0 即视为客户已签名，可解锁"生成订单"）
  const [sigPartBCount, setSigPartBCount] = useState(0);
  const hasAnySignature = sigPartBCount > 0;

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
  // 定金阈值
  const [depositWarnPct, setDepositWarnPct] = useState(0.4);
  const [depositMinPct, setDepositMinPct] = useState(0.3);
  const [hasDepositOverrideCode, setHasDepositOverrideCode] = useState(false);
  // 本单定金解锁状态（输入 code 成功后置 true；仅当前页面 session 内有效）
  const [depositUnlocked, setDepositUnlocked] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const d = await apiJson<{
          zebra: number; shangrila: number; cellular: number; roller: number;
          drapery: number; sheer: number; shutters: number; honeycomb: number;
          promoWarnPct?: number; promoDangerPct?: number; promoMaxPct?: number;
          depositWarnPct?: number; depositMinPct?: number;
          hasDepositOverrideCode?: boolean;
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
        if (typeof d.depositWarnPct === "number") setDepositWarnPct(d.depositWarnPct);
        if (typeof d.depositMinPct === "number") setDepositMinPct(d.depositMinPct);
        if (typeof d.hasDepositOverrideCode === "boolean") setHasDepositOverrideCode(d.hasDepositOverrideCode);
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

  // Special Promotion 硬门槛：ratio > promoMaxPct 时，非 admin 禁止保存/生成
  const productsPreTax = productsSubtotal + subtotalC;
  const promoRatio = productsPreTax > 0 ? specialPromotionNum / productsPreTax : 0;

  // 新口径：finalDiscountPct = Special Promotion ÷ 产品税前价（不再与 MSRP 比较）
  // 旧报价单里存的是"相对 MSRP"的折扣率，改口径后新数据为"让利率"，二者过渡期
  // 并存可接受（统计数字会随着新单逐步迁移到新口径）。
  const finalDiscountPct = productsPreTax > 0
    ? Math.max(0, Math.min(1, specialPromotionNum / productsPreTax))
    : 0;
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
      date,
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

  // 把 QuoteFormState / QuoteDraftV1 的字段统一灌入各个表单 state，
  // 让「恢复草稿」和「编辑已保存报价单」走同一条代码路径。
  const applyFormState = useCallback((d: QuoteDraftV1 | QuoteFormState) => {
    setCustomerId(d.customerId);
    setCustomerName(d.customerName);
    setCustomerPhone(d.customerPhone);
    setCustomerEmail(d.customerEmail);
    setCustomerAddress(d.customerAddress);
    setHeardUsOn(d.heardUsOn);
    setOpportunityId((d as QuoteDraftV1).opportunityId ?? "");
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
    // midRail 历史为 boolean，现统一为 string；兼容老草稿 / 老报价单
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
    if (typeof (d as QuoteDraftV1).specialPromotion === "string") {
      setSpecialPromotion((d as QuoteDraftV1).specialPromotion as string);
    }
  }, []);

  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    applyFormState(pendingDraft);
    setPendingDraft(null);
  }, [pendingDraft, applyFormState]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setPendingDraft(null);
  }, []);

  // ── 编辑已有报价单：加载 formDataJson 并填表 ─────────────────────
  useEffect(() => {
    if (!editingQuoteIdFromUrl || !draftReady) return;
    // 进入编辑模式时屏蔽"恢复草稿"横幅（否则会和已有 quote 内容叠加）
    setPendingDraft(null);
    setEditingLoading(true);
    (async () => {
      try {
        type QuoteResp = {
          quote: {
            id: string;
            version: number;
            formDataJson: string | null;
            notes: string | null;
            specialPromotion: number | null;
          };
        };
        const res = await apiJson<QuoteResp>(
          `/api/sales/quotes/${editingQuoteIdFromUrl}`,
        );
        const raw = res.quote.formDataJson;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as QuoteFormState;
            applyFormState(parsed);
          } catch (err) {
            console.error("formDataJson 解析失败", err);
            alert("该报价单的表单数据已损坏，无法完全恢复。可重新填写后再保存。");
          }
        } else {
          alert(
            "该报价单未保存完整表单数据（老版本），无法回填到编辑界面。\n" +
              "您仍可在此基础上新填内容后点击保存以更新。",
          );
        }
        // 即便 formDataJson 缺失也进编辑模式：销售可以重新填，保存时覆盖原 quote
        setEditingQuoteId(res.quote.id);
        setEditingQuoteVersion(res.quote.version);
        if (
          typeof res.quote.specialPromotion === "number" &&
          res.quote.specialPromotion > 0
        ) {
          setSpecialPromotion(String(res.quote.specialPromotion));
        }
      } catch (err) {
        console.error("Load quote for editing failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        alert(`加载报价单失败：${msg}\n\n请返回客户详情页重试。`);
      } finally {
        setEditingLoading(false);
      }
    })();
  }, [editingQuoteIdFromUrl, draftReady, applyFormState]);

  const handleSave = useCallback(async (): Promise<
    { quoteId: string; saveMode: "full" | "partial" | "shell" } | null
  > => {
    if (!customerId) return null;
    // 硬门槛：Special Promotion 超过公司上限，非 admin 禁止提交
    if (promoBlocked) {
      alert(
        `Special Promotion 已达产品税前小计的 ${(promoRatio * 100).toFixed(1)}%，超过公司设定的最高让利上限 ${Math.round(promoMaxPct * 100)}%。\n\n请降低让利金额，或由管理员账号登录后提交。`,
      );
      return null;
    }
    // 硬门槛：定金低于最低阈值，需 code 解锁（非 admin 且未在本单解锁）
    // 仅 paymentMethod === "direct" 时校验；Finance 模式的 deposit 语义不同
    if (paymentMethod === "direct" && !isSuperAdmin && !depositUnlocked) {
      const _preTax = Math.max(
        0,
        productsSubtotal + subtotalB + subtotalC - specialPromotionNum,
      );
      const _grandTotal = _preTax + Math.round(_preTax * HST_RATE * 100) / 100;
      const _deposit = Math.max(0, parseFloat(depositAmount) || 0);
      const _depositPct = _grandTotal > 0 ? _deposit / _grandTotal : 0;
      if (_grandTotal > 0 && _depositPct < depositMinPct) {
        alert(
          `当前定金仅占总价的 ${(_depositPct * 100).toFixed(1)}%，低于公司设定的最低定金比例 ${Math.round(depositMinPct * 100)}%。\n\n` +
            `请提高定金金额，或在 Part B 中输入老板提供的解锁码后重试。`,
        );
        return null;
      }
    }
    setSaving(true);
    try {
      // 从三个电子订单表构造报价单 items（代替原来的 Part A 行）
      const items: QuoteItemInput[] = [];

      // Shades
      for (const l of shadeOrders) {
        // Allusion / Roman：手填价分支，不要求价格表 SKU，只要宽高 + manualPrice
        if (isManualPriceShadeProduct(l.product)) {
          if (!l.widthWhole || !l.heightWhole) continue;
          const w = fractionToInches(l.widthWhole, l.widthFrac);
          const h = fractionToInches(l.heightWhole, l.heightFrac);
          if (!w || !h) continue;
          const manual = parseFloat(l.manualPrice ?? "");
          if (!Number.isFinite(manual) || manual <= 0) continue;
          items.push({
            product: l.product,
            fabric: l.sku || l.product,
            widthIn: w,
            heightIn: h,
            location: l.location,
            sku: l.sku || l.product,
            manualPrice: manual,
          });
          continue;
        }
        if (!l.sku || !l.widthWhole || !l.heightWhole) continue;
        const w = fractionToInches(l.widthWhole, l.widthFrac);
        const h = fractionToInches(l.heightWhole, l.heightFrac);
        if (!w || !h) continue;
        // 把具体 SKU（例如 RL-AQUAWIDE3-BEIGE-LF）映射为定价表认的 fabric key
        // （例如 "Light Filtering (Open Roll)"），否则后端 priceFor 会报
        // "Pricing for this Roller fabric is not set yet"，导致整行价格丢失。
        const pricingFabric = skuToPricingFabric(l.sku, l.product);
        items.push({
          product: l.product,
          fabric: pricingFabric,
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

      // 注意：items 为空也允许提交，由后端以 shell 模式保存（仅存 formDataJson）
      // 这样即使 pricing 全部对不上，销售填写的内容也绝不会丢。
      if (items.length === 0) {
        const proceed = confirm(
          "未能从当前表单算出任何可计价的产品行（可能是尺寸未填全或 SKU 对不上价格表）。\n\n" +
            "是否依然保存一份草稿？（所有填写内容会保留，后续可由管理员补全定价）",
        );
        if (!proceed) return null;
      }

      const fullFormData: QuoteFormState = {
        orderNumber, date, customerId, customerName, customerPhone,
        customerEmail, customerAddress, heardUsOn, salesRep, measureSequence,
        partALines,
        partBAddons, partBNotes, paymentMethod, depositAmount, balanceAmount,
        financeEligible, financeApproved, financeDifference,
        partCServices, partCAddOns,
        shadeOrders: shadeOrders.filter(
          (l) =>
            l.location ||
            l.sku ||
            l.widthWhole ||
            (isManualPriceShadeProduct(l.product) && !!String(l.manualPrice ?? "").trim()),
        ),
        shutterOrders: shutterOrders.filter((l) => l.location || l.widthWhole),
        drapeOrders: drapeOrders.filter((l) => l.location || l.drapeFabricSku || l.sheerFabricSku),
        shutterMaterial, shutterLouverSize, shadeValanceType, shadeBracketType,
        installMode,
      };

      // 编辑模式下走 PUT /api/sales/quotes/[quoteId]，否则 POST 新建
      const isEditing = !!editingQuoteId;
      const endpoint = isEditing
        ? `/api/sales/quotes/${editingQuoteId}`
        : "/api/sales/quotes";
      const method = isEditing ? "PUT" : "POST";

      // 先拿 Response，检查 HTTP 状态，防止"保存失败却把草稿清掉"
      const apiResponse = await apiFetch(endpoint, {
        method,
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
      });

      if (!apiResponse.ok) {
        const errBody = (await apiResponse.json().catch(() => null)) as
          | { error?: string; message?: string; details?: unknown }
          | null;
        const serverMsg =
          errBody?.error || errBody?.message || `HTTP ${apiResponse.status}`;
        throw new Error(serverMsg);
      }

      const res = await apiResponse.json();
      const quoteId: string | undefined = res.quote?.id;
      if (!quoteId) {
        // 2xx 但没返回 quoteId：异常情况，坚决不要清草稿
        throw new Error(
          "保存未成功：后端未返回报价单 ID（可能是数据校验问题）。",
        );
      }

      const statusAdvanced = res.lifecycle?.autoAdvanced ?? false;
      setLastSaved({
        time: new Date().toLocaleTimeString("en-CA"),
        orderNum: orderNumber,
        statusAdvanced,
        quoteId,
      });
      // 真正保存成功 → 本地草稿使命完成
      clearDraft();

      // 兜底模式（partial / shell）时提示销售："数据已保存，但定价未完全算出"
      const saveMode: "full" | "partial" | "shell" | undefined = res.saveMode;
      const pricing = res.pricing as
        | { requestedItems: number; succeededItems: number; errors: Array<{ index: number; error: string; input?: { product?: string; fabric?: string } }> }
        | undefined;
      if (saveMode && saveMode !== "full" && pricing) {
        const errLines = (pricing.errors || [])
          .slice(0, 5)
          .map(
            (e, i) =>
              `  ${i + 1}. ${e.input?.product || "?"} ${e.input?.fabric || ""} — ${e.error}`,
          )
          .join("\n");
        const more =
          pricing.errors.length > 5 ? `\n  …还有 ${pricing.errors.length - 5} 条` : "";
        const headline =
          saveMode === "shell"
            ? "报价单已以「草稿」方式保存（暂无可计价的产品行）"
            : `报价单已保存（${pricing.succeededItems}/${pricing.requestedItems} 行成功计价，其余以草稿形式保留）`;
        alert(
          `${headline}\n\n以下产品行未能计算价格：\n${errLines}${more}\n\n` +
            `请到「客户详情 → 报价单」页面由管理员补全定价后再发给客户。`,
        );
      }

      return { quoteId, saveMode: saveMode ?? "full" };
    } catch (err) {
      console.error("Save quote failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(
        `保存报价单失败：${msg}\n\n` +
          `您填写的内容仍保留在本地草稿中。` +
          `刷新页面后可通过顶部的"恢复草稿"按钮找回，不会丢失。`,
      );
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
    depositMinPct, depositUnlocked, isSuperAdmin,
    productsSubtotal, subtotalB, subtotalC,
    editingQuoteId,
  ]);

  /**
   * 打开"发送 Quote"弹窗：
   *   弹窗内销售可以选择"发送到客户邮箱"或"下载到本地"。
   *   任一方式成功后，报价单状态会被推进到「已报价」（sent），
   *   对应的商机已在创建时自动推进到 stage=quoted，进入跟单环节。
   *   允许未签字时发送 Quote。
   */
  const handleOpenSendQuote = useCallback(() => {
    if (!customerId) {
      alert("请先选择客户");
      return;
    }
    setSendQuoteOpen(true);
  }, [customerId]);

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
   * 客户 Part B 签完名后 → 一键"生成订单"
   *
   * 1) 保存报价单到后端（若尚未保存 / 有新改动）
   * 2) 调 /mark-signed：把 quote.status 改成 signed，把 opportunity.stage 推进到 signed（已成单）
   * 3) 导出 Order Form PDF 到本地
   *
   * 只看 Part B 签字框是否有笔画（由父组件 hasAnySignature 控制 disabled 态）。
   */
  const handleGenerateQuote = useCallback(async () => {
    if (!customerId) {
      alert("请先选择客户");
      return;
    }
    if (!hasAnySignature) {
      alert("请让客户在 Part B 底部签字后再生成订单");
      return;
    }

    setGenerating(true);
    try {
      const saved = await handleSave();
      if (!saved?.quoteId) {
        setGenerating(false);
        return;
      }

      let stageAdvanced = false;
      let markSignedWarning: string | null = null;
      if (saved.saveMode === "shell") {
        markSignedWarning =
          "由于当前没有可计价的产品行，订单状态未自动推进。请让管理员补全定价后再标记为已成单。";
      } else {
        try {
          const res = await apiFetch(
            `/api/sales/quotes/${saved.quoteId}/mark-signed`,
            { method: "POST" },
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            stageAdvanced = Boolean(data.stageAdvanced);
          } else {
            const msg = data?.error || `HTTP ${res.status}`;
            console.error("mark-signed failed:", data);
            markSignedWarning = `订单状态推进失败：${msg}（订单已保存，稍后可到客户详情页手动推进）`;
          }
        } catch (err) {
          console.error("mark-signed error:", err);
          markSignedWarning = `订单状态推进失败：网络错误（订单已保存，稍后可到客户详情页手动推进）`;
        }
      }

      let pdfWarning: string | null = null;
      try {
        await handleExportPDF();
      } catch (err) {
        console.error("Export PDF failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        pdfWarning = `Order Form PDF 导出失败：${msg}（订单已保存，可到客户详情页重试导出）`;
      }

      if (markSignedWarning || pdfWarning) {
        alert(
          `订单已保存成功（订单号 ${lastSaved?.orderNum || saved.quoteId}），但有部分后续步骤未完成：\n\n` +
            [markSignedWarning, pdfWarning].filter(Boolean).join("\n") +
            `\n\n数据不会丢失，可到"客户详情"页继续处理。`,
        );
      }

      setGeneratedFlash(
        stageAdvanced
          ? "订单已生成 · 客户状态已更新为「已成单」"
          : "订单已生成 · Order Form PDF 已导出",
      );
      setTimeout(() => setGeneratedFlash(null), 5000);
    } catch (err) {
      console.error("Generate order failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(
        `生成订单失败：${msg}\n\n请检查网络后重试。您填写的内容仍保留在本地草稿中。`,
      );
    } finally {
      setGenerating(false);
    }
  }, [customerId, hasAnySignature, handleSave, handleExportPDF, lastSaved?.orderNum]);

  /**
   * 发送 Quote —— 弹窗二选一落地：
   *   mode = "email"：确保已保存 → 调用 /send-email（API 内部会把 quote.status 置为 sent）
   *   mode = "local"：确保已保存 → 导出 PDF 到本地 → 调用 /mark-sent 标记已报价
   *
   * 不要求签名。发送成功后统一显示"已进入跟单环节"的提示条。
   */
  const handleSendQuote = useCallback(async (mode: "email" | "local") => {
    if (!customerId) {
      alert("请先选择客户");
      return;
    }
    if (mode === "email" && !customerEmail) {
      alert("该客户没有填写邮箱，请先在客户信息中补充邮箱，或改为下载到本地。");
      return;
    }

    setSendQuoteBusy(mode);
    try {
      const saved = await handleSave();
      if (!saved?.quoteId) {
        setSendQuoteBusy(null);
        return;
      }

      if (mode === "email") {
        try {
          const res = await apiFetch(`/api/sales/quotes/${saved.quoteId}/send-email`, {
            method: "POST",
            body: JSON.stringify({ to: customerEmail, lang: "en" }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
          setLastSaved((prev) => (prev ? { ...prev, emailSent: true } as typeof prev : prev));
          setGeneratedFlash(`Quote 已发送到 ${customerEmail} · 客户状态「已报价 · 跟单中」`);
        } catch (err) {
          console.error("send-email failed:", err);
          const msg = err instanceof Error ? err.message : String(err);
          alert(`邮件发送失败：${msg}\n\n报价单已保存，可稍后在客户详情页重试发送。`);
          return;
        }
      } else {
        try {
          await handleExportPDF();
        } catch (err) {
          console.error("Export PDF failed:", err);
          const msg = err instanceof Error ? err.message : String(err);
          alert(`PDF 下载失败：${msg}\n\n报价单已保存，可稍后在客户详情页重试导出。`);
          return;
        }
        try {
          await apiFetch(`/api/sales/quotes/${saved.quoteId}/mark-sent`, { method: "POST" });
        } catch (err) {
          console.error("mark-sent failed:", err);
          // 状态推进失败不影响 PDF 已下载的事实，仅记录
        }
        setGeneratedFlash("Quote PDF 已下载到本地 · 客户状态「已报价 · 跟单中」");
      }

      setTimeout(() => setGeneratedFlash(null), 5000);
      setSendQuoteOpen(false);
    } finally {
      setSendQuoteBusy(null);
    }
  }, [customerId, customerEmail, handleSave, handleExportPDF]);

  const preTax = Math.max(0, productsSubtotal + subtotalB + subtotalC - specialPromotionNum);
  const hst = Math.round(preTax * HST_RATE * 100) / 100;
  const grandTotal = preTax + hst;

  // Direct Payment 模式：balance 总是派生 = Grand Total − Deposit（只读）
  // 销售修改 deposit 或总价变化时自动同步 balance 状态，
  // 便于 draft / PDF / 后端持久化沿用现有 pipeline。
  useEffect(() => {
    if (paymentMethod !== "direct") return;
    const deposit = Math.max(0, parseFloat(depositAmount) || 0);
    const computed = Math.max(0, grandTotal - deposit);
    const target = computed > 0 ? computed.toFixed(2) : "";
    setBalanceAmount((prev) => (prev === target ? prev : target));
  }, [depositAmount, grandTotal, paymentMethod]);

  return (
    <div className="space-y-4 md:space-y-6 pb-44 md:pb-32">
      <PageHeader
        title={
          editingQuoteId
            ? `编辑报价单${editingQuoteVersion ? ` · v${editingQuoteVersion}` : ""}`
            : "Quote Sheet"
        }
        description={
          editingQuoteId
            ? "正在修改已保存的报价单；保存后会覆盖原报价单（不会新建版本）"
            : "Sunny Shutter Inc. — Digital Quote & Order Form"
        }
      />
      {editingLoading && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-teal-700">
          正在加载已保存的报价单内容…
        </div>
      )}

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
            grandTotal={grandTotal}
            depositWarnPct={depositWarnPct}
            depositMinPct={depositMinPct}
            hasDepositOverrideCode={hasDepositOverrideCode}
            depositUnlocked={depositUnlocked}
            onDepositUnlockedChange={setDepositUnlocked}
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
              addOns={partCAddOns} onAddOnsChange={setPartCAddOns} />
          </>
        )}
        {activeTab === "shades" && (
          <OrderShadesForm lines={shadeOrders} onChange={setShadeOrders}
            valanceType={shadeValanceType} onValanceTypeChange={setShadeValanceType}
            bracketType={shadeBracketType} onBracketTypeChange={setShadeBracketType}
            installMode={installMode}
            discounts={discounts} />
        )}
        {activeTab === "shutters" && (
          <OrderShuttersForm lines={shutterOrders} onChange={setShutterOrders}
            material={shutterMaterial} onMaterialChange={setShutterMaterial}
            louverSize={shutterLouverSize} onLouverSizeChange={setShutterLouverSize}
            installMode={installMode}
            discounts={discounts} />
        )}
        {activeTab === "drapes" && (
          <OrderDrapesForm lines={drapeOrders} onChange={setDrapeOrders}
            installMode={installMode}
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
            onClick={handleOpenSendQuote}
            disabled={!customerId || promoBlocked}
            className="gap-1.5 px-2 md:px-3"
            aria-label="发送 Quote"
            title={
              promoBlocked
                ? `Special Promotion 超过 ${Math.round(promoMaxPct * 100)}% 上限，需 admin 账号提交`
                : "保存 + 选择发送邮件或下载到本地（客户进入「已报价 · 跟单中」）"
            }
          >
            <Send className="h-4 w-4" />
            <span className="hidden md:inline">发送 Quote</span>
            <span className="md:hidden">发送</span>
          </Button>
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
            aria-label={hasAnySignature ? "生成订单（客户已在 Part B 签字）" : "请先让客户在 Part B 签字"}
            title={
              promoBlocked
                ? `Special Promotion 超过 ${Math.round(promoMaxPct * 100)}% 上限，需 admin 账号提交`
                : !hasAnySignature
                  ? "请让客户在 Part B 底部签字后再生成订单"
                  : "保存 + 导出 Order Form PDF + 将客户状态改为「已成单」"
            }
          >
            {generating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden md:inline">
              {generating ? "生成中..." : "生成订单"}
            </span>
            <span className="md:hidden">{generating ? "..." : "订单"}</span>
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

      {/* 发送 Quote 弹窗 —— 选择邮件 / 本地 */}
      {sendQuoteOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            if (!sendQuoteBusy) setSendQuoteOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 pt-5 pb-2">
              <div>
                <h3 className="text-base font-semibold">发送 Quote</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  选择发送方式后，系统会先保存一次最新内容，再将客户状态推进到「已报价 · 跟单中」。
                  {!hasAnySignature && (
                    <span className="block mt-1 text-amber-700">
                      ⓘ 客户尚未签字，允许以 Quote 形式先发给客户。签字后请点击&ldquo;生成订单&rdquo;。
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!sendQuoteBusy) setSendQuoteOpen(false); }}
                className="text-muted-foreground hover:text-foreground p-1 -m-1"
                aria-label="关闭"
                disabled={!!sendQuoteBusy}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-5 pt-2 space-y-2.5">
              <button
                type="button"
                onClick={() => handleSendQuote("email")}
                disabled={!!sendQuoteBusy || !customerEmail}
                className="w-full text-left rounded-lg border border-border hover:border-teal-500 hover:bg-teal-50/60 px-4 py-3 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                <div className="shrink-0 h-9 w-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center">
                  {sendQuoteBusy === "email" ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">发送到客户邮箱</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {customerEmail
                      ? <>收件人：{customerEmail}</>
                      : <span className="text-amber-700">该客户未填写邮箱，请选择下载到本地</span>}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSendQuote("local")}
                disabled={!!sendQuoteBusy}
                className="w-full text-left rounded-lg border border-border hover:border-teal-500 hover:bg-teal-50/60 px-4 py-3 flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                <div className="shrink-0 h-9 w-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center">
                  {sendQuoteBusy === "local" ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">下载到本地 PDF</div>
                  <div className="text-xs text-muted-foreground">
                    保存 Quote PDF 到本机，便于微信/打印转发；客户状态同步更新为「已报价」。
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
