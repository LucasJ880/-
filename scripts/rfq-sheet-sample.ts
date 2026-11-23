/**
 * RFQ-PDF-2 询价单样张 — 真实 Chromium（手工脚本，不进 test-all.sh）
 *
 * 用一份虚构的联邦标样例（睡袋与睡垫）经询价单生成器与附件模板生成 PDF：
 *   - 14 条与 60 条两份（英文对照 8pt）、14 条一份 7.5pt（给 Evan 打印后定字号）；
 *   - 输出页数、字节数、是否内嵌 Noto Sans SC、文字层里有没有招标身份；
 *   - 长编号 `MAND-TECH-0012` 与右边一列的文字在 PDF 文字层里不重叠；
 *   - `pdftoppm` 可用时把首页转成 PNG。
 * 不需要数据库。找不到 Chromium 时打印 SKIP 并退出 0。
 *
 * 运行：CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx tsx scripts/rfq-sheet-sample.ts [输出目录]
 * 默认输出到 docs/acceptance/rfq-pdf-2/。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { buildProjectIdentityDenyList } from "@/lib/bid-workflow/project-identity-deny";
import { buildRfqDocument, type RfqRequirementInput } from "@/lib/tender-rfq/build";
import { checkRfqAttachmentPdf, countPdfPages, renderRfqAttachmentHtml } from "@/lib/tender-rfq/attachment";

const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/rfq-pdf-2");
const LOCATION = "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9";
const IDENTITY = ["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05", "Constellation", "K1A"];

const denyList = buildProjectIdentityDenyList({
  projectName: "Sleeping Bags and Mats",
  solicitationNumber: "24062-27-057",
  clientOrganization: "Treasury Board of Canada Secretariat",
  closeDate: new Date("2026-12-05T19:00:00Z"),
  timeZone: "America/Toronto",
  facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [LOCATION] },
  allowedEmails: ["project@sunnyshutter.ca"],
});

/** 14 条有代表性的要求（类别打乱；一条长编号、一条没有中文译文、一条非强制） */
const BASE: Array<{ category: string; en: string; zh: string | null; mandatory?: boolean; code?: string }> = [
  { category: "DELIVERY", en: "Delivery shall be completed within 30 calendar days of contract award, DDP destination, in no more than two shipments.", zh: "合同授予后 30 个日历日内交付完毕，DDP 到目的地，最多分两批。" },
  { category: "PRODUCT", en: "Sleeping bags shall have a comfort rating of -20°C or lower, tested in accordance with ISO 23537-1.", zh: "睡袋舒适温度须达到 -20°C 或更低，按 ISO 23537-1 测试。" },
  { category: "TECHNICAL", code: "MAND-TECH-0012", en: "Outer shell fabric shall be minimum 40D ripstop nylon with a durable water repellent (DWR) finish; provide fabric specification sheet.", zh: "外壳面料不低于 40D 防撕裂尼龙，带耐久防泼水（DWR）处理；请提供面料规格书。" },
  { category: "SAFETY", en: "All filling materials shall comply with CAN/CGSB-4.2 No. 27.5 flammability requirements; test report from an accredited laboratory is required.", zh: "所有填充材料须符合 CAN/CGSB-4.2 No. 27.5 阻燃要求；须提供认可实验室的检测报告。" },
  { category: "SAMPLES", en: "The bidder shall provide two (2) production-equivalent samples of each item for evaluation, at no additional cost to the buyer.", zh: "须为每个品项提供两件与量产一致的样品供评审，买方不另付费。" },
  { category: "PRODUCT", en: "Sleeping mats shall have an R-value of at least 4.0 measured per ASTM F3340, and a packed size not exceeding 25 cm x 12 cm.", zh: "睡垫 R 值不低于 4.0（按 ASTM F3340 测），收纳尺寸不超过 25 cm × 12 cm。" },
  { category: "WARRANTY", en: "Vendor shall provide a minimum two-year warranty against defects in materials and workmanship from the date of delivery.", zh: "供应商须自交付之日起提供至少两年的材料与工艺质保。" },
  { category: "PERFORMANCE", en: "Zippers shall be YKK #5 or equivalent two-way coil zippers with an anti-snag guard along the full length.", zh: null },
  { category: "SHOP_DRAWINGS", en: "Provide dimensioned drawings showing baffle construction, zipper placement and label location prior to production.", zh: "量产前须提供标注尺寸的图纸，标明隔仓结构、拉链位置与标签位置。" },
  { category: "TECHNICAL", en: "Each sleeping bag shall be supplied with a compression sack and a breathable storage bag; total packed weight shall not exceed 1.9 kg.", zh: "每个睡袋须配压缩袋与透气收纳袋；打包总重不超过 1.9 kg。" },
  { category: "SAFETY", en: "Products shall be free of substances restricted under the Canada Consumer Product Safety Act; provide a declaration of conformity.", zh: "产品不得含《加拿大消费品安全法》限制的物质；须提供符合性声明。" },
  { category: "DELIVERY", en: "Each carton shall be labelled with item description, quantity, lot number and country of origin in English and French.", zh: "每个外箱须用英文与法文标明品名、数量、批号与原产国。" },
  { category: "PRODUCT", mandatory: false, en: "Preference will be given to products using recycled insulation with a minimum of 50% post-consumer content.", zh: "使用回收保温材料（消费后回收成分不低于 50%）的产品优先。" },
  { category: "TRAINING", en: "Vendor shall provide care and maintenance instructions in English and French with each unit.", zh: "供应商须随每件产品提供英文与法文的保养说明。" },
];

function requirements(count: number): RfqRequirementInput[] {
  return Array.from({ length: count }, (_, i) => {
    const b = BASE[i % BASE.length];
    const round = Math.floor(i / BASE.length);
    return {
      requirementCode: b.code && round === 0 ? b.code : `R-${String(i + 1).padStart(3, "0")}`,
      category: b.category,
      originalRequirement: b.en,
      chineseTranslation: b.zh,
      mandatory: b.mandatory ?? true,
      reviewStatus: "CONFIRMED",
      sourcePage: 10 + i,
    };
  });
}

function build(count: number) {
  const built = buildRfqDocument({
    identity: { denyList, reference: "RFQ-SUNNY-2026-7KQ4M" },
    buyerDisplayName: "Sunny Trading Inc.",
    contactName: "王工",
    contactEmail: "project@sunnyshutter.ca",
    closeDate: "2026-12-05T19:00:00Z",
    now: new Date("2026-11-19T15:00:00Z"),
    timeZone: "America/Toronto",
    requirements: requirements(count),
    facts: [
      { type: "location", contentZh: LOCATION, contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true },
      { type: "quantity", contentZh: "睡袋与睡垫各约 1,200 套（一次性采购）", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true },
      { type: "delivery", contentZh: "合同授予后 30 个日历日内交付，最多分两批。", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true },
    ],
    incoterm: "DDP",
    scopeNote: "本轮只询睡袋与睡垫两个品项，不含帐篷。",
  });
  if (!built.ok) throw new Error(`样例没有生成出来：${JSON.stringify(built)}`);
  return built.doc;
}

type TextItem = { str: string; x: number; y: number; width: number };

async function pageTexts(pdf: Buffer): Promise<TextItem[][]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pages: TextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(
      (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
        .filter((it) => typeof it.str === "string" && it.str.trim() && Array.isArray(it.transform))
        .map((it) => ({ str: it.str!, x: it.transform![4], y: it.transform![5], width: it.width ?? 0 })),
    );
  }
  return pages;
}

/** 长编号那一格的每一段文字，右边界都不越过同一行里它右边最近的文字（「要求」一列）的左边界 */
function longCodeOverlap(pages: TextItem[][], code: string): { found: boolean; overlaps: number; detail: string } {
  let found = false;
  let overlaps = 0;
  const detail: string[] = [];
  for (const items of pages) {
    const pieces = items.filter((it) => code.includes(it.str.trim()) && it.str.trim().length >= 3 && /^[A-Z0-9-]+$/.test(it.str.trim()));
    for (const piece of pieces) {
      found = true;
      const right = piece.x + piece.width;
      const sameLine = items.filter((it) => it !== piece && Math.abs(it.y - piece.y) < 4 && it.x > piece.x + 1);
      const nextLeft = sameLine.length ? Math.min(...sameLine.map((it) => it.x)) : Infinity;
      detail.push(`「${piece.str.trim()}」右边界 ${right.toFixed(1)}，右边最近的文字从 ${Number.isFinite(nextLeft) ? nextLeft.toFixed(1) : "无"} 开始`);
      if (right > nextLeft + 0.5) overlaps += 1;
    }
  }
  return { found, overlaps, detail: detail.join("；") };
}

async function main() {
  const chrome = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (process.platform !== "darwin" && (!chrome || !existsSync(chrome))) {
    console.log("⏭  SKIP：没有可用的 Chromium（设 CHROME_EXECUTABLE_PATH 后重跑）");
    return;
  }
  const { renderHtmlToPdf } = await import("@/lib/pdf/html-to-pdf");
  mkdirSync(OUT, { recursive: true });
  const hasPdftoppm = (() => { try { execFileSync("pdftoppm", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

  const cases: Array<{ name: string; count: number; englishPt: 8 | 7.5; maxPages: number | null }> = [
    { name: "rfq-sheet-14-en8pt", count: 14, englishPt: 8, maxPages: 3 },
    { name: "rfq-sheet-14-en7.5pt", count: 14, englishPt: 7.5, maxPages: 3 },
    { name: "rfq-sheet-60-en8pt", count: 60, englishPt: 8, maxPages: 8 },
    { name: "rfq-sheet-60-en7.5pt", count: 60, englishPt: 7.5, maxPages: 8 },
  ];
  let failed = 0;
  for (const c of cases) {
    const doc = build(c.count);
    const html = renderRfqAttachmentHtml(doc, { draftedOn: "2026-11-19", englishPt: c.englishPt });
    const t0 = Date.now();
    const pdf = await renderHtmlToPdf(html);
    const ms = Date.now() - t0;
    const checked = checkRfqAttachmentPdf(pdf);
    const file = path.join(OUT, `${c.name}.pdf`);
    writeFileSync(file, pdf);
    const pages = countPdfPages(pdf);
    const texts = await pageTexts(pdf);
    const full = texts.flat().map((t) => t.str).join("");
    const identity = IDENTITY.filter((x) => full.includes(x));
    const overlap = longCodeOverlap(texts, "MAND-TECH-0012");
    const okPages = c.maxPages === null || pages <= c.maxPages;
    const ok = checked.ok && okPages && identity.length === 0 && overlap.found && overlap.overlaps === 0 && full.includes("询价单") && full.includes("□");
    if (!ok) failed += 1;
    if (hasPdftoppm) execFileSync("pdftoppm", ["-png", "-r", "70", "-f", "1", "-l", "1", file, path.join(OUT, `${c.name}-p1`)]);
    console.log(
      `${ok ? "✓" : "✗"} ${c.name}：${c.count} 条，英文 ${c.englishPt}pt → ${pages} 页${c.maxPages ? `（上限 ${c.maxPages}）` : ""}，${pdf.length} 字节，${ms} ms；` +
        `PDF 检查 ${checked.ok ? "通过（内嵌 Noto Sans SC）" : `不过：${checked.reason}`}；文字层招标身份 ${identity.length ? identity.join("、") : "无"}；` +
        `没有中文译文 ${doc.missingTranslationCount} 条；长编号 ${overlap.found ? `重叠 ${overlap.overlaps} 处（${overlap.detail}）` : "没找到"}`,
    );
  }
  console.log(`\n产物在 ${OUT}${hasPdftoppm ? "（含首页 PNG）" : "（没有 pdftoppm，未出首页 PNG）"}`);
  if (failed) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
