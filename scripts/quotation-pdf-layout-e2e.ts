/**
 * Quote Operations Phase 2.1 — 客户报价 PDF 分页布局回归（真实 Chromium；无 DB；无 LLM）
 *
 *  S. 单页：小报价（Real-UAT 量级）→ 恰好 1 页，正文不压页脚，末页不是「只有页脚」的尾页（P2 回归）
 *  M. 多页：≥48 行 + 长条款 → ≥2 页；每页都有页脚；任何一页正文文本都不落入页脚带；末页仍有正文（无尾空白页）
 *
 * 判定用 PDF 文本坐标（pdfjs getTextContent 的 transform），不是肉眼：页脚条目 top = max(y + height)，
 * 正文条目 baseline = y；正文 baseline < 页脚 top 即判定重叠（PDF 坐标系原点在左下）。
 *
 * 用法：npx tsx scripts/quotation-pdf-layout-e2e.ts [--out <dir>]
 *   找不到 Chromium（CHROME_EXECUTABLE_PATH / 本机 Chrome）时打印 SKIP 并 exit 0，不误报失败。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { buildCustomerView, type CustomerQuoteView } from "@/lib/quote-engine/customer-view";
import { buildCustomerQuotationHtml } from "@/lib/quote-engine/quotation-html";
import { HtmlToPdfError, renderHtmlToPdf } from "@/lib/pdf/html-to-pdf";

let failures = 0;
function ok(cond: unknown, label: string) {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures += 1;
}

const QUOTE_NUMBER = "Q-2026-0042-LAYOUT";
const FOOTER_PATTERN = new RegExp(`Generated |${QUOTE_NUMBER} · V`);

function view(lineCount: number, longTerms: boolean): CustomerQuoteView {
  const lineItems = Array.from({ length: lineCount }, (_, i) => {
    const quantity = 10 + i;
    const unitPrice = 235.02 + i;
    return {
      itemName: `Window unit type ${String.fromCharCode(65 + (i % 26))}-${i + 1}`,
      specification: "Aluminum frame, double-glazed low-E, supply and installation per specification section 08 51 13",
      unit: "ea",
      quantity,
      unitPrice,
      totalPrice: Math.round(quantity * unitPrice * 100) / 100,
      isInternal: false,
      category: "product",
      section: i < lineCount / 2 ? "Section A — Base Work" : "Section B — Optional",
      optional: i >= lineCount / 2,
      allowance: false,
      taxable: true,
      remarks: i % 7 === 0 ? "Includes removal of existing unit and disposal" : null,
      sortOrder: i,
    };
  });
  const terms = longTerms
    ? {
        paymentTerms: "30% deposit on award; 60% on delivery to site; 10% upon substantial completion. Net 30 days.",
        delivery: "Delivered to site, Halifax NS.",
        leadTime: "12–14 weeks from approved shop drawings.",
        warranty: "2-year workmanship warranty; manufacturer warranty on windows per specification.",
        validity: "30 days.",
        exclusions: Array.from({ length: 12 }, (_, i) => `Exclusion item ${i + 1}: work outside the window openings and associated finishes`),
        assumptions: Array.from({ length: 8 }, (_, i) => `Assumption ${i + 1}: site access and staging per tender documents`),
        notes: "All pricing in Canadian dollars.",
      }
    : { paymentTerms: "Net 30 days.", delivery: "Delivered to site.", validity: "30 days.", exclusions: ["Permits"], assumptions: [] };
  return buildCustomerView({
    quote: {
      quoteNumber: QUOTE_NUMBER,
      title: null,
      name: "PDF layout regression",
      currency: "CAD",
      version: 3,
      status: "approved",
      validUntil: new Date("2026-09-30T00:00:00.000Z"),
      quoteType: "PROJECT_SUPPLY_INSTALL",
      customerJson: {
        clientCompany: "Halifax Regional Municipality",
        clientName: "Procurement Services",
        clientAddress: "1841 Argyle Street, Halifax, NS B3J 3A5",
        contactName: "Procurement Contact",
        projectName: "Strathcona Place — Window Replacement",
        tenderNumber: "T-2026-118",
        preparedBy: "Lucas",
        quoteDate: "2026-08-23",
      },
      termsJson: terms,
      lineItems,
    },
    calc: null,
    tax: { hstPct: 13 },
    company: { name: "Sunny Shutter Inc", addressLines: ["680 Progress Avenue, Unit 2", "Scarborough, ON M1H 3A5"], phone: "647-857-8669", email: "info@sunnyshutter.ca", website: "sunnyshutter.ca", taxNumber: null },
  });
}

type PageLayout = { page: number; bodyItems: number; footerItems: number; bodyMinY: number | null; footerTop: number | null; overlap: boolean };

async function analyze(pdf: Uint8Array): Promise<{ pages: number; layout: PageLayout[]; overlap: boolean; footerOnEveryPage: boolean; trailingFooterOnly: boolean }> {
  const doc = await getDocumentProxy(pdf);
  const layout: PageLayout[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str: string; transform: number[]; height: number }>).filter((it) => it.str.trim().length > 0);
    const footer = items.filter((it) => FOOTER_PATTERN.test(it.str));
    const body = items.filter((it) => !footer.includes(it));
    const footerTop = footer.length ? Math.max(...footer.map((it) => it.transform[5]! + it.height)) : null;
    const bodyMinY = body.length ? Math.min(...body.map((it) => it.transform[5]!)) : null;
    // 正文 baseline 低于（或贴着）页脚顶边 1pt 以内即视为压住页脚
    const overlap = footerTop != null && bodyMinY != null && bodyMinY < footerTop + 1;
    layout.push({ page: p, bodyItems: body.length, footerItems: footer.length, bodyMinY, footerTop, overlap });
  }
  return {
    pages: doc.numPages,
    layout,
    overlap: layout.some((l) => l.overlap),
    footerOnEveryPage: layout.every((l) => l.footerItems > 0),
    trailingFooterOnly: layout.length > 0 && layout[layout.length - 1]!.bodyItems === 0,
  };
}

function describe(layout: PageLayout[]) {
  return layout.map((l) => `p${l.page}: body=${l.bodyItems} footer=${l.footerItems} bodyMinY=${l.bodyMinY?.toFixed(1) ?? "-"} footerTop=${l.footerTop?.toFixed(1) ?? "-"} ${l.overlap ? "OVERLAP" : "ok"}`).join(" | ");
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx >= 0 ? process.argv[outIdx + 1] ?? null : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  const render = async (name: string, v: CustomerQuoteView) => {
    const html = buildCustomerQuotationHtml(v, { logoDataUrl: null, generatedAt: "2026-08-23T12:00:00.000Z" });
    const pdf = await renderHtmlToPdf(html);
    if (outDir) writeFileSync(path.join(outDir, `${name}.pdf`), pdf);
    return analyze(new Uint8Array(pdf));
  };

  let single: Awaited<ReturnType<typeof analyze>>;
  try {
    single = await render("single-page", view(4, false));
  } catch (e) {
    if (e instanceof HtmlToPdfError && /找不到可用的 Chromium|CHROME_EXECUTABLE_PATH/.test(e.message)) {
      console.log(`⏭  SKIP: ${e.message}`);
      return;
    }
    throw e;
  }
  console.log(`[S] pages=${single.pages} ${describe(single.layout)}`);
  ok(single.pages === 1, `S-1 单页报价恰好 1 页（pages=${single.pages}）`);
  ok(!single.overlap, "S-2 单页：正文不压页脚");
  ok(!single.trailingFooterOnly, "S-3 单页：末页不是只有页脚的尾页（P2 回归）");
  ok(single.footerOnEveryPage, "S-4 单页：页脚存在");

  const multi = await render("multi-page", view(48, true));
  console.log(`[M] pages=${multi.pages} ${describe(multi.layout)}`);
  ok(multi.pages >= 2, `M-1 多页报价 ≥ 2 页（PDF_MULTIPAGE_PAGE_COUNT=${multi.pages}）`);
  ok(multi.footerOnEveryPage, "M-2 多页：每一页都有页脚");
  ok(!multi.overlap, "M-3 多页：任何一页正文都不落入页脚带（BODY_TEXT_OVERLAPS_FOOTER=NO）");
  ok(!multi.trailingFooterOnly, "M-4 多页：末页仍有正文（FOOTER_ONLY_TRAILING_PAGE=NO）");
  ok(multi.layout.slice(0, -1).every((l) => l.bodyItems > 100), "M-5 多页：非末页均为满页正文（页脚按页预留高度，不挤出空白页）");

  console.log(`\nPDF_SINGLE_PAGE = ${single.pages === 1 && !single.overlap ? "PASS" : "FAIL"} (pages=${single.pages})`);
  console.log(`PDF_MULTIPAGE_PAGE_COUNT = ${multi.pages}`);
  console.log(`PDF_FOOTER_OVERLAP = ${single.overlap || multi.overlap ? "YES" : "NO"}`);
  console.log(`PDF_TRAILING_BLANK_PAGE = ${single.trailingFooterOnly || multi.trailingFooterOnly ? "YES" : "NO"}`);
  console.log(failures === 0 ? "\n✅ quotation-pdf-layout-e2e: all assertions passed" : `\n❌ quotation-pdf-layout-e2e: ${failures} assertion(s) failed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
