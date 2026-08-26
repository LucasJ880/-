/**
 * 备忘录 v2 · 渲染（受限 Markdown → HTML + 确定性附录）
 * 支持子集：### 小标题 / **粗体** / - 列表 / | 表格 |。其余原样转义输出（XSS 安全优先）。
 */

import { STYLE, type TenderDocHeader } from "@/lib/projects/generate/tender-doc-html";
import type { ReferencedStandardsIntel } from "@/lib/tender-intel/referenced-standards";
import type { MarketPricingIntel } from "@/lib/tender-intel/market-pricing";
import type { MemoV2State } from "./contract";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string): string => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

/** 受限 Markdown → HTML（逐行状态机；未知语法按段落转义输出） */
export function renderLimitedMd(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; } };
  const flushTable = () => {
    if (table.length === 0) return;
    const [head, ...rows] = table;
    out.push(`<table><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (t.startsWith("|") && t.endsWith("|")) {
      flushList();
      const cells = t.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
      table.push(cells);
      continue;
    }
    flushTable();
    if (t.startsWith("### ")) { flushList(); out.push(`<h3 style="font-size:14px;margin:14px 0 6px">${inline(t.slice(4))}</h3>`); continue; }
    if (t.startsWith("- ")) { list.push(t.slice(2)); continue; }
    flushList();
    if (t.length === 0) continue;
    out.push(`<p>${inline(t)}</p>`);
  }
  flushList();
  flushTable();
  return out.join("\n");
}

export type MemoV2RenderInput = {
  header: TenderDocHeader;
  state: MemoV2State;
  criticalFacts: Array<{ labelZh: string; status: string; text: string | null }>;
  numberAudit: { total: number; unverified: string[] };
};

export function buildAnalystMemoV2Html(d: MemoV2RenderInput): string {
  const h = d.header;
  const sections = [...(d.state.sectionsPart1 ?? []), ...(d.state.sectionsPart2 ?? [])];
  const std = d.state.research?.standards as ReferencedStandardsIntel | null;
  const mk = d.state.research?.market as MarketPricingIntel | null;
  const parts: string[] = [];

  parts.push(`<h1>投标分析师备忘录</h1>
<p class="meta">${esc(h.projectName)}${h.solicitationNumber ? ` · ${esc(h.solicitationNumber)}` : ""}${h.clientOrganization ? ` · ${esc(h.clientOrganization)}` : ""}${h.closeDate ? ` · 截标 ${esc(h.closeDate)}` : ""} · 生成 ${esc(h.generatedAt)} · 深读 ${d.state.chunks.length} 块全文</p>
<p><span class="badge">AI_INFERRED · 全文深读 · 人审后使用</span> <span class="muted">基于全部标书页文本多轮推理；论断带原文出处；外部检索带链接；金额未经换算；最终决策由人做出。</span></p>`);

  for (const s of sections) parts.push(`<h2>${esc(s.titleZh)}</h2>\n${renderLimitedMd(s.bodyMd)}`);

  // ── 附录 A：关键事实（管线确定性抽取，与正文互核） ──
  parts.push(`<h2>附录 A · 关键事实（管线抽取，供互核）</h2>
<table><tr><th style="width:26%">项</th><th>内容</th><th style="width:12%">状态</th></tr>
${d.criticalFacts.map((f) => `<tr><td>${esc(f.labelZh)}</td><td>${esc(f.text ?? "—")}</td><td>${esc(f.status)}</td></tr>`).join("")}</table>`);

  // ── 附录 B：外部检索出处 ──
  const stdSources = std?.status === "ran" ? std.standards.flatMap((s) => s.sources) : [];
  const mkSources = mk?.status === "ran" ? mk.sources : [];
  const allSources = [...new Map([...stdSources, ...mkSources].map((s) => [s.url, s])).values()];
  parts.push(`<h2>附录 B · 外部检索出处</h2>
${allSources.length ? `<ul>${allSources.map((s, i) => `<li>[${i + 1}] <a href="${esc(s.url)}">${esc(s.title)}</a></li>`).join("")}</ul>` : `<p class="muted">（本次无外部检索命中${std?.status === "unavailable" ? "——检索服务未配置" : ""}）</p>`}
${mk?.status === "ran" ? `<p class="muted">${esc(mk.fxNoteZh)}</p>` : ""}`);

  // ── 附录 C：数字回核（确定性审计） ──
  parts.push(`<h2>附录 C · 数字回核</h2>
${d.numberAudit.unverified.length === 0
    ? `<p class="muted">正文中的 ${d.numberAudit.total} 个数字全部能在标书原文或检索来源中找到。</p>`
    : `<div class="warn"><b>以下 ${d.numberAudit.unverified.length}/${d.numberAudit.total} 个数字未能在原文/来源中直接找到，采信前请人工核对：</b><br/>${d.numberAudit.unverified.map((n) => esc(n)).join("、 ")}</div>`}
<div class="hr"></div>
<p class="muted">青砚 · 分析师备忘录 v2（全文多轮推理）：深读笔记逐条带页锚点；标准展开与市场价基准带检索出处；无出处的条款与价格在生成层即被丢弃。</p>`);

  return `${STYLE}<body>${parts.join("\n")}</body>`;
}
