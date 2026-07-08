"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FileText, Globe, PenLine, Check, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// i18n — CN / EN / FR
// ---------------------------------------------------------------------------

type Lang = "en" | "cn" | "fr";

const LANG_LABELS: Record<Lang, string> = { en: "EN", cn: "中文", fr: "FR" };

const T: Record<Lang, Record<string, string>> = {
  en: {
    brand: "SUNNY HOME & DECO",
    tagline: "Custom Window Coverings & Interior Decor",
    quoteV: "Quote V",
    preparedFor: "Prepared for",
    date: "Date",
    by: "By",
    products: "Products",
    room: "Room",
    product: "Product",
    fabric: "Fabric",
    size: "Size",
    msrp: "MSRP",
    price: "Price",
    install: "Install",
    addons: "Add-ons",
    item: "Item",
    qty: "Qty",
    unitPrice: "Unit Price",
    subtotal: "Subtotal",
    productSubtotal: "Product Subtotal",
    addonsLabel: "Add-ons",
    installation: "Installation",
    delivery: "Delivery",
    tax: "Tax",
    total: "Total",
    notes: "Notes",
    notFound: "Quote not found",
    checkLink: "Please check if the link is correct",
    networkError: "Network error",
    loading: "Loading...",
    signTitle: "Sign & Confirm Order",
    signHint: "Please draw your signature below. Your signature here confirms the order.",
    signBtn: "Sign & Place Order",
    signClear: "Clear",
    signed: "Order Confirmed",
    signedMsg: "Thank you. Your order has been placed. Our team will be in touch shortly to confirm deposit and arrange installation.",
    signing: "Submitting...",
    signCaption: "By signing below, I confirm this order and agree to the pricing shown above. Installation schedule and deposit will be arranged separately by our team.",
    footer1: "SUNNY HOME & DECO · Custom Window Coverings & Interior Decor",
    footer2: "This quote is valid for 30 days from the date of issue. All prices in CAD.",
    web: "www.sunnyshutter.ca",
    pdfTitle: "Order Document",
    pdfHint: "Please review the full order document below. Your signature applies to this document.",
    pdfOpen: "Open PDF",
    pdfDownload: "Download PDF",
    pdfSignedDownload: "Download Signed Copy",
    pdfMobileHint: "Tap to view the full order document (PDF)",
    payTitle: "Payment Summary",
    payTotal: "Order Total",
    payDeposit: "Deposit Due Now",
    payBalance: "Balance (on completion)",
    copySentMsg: "A signed copy has been emailed to you for your records.",
  },
  cn: {
    brand: "SUNNY HOME & DECO",
    tagline: "定制窗饰与家居软装",
    quoteV: "报价 V",
    preparedFor: "客户",
    date: "日期",
    by: "报价员",
    products: "产品明细",
    room: "房间",
    product: "产品",
    fabric: "面料",
    size: "尺寸",
    msrp: "零售价",
    price: "报价",
    install: "安装费",
    addons: "附加项",
    item: "项目",
    qty: "数量",
    unitPrice: "单价",
    subtotal: "小计",
    productSubtotal: "产品小计",
    addonsLabel: "附加项",
    installation: "安装费",
    delivery: "运费",
    tax: "税",
    total: "合计",
    notes: "备注",
    notFound: "报价不存在",
    checkLink: "请检查链接是否正确",
    networkError: "网络错误",
    loading: "加载中...",
    signTitle: "签字确认下单",
    signHint: "请在下方手写签名以确认此订单。",
    signBtn: "签字并确认订单",
    signClear: "清除",
    signed: "订单已确认",
    signedMsg: "感谢您的信任，订单已成立。我们将尽快与您联系，确认定金并安排安装。",
    signing: "提交中...",
    signCaption: "在下方签字即代表您确认本订单并同意上述价格，定金与安装档期将由我们的顾问另行与您沟通。",
    footer1: "SUNNY HOME & DECO · 定制窗饰与家居软装",
    footer2: "本报价自签发之日起 30 日内有效，所有价格均为加元 (CAD)。",
    web: "www.sunnyshutter.ca",
    pdfTitle: "订单文件",
    pdfHint: "请查看下方完整订单文件，您的签字对该文件生效。",
    pdfOpen: "打开 PDF",
    pdfDownload: "下载 PDF",
    pdfSignedDownload: "下载已签署版本",
    pdfMobileHint: "点击查看完整订单文件（PDF）",
    payTitle: "付款摘要",
    payTotal: "订单总额",
    payDeposit: "现需支付定金",
    payBalance: "尾款（完工时支付）",
    copySentMsg: "已签署副本已发送至您的邮箱，请注意查收。",
  },
  fr: {
    brand: "SUNNY HOME & DECO",
    tagline: "Habillages de fenêtres et décor intérieur sur mesure",
    quoteV: "Devis V",
    preparedFor: "Préparé pour",
    date: "Date",
    by: "Par",
    products: "Produits",
    room: "Pièce",
    product: "Produit",
    fabric: "Tissu",
    size: "Taille",
    msrp: "PPC",
    price: "Prix",
    install: "Installation",
    addons: "Options",
    item: "Article",
    qty: "Qté",
    unitPrice: "Prix unit.",
    subtotal: "Sous-total",
    productSubtotal: "Sous-total produits",
    addonsLabel: "Options",
    installation: "Installation",
    delivery: "Livraison",
    tax: "Taxe",
    total: "Total",
    notes: "Notes",
    notFound: "Devis introuvable",
    checkLink: "Veuillez vérifier le lien",
    networkError: "Erreur réseau",
    loading: "Chargement...",
    signTitle: "Signer et confirmer la commande",
    signHint: "Veuillez dessiner votre signature ci-dessous. Votre signature confirme la commande.",
    signBtn: "Signer et confirmer",
    signClear: "Effacer",
    signed: "Commande confirmée",
    signedMsg: "Merci. Votre commande est passée. Notre équipe vous contactera sous peu pour confirmer l’acompte et organiser l’installation.",
    signing: "Soumission...",
    signCaption: "En signant ci-dessous, je confirme cette commande et accepte le prix affiché ci-dessus. L’acompte et la date d’installation seront organisés séparément par notre équipe.",
    footer1: "SUNNY HOME & DECO · Habillages de fenêtres et décor intérieur sur mesure",
    footer2: "Ce devis est valable 30 jours à compter de la date d’émission. Tous les prix sont en CAD.",
    web: "www.sunnyshutter.ca",
    pdfTitle: "Document de commande",
    pdfHint: "Veuillez consulter le document complet ci-dessous. Votre signature s’applique à ce document.",
    pdfOpen: "Ouvrir le PDF",
    pdfDownload: "Télécharger le PDF",
    pdfSignedDownload: "Télécharger la copie signée",
    pdfMobileHint: "Touchez pour voir le document complet (PDF)",
    payTitle: "Résumé de paiement",
    payTotal: "Total de la commande",
    payDeposit: "Acompte à verser",
    payBalance: "Solde (à la fin des travaux)",
    copySentMsg: "Une copie signée vous a été envoyée par courriel.",
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuoteItem {
  product: string;
  fabric: string;
  widthIn: number;
  heightIn: number;
  msrp: number;
  price: number;
  installFee: number;
  location: string;
}

interface QuoteRoom {
  roomName: string;
  items: QuoteItem[];
}

interface QuoteData {
  id: string;
  customerName: string;
  version: number;
  status: string;
  installMode: string;
  currency: string;
  merchSubtotal: number;
  addonsSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  preTaxTotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  notes: string | null;
  signatureUrl: string | null;
  signedAt: string | null;
  hasPdf?: boolean;
  payment?: {
    total: number;
    deposit: number | null;
    balance: number | null;
    balanceText: string | null;
  };
  createdAt: string;
  createdBy: string;
  rooms: QuoteRoom[];
  items: QuoteItem[];
  addons: { displayName: string; qty: number; unitPrice: number; subtotal: number }[];
}

// ---------------------------------------------------------------------------
// Signature Pad (canvas-based)
// ---------------------------------------------------------------------------

function SignaturePad({
  onSign,
  onClear,
  clearLabel,
}: {
  onSign: (dataUrl: string) => void;
  onClear: () => void;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDraw = () => setDrawing(false);

  const clear = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setHasDrawn(false);
    onClear();
  };

  const exportSignature = () => {
    if (!canvasRef.current || !hasDrawn) return;
    onSign(canvasRef.current.toDataURL("image/png"));
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={560}
        height={180}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white cursor-crosshair touch-none"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={clear}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <RotateCcw size={13} />
          {clearLabel}
        </button>
        {hasDrawn && (
          <button onClick={exportSignature} className="text-xs text-blue-600 font-medium">
            OK
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Language switcher
// ---------------------------------------------------------------------------

function LangSwitcher({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/20 p-0.5 backdrop-blur-sm">
      <Globe size={13} className="ml-1.5 text-white/70" />
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
            lang === l
              ? "bg-white text-orange-700 shadow-sm"
              : "text-white/80 hover:text-white hover:bg-white/10"
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signSuccess, setSignSuccess] = useState(false);

  const paramLang = searchParams.get("lang");
  const initialLang: Lang =
    paramLang === "cn" || paramLang === "fr" ? paramLang : "en";
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = T[lang];

  const handleSetLang = (l: Lang) => {
    setLang(l);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", l);
    window.history.replaceState({}, "", url.toString());
  };

  const handleSign = async () => {
    if (!signatureData || !token) return;
    setSigning(true);
    try {
      const res = await fetch(`/api/sales/quotes/share/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signatureData, lang }),
      }).then((r) => r.json());
      if (res.signed) {
        setSignSuccess(true);
        setQuote((q) => q ? { ...q, signedAt: res.signedAt, status: "signed" } : q);
      }
    } finally {
      setSigning(false);
    }
  };

  useEffect(() => {
    fetch(`/api/sales/quotes/share/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setQuote(d.quote);
      })
      .catch(() => setError(t.networkError))
      .finally(() => setLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="text-sm text-stone-400">{t.loading}</div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-stone-300" />
          <h2 className="text-lg font-semibold text-stone-700 mb-1">
            {error || t.notFound}
          </h2>
          <p className="text-sm text-stone-400">{t.checkLink}</p>
        </div>
      </div>
    );
  }

  const allItems = quote.rooms.length
    ? quote.rooms.flatMap((r) => r.items.map((i) => ({ ...i, room: r.roomName })))
    : quote.items.map((i) => ({ ...i, room: i.location?.split(" - ")[0] || "—" }));

  const fmtDate = (d: string) => {
    const date = new Date(d);
    if (lang === "cn") return date.toLocaleDateString("zh-CN");
    if (lang === "fr") return date.toLocaleDateString("fr-CA");
    return date.toLocaleDateString("en-CA");
  };

  return (
    <div className="min-h-screen bg-stone-50 py-8 px-4">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6 rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden">
          <div className="bg-gradient-to-r from-orange-600 to-orange-700 px-6 py-6">
            <div className="flex items-start justify-between">
              <div className="text-white">
                <p className="text-[10px] tracking-[0.25em] uppercase text-white/70">Est. Sunny Shutter Inc.</p>
                <h1 className="text-2xl font-bold tracking-wide mt-1">{t.brand}</h1>
                <p className="text-orange-100 text-sm italic mt-0.5">{t.tagline}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <LangSwitcher lang={lang} setLang={handleSetLang} />
                <span className="rounded-full bg-white/20 px-3 py-0.5 text-xs text-white backdrop-blur-sm">
                  {t.quoteV}{quote.version}
                </span>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 flex items-center justify-between border-b border-stone-100">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-stone-400">{t.preparedFor}</p>
              <p className="text-lg font-semibold text-stone-800">{quote.customerName}</p>
            </div>
            <div className="text-right text-sm text-stone-400">
              <p>{t.date}: {fmtDate(quote.createdAt)}</p>
              <p>{t.by}: {quote.createdBy}</p>
            </div>
          </div>
        </div>

        {/* 付款摘要 —— 总价 / 现付定金 / 尾款，客户第一眼看到 */}
        {quote.payment && quote.payment.total > 0 && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-orange-200 overflow-hidden mb-6">
            <div className="px-6 py-3 border-b border-orange-100 bg-orange-50/40">
              <h2 className="text-sm font-semibold text-stone-800">{t.payTitle}</h2>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-stone-500">{t.payTotal}</span>
                <span className="text-2xl font-bold text-stone-800">
                  ${quote.payment.total.toFixed(2)}
                </span>
              </div>
              {quote.payment.deposit !== null && (
                <div className="flex justify-between items-baseline rounded-xl bg-orange-50 px-4 py-3 -mx-1">
                  <span className="text-sm font-semibold text-orange-800">{t.payDeposit}</span>
                  <span className="text-xl font-bold text-orange-700">
                    ${quote.payment.deposit.toFixed(2)}
                  </span>
                </div>
              )}
              {(quote.payment.balance !== null || quote.payment.balanceText) && (
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-stone-500">{t.payBalance}</span>
                  <span className="text-base font-semibold text-stone-600">
                    {quote.payment.balance !== null
                      ? `$${quote.payment.balance.toFixed(2)}`
                      : quote.payment.balanceText}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 有 PDF 存档时以 PDF 为准展示（与销售发出的版本完全一致），签字对 PDF 生效 */}
        {quote.hasPdf && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-stone-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-stone-700">{t.pdfTitle}</h2>
                <p className="text-xs text-stone-400 mt-0.5">{t.pdfHint}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/sales/quotes/share/${token}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  {t.pdfOpen}
                </a>
                <a
                  href={`/api/sales/quotes/share/${token}/pdf?download=1`}
                  className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 transition-colors"
                >
                  {quote.signedAt || signSuccess ? t.pdfSignedDownload : t.pdfDownload}
                </a>
              </div>
            </div>
            {/* 手机端 iframe 内嵌 PDF 不可靠（iOS 只显示首页/吞掉滚动），
                小屏改为跳转卡片，桌面端才内嵌预览 */}
            <a
              href={`/api/sales/quotes/share/${token}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex md:hidden items-center gap-3 px-6 py-5 bg-orange-50/50 hover:bg-orange-50 transition-colors"
            >
              <FileText size={28} className="text-orange-600 shrink-0" />
              <span className="text-sm font-medium text-orange-800">{t.pdfMobileHint} →</span>
            </a>
            <iframe
              key={signSuccess ? "signed" : "original"}
              src={`/api/sales/quotes/share/${token}/pdf?v=${signSuccess ? "signed" : "original"}#toolbar=0`}
              title={t.pdfTitle}
              className="hidden md:block w-full bg-stone-100"
              style={{ height: "70vh", border: "none" }}
            />
          </div>
        )}

        {/* Items by room */}
        {!quote.hasPdf && (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-700">{t.products}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-orange-50 text-left text-[11px] font-medium text-orange-800 uppercase tracking-wider">
                  <th className="px-6 py-2.5">{t.room}</th>
                  <th className="px-4 py-2.5">{t.product}</th>
                  <th className="px-4 py-2.5">{t.fabric}</th>
                  <th className="px-4 py-2.5 text-center">{t.size}</th>
                  <th className="px-4 py-2.5 text-right">{t.msrp}</th>
                  <th className="px-4 py-2.5 text-right">{t.price}</th>
                  <th className="px-4 py-2.5 text-right">{t.install}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {allItems.map((item, i) => (
                  <tr key={i} className="hover:bg-orange-50/40 transition-colors">
                    <td className="px-6 py-2.5 font-medium text-stone-700">{item.room}</td>
                    <td className="px-4 py-2.5 text-stone-600">{item.product}</td>
                    <td className="px-4 py-2.5 text-stone-500">{item.fabric || "—"}</td>
                    <td className="px-4 py-2.5 text-center text-stone-500">
                      {item.widthIn}&quot; × {item.heightIn}&quot;
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-400 line-through">
                      ${item.msrp?.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-stone-800">
                      ${item.price?.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-500">
                      ${item.installFee?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Addons */}
        {!quote.hasPdf && quote.addons.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 className="text-sm font-semibold text-stone-700">{t.addons}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-50 text-left text-[11px] font-medium text-orange-800 uppercase tracking-wider">
                    <th className="px-6 py-2.5">{t.item}</th>
                    <th className="px-4 py-2.5 text-center">{t.qty}</th>
                    <th className="px-4 py-2.5 text-right">{t.unitPrice}</th>
                    <th className="px-4 py-2.5 text-right">{t.subtotal}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {quote.addons.map((a, i) => (
                    <tr key={i}>
                      <td className="px-6 py-2.5 text-stone-700">{a.displayName}</td>
                      <td className="px-4 py-2.5 text-center text-stone-500">{a.qty}</td>
                      <td className="px-4 py-2.5 text-right text-stone-500">${a.unitPrice.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-stone-700">${a.subtotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Summary */}
        {!quote.hasPdf && (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden mb-6">
          <div className="px-6 py-4 space-y-2">
            <div className="flex justify-between text-sm text-stone-500">
              <span>{t.productSubtotal}</span>
              <span>${quote.merchSubtotal?.toFixed(2)}</span>
            </div>
            {(quote.addonsSubtotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-stone-500">
                <span>{t.addonsLabel}</span>
                <span>${quote.addonsSubtotal?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-stone-500">
              <span>{t.installation}</span>
              <span>${quote.installApplied?.toFixed(2)}</span>
            </div>
            {(quote.deliveryFee ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-stone-500">
                <span>{t.delivery}</span>
                <span>${quote.deliveryFee?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-stone-500">
              <span>{t.tax} ({((quote.taxRate ?? 0) * 100).toFixed(1)}%)</span>
              <span>${quote.taxAmount?.toFixed(2)}</span>
            </div>
            <div className="border-t border-stone-200 pt-3 flex justify-between items-baseline">
              <span className="text-base font-bold text-stone-800">{t.total}</span>
              <span className="text-2xl font-bold text-orange-700">
                ${quote.grandTotal?.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        )}

        {/* Notes */}
        {!quote.hasPdf && quote.notes && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 overflow-hidden mb-6 px-6 py-4">
            <h3 className="text-sm font-semibold text-stone-700 mb-1">{t.notes}</h3>
            <p className="text-sm text-stone-500 whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Signature section */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-orange-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-orange-100 flex items-center gap-2 bg-orange-50/40">
            <PenLine size={16} className="text-orange-600" />
            <h2 className="text-sm font-semibold text-stone-800">{t.signTitle}</h2>
          </div>
          <div className="px-6 py-5">
            {quote.signedAt || signSuccess ? (
              <div className="flex flex-col items-center py-4 text-center">
                <div className="rounded-full bg-emerald-100 p-3 mb-3">
                  <Check size={28} className="text-emerald-600" />
                </div>
                <p className="text-base font-semibold text-emerald-700">{t.signed}</p>
                <p className="text-xs text-stone-500 mt-2 max-w-md leading-relaxed">{t.signedMsg}</p>
                {quote.signedAt && (
                  <p className="text-xs text-stone-400 mt-2">
                    {fmtDate(quote.signedAt)}
                  </p>
                )}
                {quote.hasPdf && (
                  <>
                    <a
                      href={`/api/sales/quotes/share/${token}/pdf?download=1`}
                      className="mt-4 rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors"
                    >
                      {t.pdfSignedDownload} ↓
                    </a>
                    <p className="text-xs text-stone-400 mt-3">{t.copySentMsg}</p>
                  </>
                )}
              </div>
            ) : (
              <div>
                <p className="text-xs text-stone-600 leading-relaxed mb-4">{t.signCaption}</p>
                <p className="text-xs text-stone-500 mb-3">{t.signHint}</p>
                <SignaturePad
                  onSign={(dataUrl) => setSignatureData(dataUrl)}
                  onClear={() => setSignatureData(null)}
                  clearLabel={t.signClear}
                />
                {signatureData && (
                  <button
                    onClick={handleSign}
                    disabled={signing}
                    className="mt-4 w-full rounded-xl bg-gradient-to-r from-orange-600 to-orange-700 py-3 text-sm font-semibold text-white shadow-sm hover:from-orange-700 hover:to-orange-800 disabled:opacity-50 transition-all"
                  >
                    {signing ? t.signing : t.signBtn}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-stone-400 mt-8 pb-8 space-y-1">
          <p className="text-orange-700/70 font-semibold tracking-wider">{t.footer1}</p>
          <p>{t.web}</p>
          <p>{t.footer2}</p>
        </div>
      </div>
    </div>
  );
}
