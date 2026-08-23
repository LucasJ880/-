/**
 * Customer Quotation PDF · HTML 模板（英文，客户可见；Sunny 品牌抬头）。
 * 只接受 CustomerQuoteView（白名单投影）——绝不接受 ProjectQuote / 成本行对象。纯函数，便于单测与泄露探针。
 */

import type { CustomerQuoteView } from "./customer-view";

const esc = (s: string | null | undefined): string => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number | null | undefined, ccy: string) => (n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("en-CA", { style: "currency", currency: ccy, maximumFractionDigits: 2 })}`);
const qty = (n: number | null) => (n == null ? "" : n.toLocaleString("en-CA", { maximumFractionDigits: 2 }));

const STYLE = `<style>
body{font-family:"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:820px;margin:0 auto;padding:28px 26px 44px;line-height:1.5;font-size:12.5px}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2e6b57;padding-bottom:12px;margin-bottom:14px}
.brand img{height:48px;max-width:220px;object-fit:contain}
.brand .co{font-size:16px;font-weight:700;margin-top:4px}
.brand .addr{color:#555;font-size:11px;white-space:pre-line}
.qbox{text-align:right}
.qbox h1{font-size:24px;letter-spacing:2px;margin:0;color:#2e6b57}
.qbox table{font-size:11.5px;margin-left:auto}
.qbox td{padding:1px 4px}
.qbox td.k{color:#666;text-align:right}
.grid{display:flex;gap:18px;margin:10px 0 14px}
.grid .box{flex:1;border:1px solid #d9e0dc;border-radius:6px;padding:8px 10px}
.box h3{margin:0 0 4px;font-size:11px;color:#2e6b57;text-transform:uppercase;letter-spacing:1px}
.box .v{white-space:pre-line}
table.lines{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:12px}
table.lines th,table.lines td{border:1px solid #cfd6d2;padding:5px 7px;vertical-align:top}
table.lines th{background:#eef3f1;text-align:left}
table.lines td.n,table.lines th.n{text-align:right;white-space:nowrap}
tr.section td{background:#f6f8f7;font-weight:700;color:#2e6b57}
.tag{display:inline-block;font-size:10px;border:1px solid #2e6b57;color:#2e6b57;border-radius:4px;padding:0 5px;margin-left:6px}
.totals{width:320px;margin-left:auto;border-collapse:collapse;font-size:12.5px}
.totals td{padding:4px 8px;border-bottom:1px solid #e3e8e5}
.totals td.k{color:#555}
.totals td.n{text-align:right;white-space:nowrap}
.totals tr.grand td{font-weight:700;font-size:14px;border-top:2px solid #2e6b57;border-bottom:none}
h2{font-size:13px;border-left:4px solid #2e6b57;padding-left:8px;margin:16px 0 6px}
.terms{white-space:pre-line}
ul{margin:2px 0 6px 18px;padding:0}
.muted{color:#666;font-size:11px}
/* P2（Phase 2.1）：页脚固定在每页底部、不占文档流高度 → 不会单独溢出成只有页脚的空白页 */
/* Print-safe repeating footer: the document body is wrapped in a single table whose <tfoot> Chromium repeats at the bottom of every printed page
   while reserving its height in flow (a fixed-position footer overlaps body lines once the page content area is full). */
table.page{width:100%;border-collapse:collapse;table-layout:fixed}
table.page>tbody>tr>td,table.page>tfoot>tr>td{padding:0;border:0;vertical-align:top}
.foot{border-top:1px solid #ddd;margin-top:3px;padding-top:3px;font-size:9.5px;line-height:1.25;color:#666;display:flex;justify-content:space-between;background:#fff}
/* The repeating footer reserves ~13pt on every page that the previous (overlapping) layout did not; the bottom page margin is reduced
   from the renderer default 14mm to 7mm so the footer sits inside the old margin zone (≈7mm from the paper edge on full pages) and the
   body capacity per page stays equal to the previous layout (Real-UAT sized quotation remains one page). */
@page{margin-bottom:7mm}
@media print{body{padding:0}}
</style>`;

export type QuotationHtmlOptions = { logoDataUrl: string | null; generatedAt: string; documentTitle?: string };

export function buildCustomerQuotationHtml(view: CustomerQuoteView, opts: QuotationHtmlOptions): string {
  const ccy = view.currency;
  const h = view.header;
  const c = view.company;
  const optional = view.lines.filter((l) => l.optional);
  const base = view.lines.filter((l) => !l.optional);
  const sections = [...new Set(base.map((l) => l.section ?? ""))];
  const rows: string[] = [];
  for (const sec of sections) {
    if (sec) rows.push(`<tr class="section"><td colspan="6">${esc(sec)}</td></tr>`);
    for (const l of base.filter((x) => (x.section ?? "") === sec)) {
      rows.push(`<tr><td>${esc(l.item)}${l.allowance ? '<span class="tag">Allowance</span>' : ""}${l.taxable ? "" : '<span class="tag">Tax exempt</span>'}</td><td>${esc(l.description)}${l.notes ? `<div class="muted">${esc(l.notes)}</div>` : ""}</td><td class="n">${qty(l.quantity)}</td><td>${esc(l.unit)}</td><td class="n">${l.unitPrice == null ? "" : money(l.unitPrice, ccy)}</td><td class="n">${l.amount === 0 && /included/i.test(l.description ?? "") ? "Included" : money(l.amount, ccy)}</td></tr>`);
    }
  }
  const optionalRows = optional.map((l) => `<tr><td>${esc(l.item)}</td><td>${esc(l.description)}</td><td class="n">${qty(l.quantity)}</td><td>${esc(l.unit)}</td><td class="n">${l.unitPrice == null ? "" : money(l.unitPrice, ccy)}</td><td class="n">${money(l.amount, ccy)}</td></tr>`).join("");
  const taxRows = [view.tax.hst ? `<tr><td class="k">HST</td><td class="n">${money(view.tax.hst, ccy)}</td></tr>` : "", view.tax.gst ? `<tr><td class="k">GST</td><td class="n">${money(view.tax.gst, ccy)}</td></tr>` : "", view.tax.pst ? `<tr><td class="k">PST</td><td class="n">${money(view.tax.pst, ccy)}</td></tr>` : ""].join("");
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
  const t = view.terms;
  const termBlocks = [
    t.paymentTerms ? `<p><b>Payment terms:</b> <span class="terms">${esc(t.paymentTerms)}</span></p>` : "",
    t.delivery ? `<p><b>Delivery:</b> <span class="terms">${esc(t.delivery)}</span></p>` : "",
    t.leadTime ? `<p><b>Lead time:</b> <span class="terms">${esc(t.leadTime)}</span></p>` : "",
    t.warranty ? `<p><b>Warranty:</b> <span class="terms">${esc(t.warranty)}</span></p>` : "",
    t.validity ? `<p><b>Validity:</b> <span class="terms">${esc(t.validity)}</span></p>` : view.validUntil ? `<p><b>Validity:</b> This quotation is valid until ${esc(view.validUntil)}.</p>` : "",
    t.exclusions.length ? `<p><b>Exclusions:</b></p>${list(t.exclusions)}` : "",
    t.assumptions.length ? `<p><b>Assumptions:</b></p>${list(t.assumptions)}` : "",
    t.notes ? `<p><b>Notes:</b> <span class="terms">${esc(t.notes)}</span></p>` : "",
  ].join("");
  const title = opts.documentTitle ?? "QUOTATION";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(view.quoteNumber ?? "")}</title>${STYLE}</head><body>
<table class="page"><tfoot><tr><td><div class="foot"><span>${esc(c.name ?? "")} · ${esc(view.quoteNumber ?? "")} · ${esc(h.revision)}</span><span>Generated ${esc(opts.generatedAt.slice(0, 16).replace("T", " "))}</span></div></td></tr></tfoot><tbody><tr><td>
<div class="top">
  <div class="brand">${opts.logoDataUrl ? `<img src="${opts.logoDataUrl}" alt="logo"/>` : ""}<div class="co">${esc(c.name ?? "")}</div><div class="addr">${esc([...c.addressLines, [c.phone, c.email, c.website].filter(Boolean).join(" · "), c.taxNumber ? `Business No. ${c.taxNumber}` : ""].filter(Boolean).join("\n"))}</div></div>
  <div class="qbox"><h1>${esc(title)}</h1><table>
    <tr><td class="k">Quote No.</td><td>${esc(view.quoteNumber ?? "—")}</td></tr>
    <tr><td class="k">Revision</td><td>${esc(h.revision)}</td></tr>
    <tr><td class="k">Date</td><td>${esc(h.quoteDate ?? opts.generatedAt.slice(0, 10))}</td></tr>
    <tr><td class="k">Valid until</td><td>${esc(view.validUntil ?? "—")}</td></tr>
    <tr><td class="k">Currency</td><td>${esc(ccy)}</td></tr>
  </table></div>
</div>
<div class="grid">
  <div class="box"><h3>Customer</h3><div class="v">${esc([h.clientCompany, h.clientName, h.clientAddress, [h.contactName, h.contactEmail, h.contactPhone].filter(Boolean).join(" · ")].filter(Boolean).join("\n") || "—")}</div></div>
  <div class="box"><h3>Project</h3><div class="v">${esc([h.projectName ?? view.title, h.projectNumber ? `Project No. ${h.projectNumber}` : "", h.tenderNumber ? `Tender No. ${h.tenderNumber}` : ""].filter(Boolean).join("\n") || "—")}</div></div>
  <div class="box"><h3>Prepared by</h3><div class="v">${esc(h.preparedBy ?? c.name ?? "—")}</div></div>
</div>
<h2>Scope &amp; Pricing</h2>
<table class="lines"><thead><tr><th>Item</th><th>Description</th><th class="n">Qty</th><th>Unit</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>${rows.join("")}</tbody></table>
${optional.length ? `<h2>Optional Items <span class="muted">(not included in total)</span></h2><table class="lines"><thead><tr><th>Item</th><th>Description</th><th class="n">Qty</th><th>Unit</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>${optionalRows}</tbody></table>` : ""}
<table class="totals">
  <tr><td class="k">Subtotal${view.allowanceTotal ? ` <span class="muted">(incl. allowances ${money(view.allowanceTotal, ccy)})</span>` : ""}</td><td class="n">${money(view.subtotal, ccy)}</td></tr>
  ${view.taxableSubtotal !== view.subtotal ? `<tr><td class="k">Taxable subtotal</td><td class="n">${money(view.taxableSubtotal, ccy)}</td></tr>` : ""}
  ${taxRows}
  <tr class="grand"><td class="k">Total (${esc(ccy)})</td><td class="n">${money(view.total, ccy)}</td></tr>
</table>
${termBlocks ? `<h2>Terms &amp; Conditions</h2>${termBlocks}` : ""}
</td></tr></tbody></table>
</body></html>`;
}
