/**
 * INSTALL-2k：质保证书（纯函数）——随质保邮件发出的 PDF 附件的 HTML 源
 *
 * - 与邮件同一份数据（warrantyDocData）：质保编号、单号、客户、地址、安装日、各单元、各品类各部件年限与到期日、
 *   条款链接、报修联系方式；不含金额、内部备注、照片、员工信息（spec「邮件不输出的内容」）
 * - A4 打印版式；字体栈含 "Noto Sans SC"（html-to-pdf 注入），产品名里的中文不变方块
 * - 确定性：同样输入得到同样 HTML；PDF 在发送时由执行器渲染（design D1）
 */

import { warrantyDocData, type WarrantyDocInput } from "./warranty";

/** 附件名：Warranty-W-<单号>.pdf，只保留 [A-Za-z0-9._-] */
export function warrantyAttachmentName(orderCode: string): string {
  const safe = `W-${orderCode}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `Warranty-${safe || "W"}.pdf`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 质保证书 HTML（spec「质保证书 PDF 附件」） */
export function renderWarrantyCertificate(input: WarrantyDocInput): string {
  const { warrantyNo, address, units, product, coverage } = warrantyDocData(input);
  const c = input.settings.contact;
  const cell = "padding:6px 8px;border-bottom:1px solid #e8e3d9;text-align:left;vertical-align:top;";
  const info = (k: string, v: string) => `<tr><td style="padding:3px 16px 3px 0;color:#6b6b6b;white-space:nowrap;">${esc(k)}</td><td style="padding:3px 0;font-weight:600;">${esc(v)}</td></tr>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(`Warranty Certificate ${warrantyNo}`)}</title>
<style>
  body{margin:0;font-family:"Helvetica Neue",Arial,"Noto Sans SC",sans-serif;color:#1c1c1c;font-size:12px;line-height:1.5;}
  h1{margin:0;font-size:24px;letter-spacing:0.02em;color:#2e5e4e;}
  h2{margin:18px 0 6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#2e5e4e;}
  table{border-collapse:collapse;}
  .grid{width:100%;}
  .grid th{padding:6px 8px;background:#f6f4ef;border-bottom:1px solid #d9d2c3;text-align:left;font-size:11px;color:#6b6b6b;}
</style></head>
<body>
<div style="border-bottom:3px solid #2e5e4e;padding-bottom:10px;">
  <div style="font-size:14px;font-weight:700;color:#2e5e4e;">${esc(c.companyName)}</div>
  <h1>Warranty Certificate</h1>
</div>
<table style="margin-top:12px;font-size:12px;">${info("Warranty No.", warrantyNo)}${info("Order No.", input.orderCode)}${info("Customer", input.customerName)}${info("Address", address)}${info("Installed on", `${input.installDate} (warranty starts on this date)`)}</table>
<h2>Covered products</h2>
<table class="grid"><thead><tr><th style="width:28px;">#</th><th>Location</th><th>Product</th></tr></thead><tbody>${units
    .map((u, i) => `<tr><td style="${cell}color:#6b6b6b;">${i + 1}</td><td style="${cell}">${esc(u.location || "—")}</td><td style="${cell}">${esc(product(u) || "—")}</td></tr>`)
    .join("")}</tbody></table>
<h2>Warranty coverage</h2>
<table class="grid"><thead><tr><th>Category</th><th>Coverage</th><th style="width:70px;">Years</th><th style="width:100px;">Until</th></tr></thead><tbody>${coverage
    .flatMap((g) =>
      g.terms.map(
        (t, i) =>
          `<tr><td style="${cell}font-weight:600;">${i === 0 ? esc(g.label) : ""}</td><td style="${cell}">${esc(t.label)}</td><td style="${cell}">${t.years} yr</td><td style="${cell}">${esc(t.until)}</td></tr>`,
      ),
    )
    .join("")}</tbody></table>
<h2>Service</h2>
<p style="margin:0 0 4px;">For service, contact us with your Warranty No. (${esc(warrantyNo)}) and a photo of the issue.</p>
<table style="font-size:12px;">${info("Phone", c.phone)}${info("Email", c.email)}${c.address ? info("Address", c.address) : ""}</table>
${c.warrantyUrl ? `<p style="margin:12px 0 0;">Full warranty terms, coverage and exclusions: ${esc(c.warrantyUrl)}</p>` : ""}
<p style="margin:18px 0 0;font-size:10px;color:#6b6b6b;">This certificate confirms the warranty coverage of the products listed above, starting on the installation date. Coverage is subject to the full warranty terms. Please keep this certificate for your records.</p>
</body></html>`;
}
