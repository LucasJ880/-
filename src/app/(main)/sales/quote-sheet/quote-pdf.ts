/**
 * 报价单 PDF 导出 — 独立模块
 *
 * 参考 SUNNY SHUTTER INC — ROUGH QUOTE 设计风格：
 *   Page 1 QUOTE 概览（Hero + Meta + Customer/Contact 卡片网格 + KPI）
 *   Page 2 详细清单 + QUOTE TOTALS 两栏表 + 页脚 Hero
 *   Page 3 QUICK SHARE SUMMARY（一页浓缩，适合截图/微信转发）
 *   Page 4 Key Terms of Service Agreement
 *
 * 主色系：橙色 #EA580C（Tailwind orange-600）。
 *
 * 设计目标：
 *   1. 客户侧视觉观感接近参考 PDF（卡片网格 + KPI + 品牌 Hero）
 *   2. 销售可以只导出 Page 3 做"快速分享"
 *   3. 所有代码独立成模块，便于后续换色/加字体/加 Logo 时只改这一处
 */

import type { jsPDF as JsPDFType } from "jspdf";
import type { UserOptions } from "jspdf-autotable";

import type {
  PartBAddon,
  PaymentMethod,
  PartCService,
  PartCAddOn,
  ShadeOrderLine,
  ShutterOrderLine,
  DrapeOrderLine,
  InstallMode,
} from "./types";
import { fractionToInches, HST_RATE } from "./types";
import {
  computeShadeLinePrice,
  computeShutterLinePrice,
  computeDrapeLinePrice,
  type SectionTotals,
} from "./pricing-helpers";
import { formatCAD } from "@/lib/blinds/pricing-engine";

// ── Design tokens ────────────────────────────────────────────────────

export const PDF_TOKENS = {
  // Tailwind orange-600 (#EA580C) — 沉稳、打印不过亮
  primary: [234, 88, 12] as [number, number, number],
  primaryLight: [255, 237, 213] as [number, number, number], // orange-100
  primaryDark: [154, 52, 18] as [number, number, number], // orange-800
  textMain: [28, 25, 23] as [number, number, number], // stone-900
  textMuted: [120, 113, 108] as [number, number, number], // stone-500
  divider: [231, 229, 228] as [number, number, number], // stone-200
  white: [255, 255, 255] as [number, number, number],
};

// ── 公司信息 ─────────────────────────────────────────────────────────

export const COMPANY_INFO = {
  name: "SUNNY SHUTTER INC",
  tagline:
    "Window coverings supply, consultation, and installation support across the GTA.",
  website: "www.sunnyshutter.ca",
  phone: "647-857-8669",
  email: "sales@sunnyshutter.ca",
  address: "680 Progress Avenue, Unit 2, Scarborough, ON, M1H 3A5",
  addressLines: ["680 Progress Avenue, Unit 2,", "Scarborough, ON, M1H 3A5"],
};

// ── 各产品规范条款（对应原纸质 Order Form 第 2 页） ───────────────────
//
// 触发规则：报价单里该产品至少有 1 行有效 line，就在该产品小计后面渲染
// 这部分内容对应 Sunny Shutter 官方 Order Form (Shades/Shutters/Drapes) 第 2 页，
// 是产品工艺、尺寸、公差、硬件等标准条款，客户签字即视为已阅读并同意。

export interface SpecBlock {
  heading: string;
  bullets: string[];
}

export interface ProductSpec {
  title: string;
  intro?: string;
  blocks: SpecBlock[];
  acknowledgement?: string;
}

export const PRODUCT_SPECS: {
  shades: ProductSpec;
  shutters: ProductSpec;
  drapes: ProductSpec;
} = {
  shades: {
    title: "Shades — Workmanship & Specifications",
    intro: "Warranty: 1 year labour · 5 years fabric · 15 years components.",
    blocks: [
      {
        heading: "1. Gaps and Clearances",
        bullets: [
          "Gap between cassette and wall: total gap should not exceed 1/4 inch, ensuring minimal light leakage and aesthetic uniformity.",
          "Gap between cassette and fabric: kept within 7/8 inch to ensure smooth operation and appearance.",
          "Gap between cassette and bottom bar: kept within 3/8 inch so the bottom bar aligns properly with the cassette, maintaining a streamlined appearance and preventing excessive light from filtering through. A deviation of up to 1/8 inch above or below this measurement is acceptable to account for installation tolerances.",
        ],
      },
      {
        heading: "2. Cord Length",
        bullets: [
          "For blinds mounted inside the window frame, the cord length ranges between 60% and 80% of the window height to ensure safety and functionality.",
        ],
      },
      {
        heading: "3. Motorized Blinds",
        bullets: [
          "The charging port for motorized blinds is typically located on the left side of the roller for ease of access during charging and maintenance. Custom placement may be available upon request.",
        ],
      },
    ],
    acknowledgement:
      "I have read and acknowledged the Sunny Shutter Inc policy and agree to the terms and conditions set forth for Shades products.",
  },
  shutters: {
    title: "Shutters — Material & Structural Specifications",
    intro:
      "Wooden shutters: American Yellow Poplar. Vinyl shutters: virgin powder compound. All shutters proudly made in Canada. Warranty: 1 year labour / 5 years components.",
    blocks: [
      {
        heading: "1. Panel Size & Structure",
        bullets: [
          "Maximum panel width: Wood 35\", Vinyl 32\".",
          "Maximum panel width for bi-fold: Wood 52\", Vinyl 40\".",
          "All panel heights over 60\" require a mid-rail for structural support.",
        ],
      },
      {
        heading: "2. Gaps and Clearances",
        bullets: [
          "The gap tolerance between shutter louvers and the frame is kept within industry standards to ensure functionality while allowing minimal light seepage.",
          "Visible gaps are uniform and do not exceed 1/4 inch, in line with typical manufacturing variances. These gaps allow for material expansion and contraction due to temperature and humidity changes without compromising overall aesthetic or performance.",
        ],
      },
      {
        heading: "3. Frame Options",
        bullets: [
          "L Frame — suitable for inside mount or outside mount.",
          "Z Frame — inside mount only.",
          "Casing Frame — outside mount only.",
          "Available frame sizes: 2\" S Frame · 2\" Z Frame · 3 1/4\" M Frame · 2 3/4\" S Frame · 2 1/2\" Z Frame · 2 3/8\" G Frame.",
        ],
      },
      {
        heading: "4. Fit",
        bullets: [
          "Our products are designed to fit standard, straight window frames. Sunny Shutter Inc. is not responsible for issues with fit or alignment caused by uneven or slanted window frames at the customer's location.",
        ],
      },
    ],
    acknowledgement:
      "I have read and acknowledged the Sunny Shutter Inc policy and agree to the terms and conditions set forth for Shutters products.",
  },
  drapes: {
    title: "Drapes & Sheers — Workmanship Specifications",
    intro: "Warranty: 1 year labour · 5 years fabric · 15 years components.",
    blocks: [
      {
        heading: "1.1 Drapery Workmanship",
        bullets: [
          "Joining seams: all joining seams shall be serged with a single stitched seam.",
          "Stitching: first quality with triple-strand washable polyester or mono-filament thread, colour-matched to the fabric. Tension adjusted to eliminate puckering and allow for sagging and stretching.",
          "Heading: 4\" (102 mm) wide double fold with washable Buckrum lining, complete with pinch pleats using Kirsch Architrac Collection #94003 plastic sewn-in hooks. Pleats divided equally at approximately 4\" (102 mm) centres.",
          "Hems: bottom hems 4\" (102 mm) double fold, machine blind stitched. 1\" × 3/4\" covered plastic-coated weights installed in corners of each panel. Side hems 1\" (25 mm) double fold, lock stitched.",
          "Fullness: standard draperies shall have a fullness of 180%.",
        ],
      },
      {
        heading: "1.2 Hardware & Track",
        bullets: [
          "Base specification: STW Aluminum Alloy Silent Track (White), wall bracket — extruded 0.050\" 6063-T5 aluminum alloy, etched and anodized.",
          "25 mm ball-bearing spaced carriers provide 180% drapery fullness.",
          "Heavy-duty wheeled or ball-bearing carriers. Fibreglass, steel, or PVC baton attached to the lead master carrier is recommended for traversing the draperies.",
        ],
      },
      {
        heading: "1.2.1 Length",
        bullets: [
          "Standard distance between the bottom of the finished curtain and the floor is 2\", with an acceptable tolerance of ±1/2\" (13 mm).",
          "Standard installation height is 2\" above the window, with an acceptable tolerance of ±2\" (51 mm).",
          "Final installation details are confirmed with the sales representative prior to fabrication.",
        ],
      },
      {
        heading: "1.2.2 Width",
        bullets: [
          "Finished curtains are fabricated to cover the window and extend 10\" (254 mm) on each side, with an acceptable tolerance of ±2\" (51 mm).",
        ],
      },
      {
        heading: "Fit",
        bullets: [
          "Our products are designed to fit standard, straight window frames. Sunny Shutter Inc. is not responsible for issues with fit or alignment caused by uneven or slanted window frames at the customer's location.",
        ],
      },
    ],
    acknowledgement:
      "I have read and acknowledged the Sunny Shutter Inc policy and agree to the terms and conditions set forth for Drapes & Sheers products.",
  },
};

// ── 输入数据 ─────────────────────────────────────────────────────────

export interface QuotePdfInput {
  orderNumber: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  salesRep: string;
  installMode: InstallMode;
  shadeOrders: ShadeOrderLine[];
  shutterOrders: ShutterOrderLine[];
  shutterMaterial: "Wooden" | "Vinyl";
  shutterLouverSize: string;
  drapeOrders: DrapeOrderLine[];
  partBAddons: PartBAddon[];
  partCServices: PartCService[];
  partCAddOns: PartCAddOn[];
  subtotalB: number;
  subtotalC: number;
  shadeTotals: SectionTotals;
  shutterTotals: SectionTotals;
  drapeTotals: SectionTotals;
  productsSubtotal: number;
  paymentMethod: PaymentMethod;
  depositAmount: string;
  balanceAmount: string;
  financeEligible: string;
  financeApproved: string;
  signatureDataUrl?: string | null; // Part B 签名（可选）
  logoDataUrl?: string | null; // 公司 Logo（可选，加载失败时用文字 logo 降级）
}

// ── 工具：加载 /logo.png（客户端调用，失败时返回 null） ───────────────

export async function loadLogoAsDataUrl(
  logoPath = "/logo.png",
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(logoPath);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── 几何/布局常量 ───────────────────────────────────────────────────

const PAGE_FORMAT = "letter"; // 8.5 × 11 inch
const MARGIN = 14; // mm

// ── 小工具 ─────────────────────────────────────────────────────────

interface Ctx {
  doc: JsPDFType;
  pageW: number;
  pageH: number;
  y: number;
}

function setFill(doc: JsPDFType, rgb: [number, number, number]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc: JsPDFType, rgb: [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
function setText(doc: JsPDFType, rgb: [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

// ── 绘图组件 ─────────────────────────────────────────────────────────

/** 顶部 Hero：大号标题 + 公司副标题 + 简介 + 右侧可选 Logo */
function drawHero(
  ctx: Ctx,
  opts: { title: string; subtitle: string; description: string; logoDataUrl?: string | null },
) {
  const { doc, pageW } = ctx;
  const x = MARGIN;
  let y = MARGIN;

  // Logo（SUNNY Home Decor 官方 logo，原图 592×296，比例 2:1）
  // 若 /logo.png 缺失则此块跳过，标题区仍然好看
  const logoW = 36;
  const logoH = 18;
  if (opts.logoDataUrl) {
    try {
      doc.addImage(opts.logoDataUrl, "PNG", pageW - MARGIN - logoW, y, logoW, logoH);
    } catch {
      /* ignore logo fail */
    }
  }

  // Title
  setText(doc, PDF_TOKENS.textMain);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(32);
  doc.text(opts.title.toUpperCase(), x, y + 10);

  // Subtitle
  setText(doc, PDF_TOKENS.primary);
  doc.setFontSize(13);
  doc.text(opts.subtitle.toUpperCase(), x, y + 17);

  // Description（避开右上 logo 区域）
  setText(doc, PDF_TOKENS.textMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const descMaxW = pageW - MARGIN * 2 - logoW - 4;
  const descLines = doc.splitTextToSize(opts.description, descMaxW);
  doc.text(descLines, x, y + 24);

  ctx.y = y + 24 + descLines.length * 3.5 + 4;
}

/** Meta Bar：一行 label-value 小条，例如 QUOTE REFERENCE / GENERATED / SALES REP */
function drawMetaBar(ctx: Ctx, items: Array<{ label: string; value: string }>) {
  const { doc, pageW } = ctx;
  const x = MARGIN;
  const y = ctx.y;
  const w = pageW - MARGIN * 2;
  const h = 14;

  // 底色条（浅橙）
  setFill(doc, PDF_TOKENS.primaryLight);
  doc.rect(x, y, w, h, "F");

  // 左侧竖条（主色）
  setFill(doc, PDF_TOKENS.primary);
  doc.rect(x, y, 2, h, "F");

  const cellW = (w - 4) / items.length;
  items.forEach((item, i) => {
    const cx = x + 4 + i * cellW;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(item.label.toUpperCase(), cx + 3, y + 5);
    setText(doc, PDF_TOKENS.textMain);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(item.value || "—", cx + 3, y + 11);
  });

  ctx.y = y + h + 6;
}

/** Section 标题带（左侧主色竖条 + 标题） */
function drawSectionBanner(ctx: Ctx, title: string) {
  const { doc } = ctx;
  const y = ctx.y;
  setFill(doc, PDF_TOKENS.primary);
  doc.rect(MARGIN, y, 3, 5.5, "F");
  setText(doc, PDF_TOKENS.textMain);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), MARGIN + 5, y + 4);
  ctx.y = y + 7;
}

interface InfoCard {
  label: string;
  value: string;
}

/** Info 卡片网格：label-value 小卡，白底 + 浅橙左竖条 */
function drawInfoGrid(ctx: Ctx, cards: InfoCard[], cols: number) {
  const { doc, pageW } = ctx;
  const x = MARGIN;
  const y = ctx.y;
  const gap = 3;
  const w = pageW - MARGIN * 2;
  const cellW = (w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(cards.length / cols);
  const cellH = 16;

  for (let i = 0; i < cards.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = x + c * (cellW + gap);
    const cy = y + r * (cellH + gap);

    // 边框
    setDraw(doc, PDF_TOKENS.divider);
    doc.setLineWidth(0.3);
    doc.rect(cx, cy, cellW, cellH, "S");
    // 左竖条
    setFill(doc, PDF_TOKENS.primary);
    doc.rect(cx, cy, 1.5, cellH, "F");

    // Label
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text(cards[i].label.toUpperCase(), cx + 4, cy + 4);

    // Value（最多 2 行）
    setText(doc, PDF_TOKENS.textMain);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const vLines = doc.splitTextToSize(cards[i].value || "—", cellW - 6);
    const max2 = vLines.slice(0, 2);
    doc.text(max2, cx + 4, cy + 9);
  }

  ctx.y = y + rows * (cellH + gap) + 2;
}

/** KPI 卡片网格：数值大、label 小，强调卡用主色填充 */
function drawKpiGrid(
  ctx: Ctx,
  kpis: Array<{ label: string; value: string; emphasize?: boolean }>,
  cols = kpis.length,
) {
  const { doc, pageW } = ctx;
  const x = MARGIN;
  const y = ctx.y;
  const gap = 3;
  const w = pageW - MARGIN * 2;
  const cellW = (w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(kpis.length / cols);
  const cellH = 20;

  for (let i = 0; i < kpis.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = x + c * (cellW + gap);
    const cy = y + r * (cellH + gap);

    if (kpis[i].emphasize) {
      setFill(doc, PDF_TOKENS.primary);
      doc.rect(cx, cy, cellW, cellH, "F");
      setText(doc, PDF_TOKENS.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(kpis[i].label.toUpperCase(), cx + 4, cy + 5);
      setText(doc, PDF_TOKENS.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(kpis[i].value, cx + 4, cy + 14);
    } else {
      setDraw(doc, PDF_TOKENS.divider);
      doc.setLineWidth(0.3);
      doc.rect(cx, cy, cellW, cellH, "S");
      setText(doc, PDF_TOKENS.primaryDark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(kpis[i].label.toUpperCase(), cx + 4, cy + 5);
      setText(doc, PDF_TOKENS.textMain);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(kpis[i].value, cx + 4, cy + 14);
    }
  }

  ctx.y = y + rows * (cellH + gap) + 2;
}

/** 宽 Grand Total 强调条（大号主色块） */
function drawGrandTotalBar(ctx: Ctx, label: string, value: string) {
  const { doc, pageW } = ctx;
  const y = ctx.y;
  const w = pageW - MARGIN * 2;
  const h = 14;
  setFill(doc, PDF_TOKENS.primary);
  doc.rect(MARGIN, y, w, h, "F");
  setText(doc, PDF_TOKENS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(label.toUpperCase(), MARGIN + 5, y + 9);
  doc.setFontSize(16);
  doc.text(value, MARGIN + w - 5, y + 10, { align: "right" });
  ctx.y = y + h + 4;
}

/** QUOTE TOTALS 两栏表 */
function drawTotalsTable(
  ctx: Ctx,
  rows: Array<{ label: string; value: string; emphasize?: boolean; hint?: string }>,
) {
  const { doc, pageW } = ctx;
  const x = MARGIN;
  let y = ctx.y;
  const w = pageW - MARGIN * 2;
  const lineH = 7;

  rows.forEach((r, i) => {
    // 隔行填充浅橙
    if (i % 2 === 0) {
      setFill(doc, [250, 247, 244]);
      doc.rect(x, y, w, lineH, "F");
    }
    if (r.emphasize) {
      setFill(doc, PDF_TOKENS.primary);
      doc.rect(x, y, w, lineH + 1, "F");
      setText(doc, PDF_TOKENS.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(r.label.toUpperCase(), x + 4, y + 5.5);
      doc.text(r.value, x + w - 4, y + 5.5, { align: "right" });
      y += lineH + 1;
    } else {
      setText(doc, PDF_TOKENS.textMain);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(r.label, x + 4, y + 5);
      doc.setFont("helvetica", "normal");
      doc.text(r.value, x + w - 4, y + 5, { align: "right" });
      y += lineH;
      if (r.hint) {
        setText(doc, PDF_TOKENS.textMuted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        const lines = doc.splitTextToSize(r.hint, w * 0.6);
        doc.text(lines, x + 4, y + 3);
        y += lines.length * 3 + 1;
      }
    }
  });

  ctx.y = y + 4;
}

/** 每页底部页码 + 公司名小字 */
function drawPageFooter(ctx: Ctx, pageIdx: number, pageTotal: number) {
  const { doc, pageW, pageH } = ctx;
  setText(doc, PDF_TOKENS.textMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(COMPANY_INFO.name, MARGIN, pageH - 6);
  doc.text(`${pageIdx} / ${pageTotal}`, pageW - MARGIN, pageH - 6, { align: "right" });
  // 顶部细橙线
  setDraw(doc, PDF_TOKENS.primary);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, pageH - 10, pageW - MARGIN, pageH - 10);
}

/** 尾页品牌 Hero（Page 2 底部） */
function drawFooterHero(ctx: Ctx) {
  const { doc, pageW, pageH } = ctx;
  const h = 40;
  const y = pageH - h - 12;

  setFill(doc, PDF_TOKENS.primaryLight);
  doc.rect(MARGIN, y, pageW - MARGIN * 2, h, "F");
  setFill(doc, PDF_TOKENS.primary);
  doc.rect(MARGIN, y, 3, h, "F");

  setText(doc, PDF_TOKENS.primaryDark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(COMPANY_INFO.name, MARGIN + 8, y + 9);

  setText(doc, PDF_TOKENS.textMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(COMPANY_INFO.tagline, MARGIN + 8, y + 15, {
    maxWidth: pageW - MARGIN * 2 - 12,
  });

  setText(doc, PDF_TOKENS.textMain);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(COMPANY_INFO.website, MARGIN + 8, y + 23);
  doc.text(COMPANY_INFO.phone, MARGIN + 8, y + 28);
  doc.text(COMPANY_INFO.email, MARGIN + 8, y + 33);
  doc.text(COMPANY_INFO.address, pageW - MARGIN - 4, y + 33, { align: "right" });
}

// ── 主函数 ───────────────────────────────────────────────────────────

export async function exportQuotePdf(input: QuotePdfInput): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: PAGE_FORMAT });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const ctx: Ctx = { doc, pageW, pageH, y: MARGIN };

  // 计算线项数量
  const filledShades = input.shadeOrders.filter((l) => {
    const p = computeShadeLinePrice(l, input.installMode);
    return p && !p.error && (l.location || l.sku);
  });
  const filledShutters = input.shutterOrders.filter((l) => {
    const p = computeShutterLinePrice(l, input.shutterMaterial, input.installMode);
    return p && !p.error && (l.location || l.widthWhole);
  });
  const filledDrapes = input.drapeOrders.filter((l) => {
    const p = computeDrapeLinePrice(l, input.installMode);
    return p && !p.error && (l.location || l.drapeFabricSku || l.sheerFabricSku);
  });
  const lineItemCount =
    filledShades.length +
    filledShutters.reduce((s, l) => s + Math.max(1, l.panelCount ?? 1), 0) +
    filledDrapes.length;

  const preTax = input.productsSubtotal + input.subtotalB + input.subtotalC;
  const hst = Math.round(preTax * HST_RATE * 100) / 100;
  const grandTotal = preTax + hst;

  // ────────────────────────────────────────────────────
  // PAGE 1 — QUOTE 概览
  // ────────────────────────────────────────────────────

  drawHero(ctx, {
    title: "QUOTE",
    subtitle: COMPANY_INFO.name,
    description:
      "Formal quote prepared from confirmed sizes and selections. Pricing is valid 15 days from the generation date; final charges may adjust after measurement confirmation and site review.",
    logoDataUrl: input.logoDataUrl,
  });

  drawMetaBar(ctx, [
    { label: "Quote Reference", value: input.orderNumber || "—" },
    { label: "Generated", value: input.date || "—" },
    { label: "Sales Rep", value: input.salesRep || "—" },
  ]);

  // Customer
  drawSectionBanner(ctx, "Customer");
  drawInfoGrid(
    ctx,
    [
      { label: "Name", value: input.customerName },
      { label: "Phone", value: input.customerPhone },
      { label: "Email", value: input.customerEmail },
      { label: "Address", value: input.customerAddress },
    ],
    2,
  );

  // Contact Us（公司信息）
  drawSectionBanner(ctx, "Contact Us");
  drawInfoGrid(
    ctx,
    [
      { label: "Website", value: COMPANY_INFO.website },
      { label: "Phone", value: COMPANY_INFO.phone },
      { label: "Email", value: COMPANY_INFO.email },
      { label: "Address", value: COMPANY_INFO.addressLines.join(" ") },
    ],
    2,
  );

  // Quote Summary KPI
  drawSectionBanner(ctx, "Quote Summary");
  drawKpiGrid(ctx, [
    { label: "Merchandise", value: formatCAD(input.productsSubtotal) },
    { label: "Add-ons (B)", value: formatCAD(input.subtotalB) },
    {
      label: input.installMode === "pickup" ? "Install (Pickup)" : "Install (C)",
      value: formatCAD(input.subtotalC),
    },
    { label: "HST 13%", value: formatCAD(hst) },
  ]);

  drawGrandTotalBar(ctx, "Grand Total", formatCAD(grandTotal));

  // Page 1 footer
  drawPageFooter(ctx, 1, 4);

  // ────────────────────────────────────────────────────
  // PAGE 2 — 详细清单 + Totals
  // ────────────────────────────────────────────────────

  doc.addPage();
  ctx.y = MARGIN;

  drawHero(ctx, {
    title: "Quoted Items",
    subtitle: "Detailed line items",
    description: "All prices shown in CAD. Item-level merchandise and installation are listed separately.",
    logoDataUrl: input.logoDataUrl,
  });

  // Shared autoTable style — 橙色表头
  const sharedTable: Partial<UserOptions> = {
    margin: { left: MARGIN, right: MARGIN },
    headStyles: {
      fillColor: PDF_TOKENS.primary,
      textColor: PDF_TOKENS.white,
      fontSize: 7,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 7, textColor: PDF_TOKENS.textMain },
    alternateRowStyles: { fillColor: [250, 247, 244] },
    theme: "grid",
    styles: { lineColor: PDF_TOKENS.divider, lineWidth: 0.1 },
  };

  const getLastY = () =>
    (doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? ctx.y;

  const maybePageBreak = (needed: number) => {
    if (ctx.y + needed > pageH - 20) {
      drawPageFooter(ctx, doc.getNumberOfPages(), 4);
      doc.addPage();
      ctx.y = MARGIN;
    }
  };

  // 渲染产品规范条款（对应原纸质 Order Form 第 2 页）
  // 仅当该产品有有效 line 时才调用；每段规范强制另起一页（对齐纸质订单第 2 页的视觉节奏）
  const renderSpecsSection = (spec: ProductSpec) => {
    // 规范始终从新页开始：先结束当前页的页脚，再换页
    drawPageFooter(ctx, doc.getNumberOfPages(), 4);
    doc.addPage();
    ctx.y = MARGIN;

    drawSectionBanner(ctx, spec.title);

    if (spec.intro) {
      setText(doc, PDF_TOKENS.textMuted);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      const introLines = doc.splitTextToSize(spec.intro, pageW - MARGIN * 2 - 4);
      doc.text(introLines, MARGIN, ctx.y + 3);
      ctx.y += introLines.length * 4 + 3;
    }

    spec.blocks.forEach((block) => {
      // 预估空间：标题 6mm + 每条 bullet 大约 2 行 × 4mm + 间距
      maybePageBreak(10 + block.bullets.length * 10);

      setText(doc, PDF_TOKENS.primaryDark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(block.heading, MARGIN, ctx.y + 4);
      ctx.y += 6;

      setText(doc, PDF_TOKENS.textMain);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      block.bullets.forEach((b) => {
        const lines = doc.splitTextToSize(b, pageW - MARGIN * 2 - 8);
        // 若空间不够放整条 bullet，先翻页再画（避免一条 bullet 被撕开太丑）
        if (ctx.y + lines.length * 4 + 2 > pageH - 20) {
          drawPageFooter(ctx, doc.getNumberOfPages(), 4);
          doc.addPage();
          ctx.y = MARGIN;
        }
        // 小橙点
        setFill(doc, PDF_TOKENS.primary);
        doc.circle(MARGIN + 2, ctx.y + 2.5, 0.7, "F");
        setText(doc, PDF_TOKENS.textMain);
        doc.text(lines, MARGIN + 5, ctx.y + 3);
        ctx.y += lines.length * 4 + 2;
      });
      ctx.y += 2;
    });

    if (spec.acknowledgement) {
      maybePageBreak(14);
      setFill(doc, PDF_TOKENS.primaryLight);
      const ackLines = doc.splitTextToSize(spec.acknowledgement, pageW - MARGIN * 2 - 8);
      const boxH = ackLines.length * 4 + 6;
      doc.rect(MARGIN, ctx.y, pageW - MARGIN * 2, boxH, "F");
      setFill(doc, PDF_TOKENS.primary);
      doc.rect(MARGIN, ctx.y, 2, boxH, "F");
      setText(doc, PDF_TOKENS.primaryDark);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(ackLines, MARGIN + 5, ctx.y + 4);
      ctx.y += boxH + 4;
    }

    ctx.y += 2;
  };

  // Shades
  if (filledShades.length > 0) {
    maybePageBreak(30);
    drawSectionBanner(ctx, "Shades");
    autoTable(doc, {
      ...sharedTable,
      startY: ctx.y,
      head: [["#", "Room", "Product", "SKU", "W\"", "H\"", "Mount/Lift", "Merch", "Install", "Line"]],
      body: filledShades.map((l, i) => {
        const p = computeShadeLinePrice(l, input.installMode);
        const w = fractionToInches(l.widthWhole, l.widthFrac);
        const h = fractionToInches(l.heightWhole, l.heightFrac);
        return [
          i + 1,
          l.location || "—",
          l.product,
          l.sku,
          w.toFixed(2),
          h.toFixed(2),
          [l.mount, l.lift].filter(Boolean).join("/"),
          `$${p!.merch.toFixed(2)}`,
          `$${p!.install.toFixed(2)}`,
          `$${p!.total.toFixed(2)}`,
        ];
      }),
    });
    ctx.y = getLastY() + 2;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Shades Subtotal: ${formatCAD(input.shadeTotals.total)}`, pageW - MARGIN, ctx.y + 4, { align: "right" });
    ctx.y += 10;
    renderSpecsSection(PRODUCT_SPECS.shades);
  }

  // Shutters
  if (filledShutters.length > 0) {
    maybePageBreak(30);
    drawSectionBanner(
      ctx,
      `Shutters (${input.shutterMaterial}${input.shutterLouverSize ? `, Louver ${input.shutterLouverSize}` : ""})`,
    );
    autoTable(doc, {
      ...sharedTable,
      startY: ctx.y,
      head: [["#", "Room", "W\"", "H\"", "Frame", "Mount", "Panels", "Merch", "Install", "Line"]],
      body: filledShutters.map((l, i) => {
        const p = computeShutterLinePrice(l, input.shutterMaterial, input.installMode);
        const w = fractionToInches(l.widthWhole, l.widthFrac);
        const h = fractionToInches(l.heightWhole, l.heightFrac);
        return [
          i + 1,
          l.location || "—",
          w.toFixed(2),
          h.toFixed(2),
          l.frame || "",
          l.mountType || "",
          l.panelCount ?? "",
          `$${p!.merch.toFixed(2)}`,
          `$${p!.install.toFixed(2)}`,
          `$${p!.total.toFixed(2)}`,
        ];
      }),
    });
    ctx.y = getLastY() + 2;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Shutters Subtotal: ${formatCAD(input.shutterTotals.total)}`, pageW - MARGIN, ctx.y + 4, { align: "right" });
    ctx.y += 10;
    renderSpecsSection(PRODUCT_SPECS.shutters);
  }

  // Drapes
  if (filledDrapes.length > 0) {
    maybePageBreak(30);
    drawSectionBanner(ctx, "Drapes & Sheers");
    const drapeRows: (string | number)[][] = [];
    filledDrapes.forEach((l, i) => {
      const p = computeDrapeLinePrice(l, input.installMode)!;
      if (p.drapeMerch > 0 || (l.drapeFabricSku && l.drapeWidthWhole)) {
        const w = fractionToInches(l.drapeWidthWhole, l.drapeWidthFrac);
        const h = fractionToInches(l.drapeHeightWhole, l.drapeHeightFrac);
        drapeRows.push([
          i + 1,
          l.location || "—",
          "Drape",
          l.drapeFabricSku,
          w.toFixed(2),
          h.toFixed(2),
          `$${p.drapeMerch.toFixed(2)}`,
          `$${p.drapeInstall.toFixed(2)}`,
        ]);
      }
      if (p.sheerMerch > 0 || (l.sheerFabricSku && l.sheerWidthWhole)) {
        const w = fractionToInches(l.sheerWidthWhole, l.sheerWidthFrac);
        const h = fractionToInches(l.sheerHeightWhole, l.sheerHeightFrac);
        drapeRows.push([
          i + 1,
          l.location || "—",
          "Sheer",
          l.sheerFabricSku,
          w.toFixed(2),
          h.toFixed(2),
          `$${p.sheerMerch.toFixed(2)}`,
          `$${p.sheerInstall.toFixed(2)}`,
        ]);
      }
    });
    autoTable(doc, {
      ...sharedTable,
      startY: ctx.y,
      head: [["#", "Room", "Type", "SKU", "W\"", "H\"", "Merch", "Install"]],
      body: drapeRows,
    });
    ctx.y = getLastY() + 2;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Drapes Subtotal: ${formatCAD(input.drapeTotals.total)}`, pageW - MARGIN, ctx.y + 4, { align: "right" });
    ctx.y += 10;
    renderSpecsSection(PRODUCT_SPECS.drapes);
  }

  // Part B
  if (input.partBAddons.length > 0) {
    maybePageBreak(30);
    drawSectionBanner(ctx, "Part B — Add-ons");
    autoTable(doc, {
      ...sharedTable,
      startY: ctx.y,
      head: [["SKU / Item", "QTY", "Unit Price", "Total"]],
      body: input.partBAddons.map((a) => [a.skuItem, a.qty, `$${a.price.toFixed(2)}`, `$${a.total.toFixed(2)}`]),
    });
    ctx.y = getLastY() + 2;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Add-ons Subtotal: ${formatCAD(input.subtotalB)}`, pageW - MARGIN, ctx.y + 4, { align: "right" });
    ctx.y += 10;
  }

  // Part C
  const activeServices = input.partCServices.filter((s) => s.qty > 0);
  const activeAddOns = input.partCAddOns.filter((a) => a.qty > 0);
  if (input.installMode !== "pickup" && (activeServices.length > 0 || activeAddOns.length > 0)) {
    maybePageBreak(30);
    drawSectionBanner(ctx, "Part C — Installation Services");
    const rowsC: (string | number)[][] = [];
    activeServices.forEach((s) => rowsC.push([s.type, s.qty, `$${s.unitPrice.toFixed(2)}`, `$${s.total.toFixed(2)}`]));
    activeAddOns.forEach((a) => rowsC.push([a.type, a.qty, `$${a.unitPrice.toFixed(2)}`, `$${a.total.toFixed(2)}`]));
    autoTable(doc, {
      ...sharedTable,
      startY: ctx.y,
      head: [["Service", "QTY", "Unit Price", "Total"]],
      body: rowsC,
    });
    ctx.y = getLastY() + 2;
    setText(doc, PDF_TOKENS.primaryDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Installation Subtotal: ${formatCAD(input.subtotalC)}`, pageW - MARGIN, ctx.y + 4, { align: "right" });
    ctx.y += 10;
  }

  // QUOTE TOTALS
  maybePageBreak(80);
  drawSectionBanner(ctx, "Quote Totals");
  drawTotalsTable(ctx, [
    { label: "Shades Subtotal", value: formatCAD(input.shadeTotals.total) },
    { label: "Shutters Subtotal", value: formatCAD(input.shutterTotals.total) },
    { label: "Drapes & Sheers Subtotal", value: formatCAD(input.drapeTotals.total) },
    { label: "Add-ons (Part B)", value: formatCAD(input.subtotalB) },
    {
      label: "Installation (Part C)",
      value: formatCAD(input.subtotalC),
      hint:
        input.installMode === "pickup"
          ? "Pickup mode — installation waived"
          : "Includes labour. Minimum $200 applies per project.",
    },
    { label: "Subtotal (before tax)", value: formatCAD(preTax) },
    { label: "HST 13%", value: formatCAD(hst) },
    { label: "Grand Total", value: formatCAD(grandTotal), emphasize: true },
  ]);

  // 签名（保持现有行为：只放 Part B 签名）
  if (input.signatureDataUrl) {
    maybePageBreak(30);
    drawSectionBanner(ctx, "Signature");
    setText(doc, PDF_TOKENS.textMuted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(
      "Customer signature captured at quote confirmation. By signing, the customer acknowledges the scope, pricing, and terms of this quote.",
      MARGIN,
      ctx.y + 3,
      { maxWidth: pageW - MARGIN * 2 },
    );
    ctx.y += 8;
    try {
      doc.addImage(input.signatureDataUrl, "PNG", MARGIN, ctx.y, 60, 18);
      ctx.y += 20;
    } catch {
      /* ignore bad sig */
    }
  }

  // Payment line
  setText(doc, PDF_TOKENS.textMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const paymentLine =
    input.paymentMethod === "direct"
      ? `Payment: Direct — Deposit ${input.depositAmount || "—"} / Balance ${input.balanceAmount || "—"}`
      : `Payment: Financeit — Eligible ${input.financeEligible || "—"} / Approved ${input.financeApproved || "—"}`;
  doc.text(paymentLine, MARGIN, ctx.y + 3);
  ctx.y += 8;

  // 底部品牌 Hero — 仅当本页剩余空间足够时放，否则开新页
  if (ctx.y < pageH - 60) {
    drawFooterHero(ctx);
  }
  drawPageFooter(ctx, doc.getNumberOfPages(), 4);

  // ────────────────────────────────────────────────────
  // PAGE 3 — QUICK SHARE SUMMARY
  // ────────────────────────────────────────────────────

  doc.addPage();
  ctx.y = MARGIN;

  drawHero(ctx, {
    title: "Quick Share Summary",
    subtitle: COMPANY_INFO.name,
    description:
      "A one-page condensed summary for easy screenshot sharing or light-ink printing. The detailed quoted items and full calculation breakdown are on the earlier pages.",
    logoDataUrl: input.logoDataUrl,
  });

  drawMetaBar(ctx, [
    { label: "Quote Reference", value: input.orderNumber || "—" },
    { label: "Generated", value: input.date || "—" },
    { label: "Sales Rep", value: input.salesRep || "—" },
  ]);

  // 6 KPI 卡
  drawSectionBanner(ctx, "Snapshot");
  drawKpiGrid(
    ctx,
    [
      { label: "Line Items", value: String(lineItemCount) },
      { label: "Order Type", value: input.installMode === "pickup" ? "Supply (Pickup)" : "Supply + Install" },
      { label: "Tax", value: "HST 13%" },
      { label: "Merchandise", value: formatCAD(input.productsSubtotal) },
      { label: "Before Tax", value: formatCAD(preTax) },
      { label: "Grand Total", value: formatCAD(grandTotal), emphasize: true },
    ],
    3,
  );

  // Project snapshot 短说明
  drawSectionBanner(ctx, "Project Snapshot");
  setText(doc, PDF_TOKENS.textMain);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    [
      `Customer: ${input.customerName || "—"}  ·  ${input.customerPhone || "—"}`,
      `Address: ${input.customerAddress || "—"}`,
      input.customerEmail ? `Email: ${input.customerEmail}` : "",
    ].filter(Boolean),
    MARGIN,
    ctx.y + 4,
    { maxWidth: pageW - MARGIN * 2 },
  );
  ctx.y += 18;

  // Totals snapshot
  drawSectionBanner(ctx, "Quote Totals");
  drawTotalsTable(ctx, [
    { label: "Merchandise", value: formatCAD(input.productsSubtotal) },
    { label: "Add-ons (B)", value: formatCAD(input.subtotalB) },
    { label: "Installation (C)", value: formatCAD(input.subtotalC) },
    { label: "Subtotal (before tax)", value: formatCAD(preTax) },
    { label: "HST 13%", value: formatCAD(hst) },
    { label: "Grand Total", value: formatCAD(grandTotal), emphasize: true },
  ]);

  // 使用说明小字
  setText(doc, PDF_TOKENS.textMuted);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.text(
    "Best use: this page is a condensed summary for screenshot sharing, quick client review, or lighter-ink printing.",
    MARGIN,
    ctx.y + 3,
    { maxWidth: pageW - MARGIN * 2 },
  );

  drawPageFooter(ctx, doc.getNumberOfPages(), 4);

  // ────────────────────────────────────────────────────
  // PAGE 4 — Key Terms
  // ────────────────────────────────────────────────────

  doc.addPage();
  ctx.y = MARGIN;

  drawHero(ctx, {
    title: "Key Terms",
    subtitle: "Terms of Service Agreement",
    description: "Please read these terms carefully. Your confirmation of this quote constitutes acceptance.",
    logoDataUrl: input.logoDataUrl,
  });

  drawSectionBanner(ctx, "Terms");
  const terms = [
    "Validity of this quote: 15 days from the date of issuance.",
    "A 2-hour delivery window will be provided 2 days before the scheduled installation date.",
    "Rescheduling must be requested at least 3 business days before the scheduled date.",
    "The normal lead time for custom-made items is approximately 3-4 weeks.",
    "Installation will only be scheduled after the entire balance is received.",
    "Custom-made items: returns or exchanges are only accepted if the product is defective.",
    "Our products are designed to fit standard, straight window frames.",
    "Delivery is quoted for GTA only; long-distance surcharges may apply based on final site conditions.",
  ];
  setText(doc, PDF_TOKENS.textMain);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  terms.forEach((t, i) => {
    const lines = doc.splitTextToSize(`${i + 1}. ${t}`, pageW - MARGIN * 2 - 4);
    doc.text(lines, MARGIN + 2, ctx.y + 4);
    ctx.y += lines.length * 4.5 + 2;
  });

  // 条款页底部 Hero
  ctx.y = Math.max(ctx.y, pageH - 60);
  drawFooterHero(ctx);
  drawPageFooter(ctx, doc.getNumberOfPages(), 4);

  // 回头修正所有页脚的"总页数"
  // （因为前面在 maybePageBreak 时先写了占位，若中间 addPage 了总数可能 > 4）
  const realTotal = doc.getNumberOfPages();
  for (let p = 1; p <= realTotal; p++) {
    doc.setPage(p);
    // 清掉原本"/ 4"的位置并重绘 — 采用覆盖写：用白色块覆盖旧页码区域
    setFill(doc, [255, 255, 255]);
    doc.rect(pageW - MARGIN - 20, pageH - 10, 20, 6, "F");
    setText(doc, PDF_TOKENS.textMuted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`${p} / ${realTotal}`, pageW - MARGIN, pageH - 6, { align: "right" });
  }

  doc.save(`Quote_${input.orderNumber || "draft"}_${input.date}.pdf`);
}
