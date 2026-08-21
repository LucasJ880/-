/**
 * 投标文件起草 · HTML 渲染（走 persistGeneratedHtml → Chromium PDF）。
 * 英文提交稿在前；合规响应表；中文内部审阅注在后（提交前删除）。
 */

import { COMPLIANCE_LABEL_EN, type BidDraftInputs, type BidDraftResult } from "./contract";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (s: string) =>
  s
    .split(/\n{2,}|\n(?=\S)/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
/** 占位高亮：提交前必须清零 */
const mark = (html: string) => html.replace(/\[TO CONFIRM[^\]]*\]|\[INTERNAL[^\]]*\]/g, (m) => `<mark>${m}</mark>`);

export function renderBidDraftHtml(input: BidDraftInputs, result: BidDraftResult): string {
  const s = result.sections;
  const rows = result.compliance
    .map(
      (c) => `<tr class="${c.status === "TO_CONFIRM" || c.status === "INTERNAL_NO_GO" ? "warn" : ""}">
<td class="code">${esc(c.code)}${c.mandatory ? '<div class="tag">MANDATORY</div>' : ""}</td>
<td>${esc(c.textOriginal || c.textZh)}</td>
<td class="st">${esc(COMPLIANCE_LABEL_EN[c.status])}</td>
<td>${mark(esc(c.responseEn))}</td>
</tr>`,
    )
    .join("\n");
  const meta = [
    input.project.tenderNumber ? `Solicitation: ${esc(input.project.tenderNumber)}` : null,
    input.project.buyer ? `Buyer: ${esc(input.project.buyer)}` : null,
    input.project.closing ? `Closing: ${esc(input.project.closing)}` : null,
  ]
    .filter(Boolean)
    .join(" ｜ ");
  return `<!doctype html><meta charset="utf-8"><title>Bid Response Draft</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",Helvetica,Arial,sans-serif;color:#1c1c1c;max-width:960px;margin:0 auto;padding:28px 24px;font-size:12px;line-height:1.65}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px}h3{font-size:12px;margin:12px 0 4px}
.meta{color:#555;margin-bottom:10px}.banner{background:#fff1f0;border:1px solid #f5b5b0;color:#7a1f1a;padding:8px 10px;margin:10px 0;font-weight:600}
.note{background:#fff8e6;border:1px solid #f0d58c;padding:8px 10px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d6d6d6;padding:5px 7px;vertical-align:top;text-align:left}th{background:#f3f4f6}
.code{width:70px;white-space:nowrap}.st{width:120px}.tag{font-size:9px;color:#b45309}.warn td{background:#fffbeb}
mark{background:#fde68a}
.zh{border-top:2px dashed #999;margin-top:28px;padding-top:12px}.zh li{margin:2px 0}
@media print{body{padding:0}}
</style>
<h1>Bid Response — Draft for Review</h1>
<div class="meta">${esc(input.project.tenderTitle ?? input.project.nameZh)}${meta ? " ｜ " + meta : ""} ｜ Generated ${esc(result.generatedAt.slice(0, 16).replace("T", " "))} ｜ ${result.placeholders} placeholder(s)</div>
<div class="banner">AI DRAFT — every section requires human review before submission. Placeholders [TO CONFIRM …] must be resolved; remove the Chinese internal section before submitting.</div>

<h2>1. Cover Letter</h2>${mark(para(s.coverLetterEn))}
<h2>2. Executive Summary / Understanding of Requirements</h2>${mark(para(s.executiveSummaryEn))}
<h2>3. Compliance Response Matrix</h2>
<table><thead><tr><th>Ref</th><th>Requirement</th><th>Status</th><th>Response</th></tr></thead><tbody>
${rows || '<tr><td colspan="4">No requirements extracted.</td></tr>'}
</tbody></table>
<h2>4. Technical / Service Delivery Approach</h2>${mark(para(s.technicalApproachEn))}
<h2>5. Company Profile &amp; Relevant Experience</h2>${mark(para(s.companyProfileEn))}
<h2>6. Social Value / Questionnaire Guidance</h2>${mark(para(s.socialValueGuidanceEn))}
<h2>7. Pricing Summary (structure only)</h2>${mark(para(s.pricingSummaryEn))}

<div class="zh">
<h2>内部审阅注（提交前删除）</h2>
<div class="note">占位 ${result.placeholders} 处 ｜ 竞对/现任名称替换 ${result.excludedNameHits} 处 ｜ 禁用语替换 ${result.forbiddenHits} 处 ｜ 未标合规矩阵的要求 ${result.compliance.filter((c) => c.status === "TO_CONFIRM").length} 条</div>
<ul>${s.internalNotesZh.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
<h3>中文对照：合规矩阵标注</h3>
<ul>${result.compliance.map((c) => `<li><b>${esc(c.code)}</b> ${esc(c.textZh)} — ${esc(c.fit ?? "未标")}${c.noteZh ? `：${esc(c.noteZh)}` : ""}</li>`).join("")}</ul>
</div>`;
}
