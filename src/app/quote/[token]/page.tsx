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
    brand: "SUNNY BLINDS",
    tagline: "Custom Window Covering",
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
    footer1: "Powered by Qingyan AI — Custom Quote System",
    footer2: "This quote is valid for 30 days",
    notFound: "Quote not found",
    checkLink: "Please check if the link is correct",
    networkError: "Network error",
    loading: "Loading...",
    signTitle: "Accept & Sign",
    signHint: "Draw your signature below to accept this quote",
    signBtn: "Confirm & Sign",
    signClear: "Clear",
    signed: "Signed",
    signedMsg: "This quote has been accepted and signed.",
    signing: "Submitting...",
  },
  cn: {
    brand: "SUNNY BLINDS",
    tagline: "定制窗饰",
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
    footer1: "由青砚 AI 驱动 — 定制报价系统",
    footer2: "本报价有效期 30 天",
    notFound: "报价不存在",
    checkLink: "请检查链接是否正确",
    networkError: "网络错误",
    loading: "加载中...",
    signTitle: "确认并签名",
    signHint: "请在下方手写签名以确认此报价",
    signBtn: "确认签约",
    signClear: "清除",
    signed: "已签约",
    signedMsg: "此报价已被确认并签署。",
    signing: "提交中...",
  },
  fr: {
    brand: "SUNNY BLINDS",
    tagline: "Habillage de fenêtres sur mesure",
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
    footer1: "Propulsé par Qingyan AI — Système de devis personnalisé",
    footer2: "Ce devis est valable 30 jours",
    notFound: "Devis introuvable",
    checkLink: "Veuillez vérifier le lien",
    networkError: "Erreur réseau",
    loading: "Chargement...",
    signTitle: "Accepter et signer",
    signHint: "Dessinez votre signature ci-dessous pour accepter ce devis",
    signBtn: "Confirmer et signer",
    signClear: "Effacer",
    signed: "Signé",
    signedMsg: "Ce devis a été accepté et signé.",
    signing: "Soumission...",
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
              ? "bg-white text-blue-700 shadow-sm"
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
        body: JSON.stringify({ signatureDataUrl: signatureData }),
      }).then((r) => r.json());
      if (res.signed) {
        setSignSuccess(true);
        setQuote((q) => q ? { ...q, signedAt: res.signedAt, status: "accepted" } : q);
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-sm text-slate-400">{t.loading}</div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-700 mb-1">
            {error || t.notFound}
          </h2>
          <p className="text-sm text-slate-400">{t.checkLink}</p>
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-8 px-4">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6 rounded-2xl bg-white shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5">
            <div className="flex items-start justify-between">
              <div className="text-white">
                <h1 className="text-xl font-bold tracking-tight">{t.brand}</h1>
                <p className="text-blue-100 text-sm mt-0.5">{t.tagline}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <LangSwitcher lang={lang} setLang={handleSetLang} />
                <span className="rounded-full bg-white/20 px-3 py-0.5 text-xs text-white backdrop-blur-sm">
                  {t.quoteV}{quote.version}
                </span>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
            <div>
              <p className="text-sm text-slate-500">{t.preparedFor}</p>
              <p className="text-lg font-semibold text-slate-800">{quote.customerName}</p>
            </div>
            <div className="text-right text-sm text-slate-400">
              <p>{t.date}: {fmtDate(quote.createdAt)}</p>
              <p>{t.by}: {quote.createdBy}</p>
            </div>
          </div>
        </div>

        {/* Items by room */}
        <div className="rounded-2xl bg-white shadow-lg overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">{t.products}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-2.5">{t.room}</th>
                  <th className="px-4 py-2.5">{t.product}</th>
                  <th className="px-4 py-2.5">{t.fabric}</th>
                  <th className="px-4 py-2.5 text-center">{t.size}</th>
                  <th className="px-4 py-2.5 text-right">{t.msrp}</th>
                  <th className="px-4 py-2.5 text-right">{t.price}</th>
                  <th className="px-4 py-2.5 text-right">{t.install}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allItems.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-2.5 font-medium text-slate-700">{item.room}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.product}</td>
                    <td className="px-4 py-2.5 text-slate-500">{item.fabric || "—"}</td>
                    <td className="px-4 py-2.5 text-center text-slate-500">
                      {item.widthIn}" × {item.heightIn}"
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400 line-through">
                      ${item.msrp?.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">
                      ${item.price?.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      ${item.installFee?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Addons */}
        {quote.addons.length > 0 && (
          <div className="rounded-2xl bg-white shadow-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">{t.addons}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-6 py-2.5">{t.item}</th>
                    <th className="px-4 py-2.5 text-center">{t.qty}</th>
                    <th className="px-4 py-2.5 text-right">{t.unitPrice}</th>
                    <th className="px-4 py-2.5 text-right">{t.subtotal}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quote.addons.map((a, i) => (
                    <tr key={i}>
                      <td className="px-6 py-2.5 text-slate-700">{a.displayName}</td>
                      <td className="px-4 py-2.5 text-center text-slate-500">{a.qty}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">${a.unitPrice.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-700">${a.subtotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="rounded-2xl bg-white shadow-lg overflow-hidden mb-6">
          <div className="px-6 py-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-500">
              <span>{t.productSubtotal}</span>
              <span>${quote.merchSubtotal?.toFixed(2)}</span>
            </div>
            {(quote.addonsSubtotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>{t.addonsLabel}</span>
                <span>${quote.addonsSubtotal?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-500">
              <span>{t.installation}</span>
              <span>${quote.installApplied?.toFixed(2)}</span>
            </div>
            {(quote.deliveryFee ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>{t.delivery}</span>
                <span>${quote.deliveryFee?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-500">
              <span>{t.tax} ({((quote.taxRate ?? 0) * 100).toFixed(1)}%)</span>
              <span>${quote.taxAmount?.toFixed(2)}</span>
            </div>
            <div className="border-t border-slate-200 pt-3 flex justify-between">
              <span className="text-base font-bold text-slate-800">{t.total}</span>
              <span className="text-xl font-bold text-blue-600">
                ${quote.grandTotal?.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="rounded-2xl bg-white shadow-lg overflow-hidden mb-6 px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">{t.notes}</h3>
            <p className="text-sm text-slate-500 whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Signature section */}
        <div className="rounded-2xl bg-white shadow-lg overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <PenLine size={16} className="text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-700">{t.signTitle}</h2>
          </div>
          <div className="px-6 py-5">
            {quote.signedAt || signSuccess ? (
              <div className="flex flex-col items-center py-4">
                <div className="rounded-full bg-emerald-100 p-3 mb-3">
                  <Check size={28} className="text-emerald-600" />
                </div>
                <p className="text-sm font-semibold text-emerald-700">{t.signed}</p>
                <p className="text-xs text-slate-400 mt-1">{t.signedMsg}</p>
                {quote.signedAt && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {fmtDate(quote.signedAt)}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500 mb-3">{t.signHint}</p>
                <SignaturePad
                  onSign={(dataUrl) => setSignatureData(dataUrl)}
                  onClear={() => setSignatureData(null)}
                  clearLabel={t.signClear}
                />
                {signatureData && (
                  <button
                    onClick={handleSign}
                    disabled={signing}
                    className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all"
                  >
                    {signing ? t.signing : t.signBtn}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 mt-8 pb-8">
          <p>{t.footer1}</p>
          <p className="mt-1">{t.footer2}</p>
        </div>
      </div>
    </div>
  );
}
