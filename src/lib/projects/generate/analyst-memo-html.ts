/**
 * 投标分析师备忘录 · HTML 模板（内部文档；经 Chromium 漏斗出 PDF）
 *
 * 结构对标"GPT 式一份连贯分析备忘录"，数据来源全部可溯：
 * 确定性表格（关键事实/要求/标准/市场基准/价格演算）+ AI 判断层（AI_INFERRED 徽标，人审）。
 */

import { STYLE, type TenderDocHeader } from "./tender-doc-html";
import type { AnalystMemoLlm } from "@/lib/tender-analyst-memo/synthesize";
import type { ReferencedStandardsIntel } from "@/lib/tender-intel/referenced-standards";
import type { MarketPricingIntel } from "@/lib/tender-intel/market-pricing";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type AnalystMemoData = {
  header: TenderDocHeader;
  criticalFacts: Array<{ labelZh: string; status: string; text: string | null }>;
  requirements: Array<{ groupZh: string; items: Array<{ zh: string; mandatory: boolean }> }>;
  requirementsTruncated: boolean;
  standards: ReferencedStandardsIntel | null;
  market: MarketPricingIntel | null;
  vendorBenchmarkZh: string[];
  pricingScenarioZh: string[];
  quoteSnapshotZh: string[];
  strategyPointsZh: string[];
  llm: AnalystMemoLlm | null;
  llmErrorCode: string | null;
};

const dot = (r: "GREEN" | "YELLOW" | "RED") => (r === "GREEN" ? "🟢" : r === "YELLOW" ? "🟡" : "🔴");
const sev = (s: "HIGH" | "MEDIUM" | "LOW") => (s === "HIGH" ? "高" : s === "MEDIUM" ? "中" : "低");
const list = (rows: string[]) => (rows.length ? `<ul>${rows.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="muted">（无数据）</p>`);

export function buildAnalystMemoHtml(d: AnalystMemoData): string {
  const h = d.header;
  const sections: string[] = [];

  sections.push(`<h1>投标分析师备忘录</h1>
<p class="meta">${esc(h.projectName)}${h.solicitationNumber ? ` · ${esc(h.solicitationNumber)}` : ""}${h.clientOrganization ? ` · ${esc(h.clientOrganization)}` : ""}${h.closeDate ? ` · 截标 ${esc(h.closeDate)}` : ""} · 生成 ${esc(h.generatedAt)}</p>
<p><span class="badge">AI_INFERRED · 人审后使用</span> <span class="muted">判断层由 AI 基于接地数据合成；每条判断标注依据；金额未经换算；最终投标决策由人做出。</span></p>`);

  if (d.llm) sections.push(`<h2>一、执行摘要</h2><p>${esc(d.llm.execSummaryZh)}</p>`);
  else sections.push(`<h2>一、执行摘要</h2><div class="warn">AI 判断层生成失败（${esc(d.llmErrorCode ?? "unknown")}）——以下确定性数据仍可用；可重新生成本文档重试。</div>`);

  sections.push(`<h2>二、项目关键事实</h2>
<table><tr><th style="width:26%">项</th><th>内容</th><th style="width:12%">状态</th></tr>
${d.criticalFacts.map((f) => `<tr><td>${esc(f.labelZh)}</td><td>${esc(f.text ?? "—")}</td><td>${esc(f.status)}</td></tr>`).join("")}
</table>`);

  sections.push(`<h2>三、要求清单（技术/商务分组）</h2>
${d.requirements
  .map(
    (g) => `<h3 style="font-size:14px;margin:14px 0 6px">${esc(g.groupZh)}（${g.items.length} 条）</h3>
<table><tr><th style="width:10%">强制</th><th>要求（中文）</th></tr>
${g.items.map((i) => `<tr><td>${i.mandatory ? "★" : ""}</td><td>${esc(i.zh)}</td></tr>`).join("")}
</table>`,
  )
  .join("")}
${d.requirementsTruncated ? `<p class="muted">（要求条目较多，此处截断展示——完整清单见合规矩阵页面）</p>` : ""}`);

  const std = d.standards;
  sections.push(`<h2>四、引用标准/条款展开（M3）</h2>
${!std ? `<p class="muted">未运行（情报编排未产出）。</p>` : std.status === "unavailable" ? `<div class="warn">${esc(std.note ?? "检索不可用")}</div>` : std.status === "no_refs" ? `<p class="muted">招标文本中未识别到未展开的外部标准引用。</p>` : std.standards
  .map(
    (s) => `<h3 style="font-size:14px;margin:14px 0 6px">${esc(s.ref.docName)} ${esc(s.ref.sectionRange ?? s.ref.refCode)}</h3>
<p class="muted">招标原文：“${esc(s.ref.sourceQuote)}”</p>
${s.status === "not_found" ? `<div class="warn">${esc(s.gapsZh[0] ?? "检索无结果——请人工查阅原文")}</div>` : `<table><tr><th style="width:16%">条款</th><th>要求摘要</th><th>对本项目的含义</th></tr>
${s.clauses.map((c) => `<tr><td>${esc(c.clauseId)}</td><td>${esc(c.clauseSummaryZh)}</td><td>${esc(c.implicationZh)}</td></tr>`).join("")}
</table>
<p class="muted">置信：${esc(s.confidence ?? "—")}${s.gapsZh.length ? ` · 缺口：${esc(s.gapsZh.join("；"))}` : ""} · 出处：${s.sources
  .slice(0, 4)
  .map((src, i) => `<a href="${esc(src.url)}">[${i + 1}]</a>`)
  .join(" ")}</p>`}`,
  )
  .join("")}`);

  sections.push(`<h2>五、风险与对策</h2>
${d.llm && d.llm.risks.length ? `<table><tr><th style="width:8%">级别</th><th>风险</th><th>对策建议</th><th style="width:14%">依据</th></tr>
${d.llm.risks.map((r) => `<tr><td>${sev(r.severity)}</td><td>${esc(r.riskZh)}</td><td>${esc(r.mitigationZh)}</td><td class="muted">${esc(r.basedOn)}</td></tr>`).join("")}
</table>` : `<p class="muted">（AI 判断层缺失或无风险条目）</p>`}`);

  const mk = d.market;
  sections.push(`<h2>六、市场价格基准（M4）</h2>
${!mk ? `<p class="muted">未运行（情报编排未产出）。</p>` : mk.status !== "ran" ? `<div class="warn">${esc(mk.note ?? "不可用")}</div>` : `${mk.benchmarks.length ? `<table><tr><th>基准产品</th><th style="width:16%">价格（原币）</th><th>可比性</th><th style="width:10%">出处</th></tr>
${mk.benchmarks.map((b) => `<tr><td>${esc(b.productName)}${b.vendor ? `（${esc(b.vendor)}）` : ""}</td><td>${esc(b.priceRaw)}${b.unit ? ` / ${esc(b.unit)}` : ""}</td><td>${esc(b.comparabilityZh)}</td><td><a href="${esc(mk.sources[b.sourceIndex]?.url ?? "#")}">[${b.sourceIndex + 1}]</a></td></tr>`).join("")}
</table>` : ""}
${mk.observationsZh.length ? list(mk.observationsZh) : ""}
${mk.insufficientZh ? `<div class="warn">${esc(mk.insufficientZh)}</div>` : ""}
<p class="muted">${esc(mk.fxNoteZh)}</p>`}
${d.vendorBenchmarkZh.length ? `<h3 style="font-size:14px;margin:14px 0 6px">联邦合同对标（权威公开数据）</h3>${list(d.vendorBenchmarkZh)}` : ""}
${d.pricingScenarioZh.length ? `<h3 style="font-size:14px;margin:14px 0 6px">价格演算（确定性模型）</h3>${list(d.pricingScenarioZh)}` : ""}
${d.quoteSnapshotZh.length ? `<h3 style="font-size:14px;margin:14px 0 6px">我方报价引擎快照（Sunny 定价链）</h3>${list(d.quoteSnapshotZh)}` : ""}`);

  sections.push(`<h2>七、GO / NO-GO 分维评级</h2>
${d.llm ? `<table><tr><th style="width:6%"></th><th style="width:20%">维度</th><th>理由</th><th style="width:14%">依据</th></tr>
${d.llm.goNoGo.map((g) => `<tr><td>${dot(g.rating)}</td><td>${esc(g.dimensionZh)}</td><td>${esc(g.reasonZh)}</td><td class="muted">${esc(g.basedOn)}</td></tr>`).join("")}
</table>
<p class="muted">分维评级仅供决策参考；不构成整体投/不投结论。</p>` : `<p class="muted">（AI 判断层缺失）</p>`}`);

  sections.push(`<h2>八、建议向采购方澄清（RFI，中英）</h2>
${d.llm && d.llm.rfiSuggestions.length ? `<table><tr><th>问题（中）</th><th>Question (EN)</th><th style="width:22%">为什么要问</th></tr>
${d.llm.rfiSuggestions.map((q) => `<tr><td>${esc(q.questionZh)}</td><td>${esc(q.questionEn)}</td><td class="muted">${esc(q.whyZh)}</td></tr>`).join("")}
</table>` : `<p class="muted">（无建议——或 AI 判断层缺失）</p>`}`);

  if (d.strategyPointsZh.length) sections.push(`<h2>九、策略备忘录要点（引用）</h2>${list(d.strategyPointsZh)}`);
  sections.push(`<h2>${d.strategyPointsZh.length ? "十" : "九"}、下一步行动</h2>${d.llm ? list(d.llm.nextStepsZh) : `<p class="muted">（AI 判断层缺失）</p>`}`);
  sections.push(`<h2>${d.strategyPointsZh.length ? "十一" : "十"}、数据缺口（诚实清单）</h2>${d.llm ? list(d.llm.dataGapsZh) : `<p class="muted">（AI 判断层缺失）</p>`}
<div class="hr"></div>
<p class="muted">本备忘录由青砚生成：表格与基准来自已接地的分析/情报模块（带出处），判断层为 AI_INFERRED（依据已逐条标注）。金额一律原币未换算；投标决策与报价由人最终确认。</p>`);

  return `${STYLE}<body>${sections.join("\n")}</body>`;
}
