/**
 * FB-4/5 — Tender 生成文档（HTML，中文安全，基准=McMaster 管理层决策备忘录）
 *
 * 两类文档语义分离：
 *   internal_analysis → 内部「管理层决策备忘录」：合并 Analyst 分析（结论/前置条件/
 *     范围/关键要求/风险/报价关注/澄清/下一步）。企业能力适配表为待人工补充框架，
 *     绝不由 AI 编造公司能力/利润判断。
 *   supplier_rfq → 供应商响应表：仅面向供应商的要求清单 + 「是否满足」+ 报价栏，
 *     不含内部判断/价值测算/风险结论。
 *
 * 输出为自包含 HTML（系统中文字体栈），浏览器/Word 均可打开并打印为 PDF——
 * 根治 jsPDF 无 CJK 字体导致的乱码。纯函数，便于单测。
 */

import type { TenderAnalystSynthesisV1 } from "@/lib/tender-analyst/contract";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const stripRefs = (s: string): string =>
  s
    .replace(/【[A-Z]{1,6}-[\w-]+(?:\s*[,，、]\s*[A-Z]{1,6}-[\w-]+)*】/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const t = (s: string) => esc(stripRefs(s));

const STYLE = `<style>
body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:820px;margin:0 auto;padding:32px 28px;line-height:1.65;font-size:14px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;border-left:4px solid #2e6b57;padding-left:10px;margin:28px 0 10px}
.meta{color:#555;font-size:12px;margin-bottom:2px}
.badge{display:inline-block;background:#2e6b57;color:#fff;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:600}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}
th,td{border:1px solid #cfd6d2;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#eef3f1}
.muted{color:#666;font-size:12px}
.warn{background:#fdf6e8;border:1px solid #e7d4a5;border-radius:8px;padding:10px 12px;margin:8px 0}
.hr{border-top:1px solid #ddd;margin:20px 0}
.fill{color:#9a6a2f}
@media print{body{padding:0}}
</style>`;

const SEV_ZH: Record<string, string> = {
  CRITICAL: "关键",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
const IMPACT_ZH: Record<string, string> = {
  BID_FATAL: "废标风险",
  BID_REQUIRED: "投标必须",
  SCORING: "影响评分",
  COST_IMPACT: "影响成本",
  DELIVERY_IMPACT: "影响交付",
  CONTRACT_ONLY: "合同义务",
  INFORMATIONAL: "信息参考",
};
const ASSESS_ZH: Record<string, string> = {
  READY_TO_PRICE: "可进入报价（GO to pricing）",
  NEEDS_CLARIFICATION: "有条件推进 — 澄清后再报价（CONDITIONAL）",
  BLOCKED_BY_MISSING_SOURCE: "暂缓 — 缺少源文件",
  BLOCKED_BY_CONFLICT: "暂缓 — 存在未解决冲突",
  INSUFFICIENT_INFORMATION: "暂缓 — 信息不足",
};

export type TenderDocHeader = {
  projectName: string;
  clientOrganization: string | null;
  solicitationNumber: string | null;
  closeDate: string | null;
  orgName: string | null;
  generatedAt: string;
};

function headerBlock(h: TenderDocHeader, docTitle: string, confidential: string): string {
  return `<p class="meta">${esc(h.orgName ?? "")} ${confidential}</p>
<h1>${esc(h.projectName)}</h1>
<p class="meta"><b>${docTitle}</b></p>
<p class="meta">${h.solicitationNumber ? `项目编号 ${esc(h.solicitationNumber)} ｜ ` : ""}${
    h.clientOrganization ? `采购方 ${esc(h.clientOrganization)} ｜ ` : ""
  }${h.closeDate ? `投标截止 ${esc(h.closeDate)} ｜ ` : ""}生成于 ${esc(h.generatedAt)}</p>
<div class="hr"></div>`;
}

function keyItemRows(items: TenderAnalystSynthesisV1["keyRequirements"]): string {
  return items
    .map(
      (k) => `<tr><td><b>${t(k.titleZh)}</b><br/><span class="muted">${t(
        k.explanationZh,
      )}</span></td><td>${IMPACT_ZH[k.impact] ?? k.impact}</td><td>${
        SEV_ZH[k.severity] ?? k.severity
      }</td><td>${t(k.whyItMattersZh)}</td></tr>`,
    )
    .join("");
}

/** 内部管理层决策备忘录（MANAGEMENT DECISION MEMO） */
export function buildInternalDecisionMemoHtml(
  h: TenderDocHeader,
  syn: TenderAnalystSynthesisV1,
): string {
  const a = syn.currentAssessment;
  const fatal = [
    ...syn.keyRequirements,
    ...syn.technicalRequirements,
    ...syn.commercialAndDelivery,
  ].filter((k) => k.impact === "BID_FATAL");
  const li = (arr: string[]) => arr.map((x) => `<li>${t(x)}</li>`).join("");
  return `${STYLE}
${headerBlock(h, "内部讨论与投标决策文件（MANAGEMENT DECISION MEMO）", "CONFIDENTIAL — INTERNAL USE ONLY")}
<p><span class="badge">建议结论：${ASSESS_ZH[a.status] ?? a.status}</span></p>
<p>${t(a.summaryZh)}</p>

<h2>01 管理层摘要</h2>
<p><b>${t(syn.executiveBrief.oneLinerZh)}</b></p>
<p>${t(syn.executiveBrief.whatIsBeingBoughtZh)}</p>
<p>${t(syn.executiveBrief.bidderTakeawayZh)}</p>
${syn.executiveBrief.keyPoints.length ? `<p><b>最值得关注</b></p><ul>${li(syn.executiveBrief.keyPoints)}</ul>` : ""}
${
  a.mustResolveBeforePricing.length
    ? `<p><b>报价前必须解决的前置条件</b></p><table><tr><th>#</th><th>前置事项</th></tr>${a.mustResolveBeforePricing
        .map((m, i) => `<tr><td>${i + 1}</td><td>${t(m)}</td></tr>`)
        .join("")}</table>`
    : ""
}

<h2>02 项目本质与采购范围</h2>
<p>${t(syn.scope.overviewZh)}</p>
${syn.scope.deliverables.length ? `<p><b>核心采购内容</b></p><ul>${li(syn.scope.deliverables)}</ul>` : ""}
${syn.scope.quantities.length ? `<p><b>数量 / 规格</b></p><ul>${li(syn.scope.quantities)}</ul>` : ""}
${syn.scope.deliveryScope.length ? `<p><b>交付范围</b></p><ul>${li(syn.scope.deliveryScope)}</ul>` : ""}
${syn.scope.exclusionsOrUnknowns.length ? `<p><b>目前未知 / 待确认</b></p><ul>${li(syn.scope.exclusionsOrUnknowns)}</ul>` : ""}

<h2>03 废标风险与强制要求</h2>
${
  fatal.length
    ? `<table><tr><th>要求</th><th>影响</th><th>严重度</th><th>为什么重要</th></tr>${keyItemRows(fatal)}</table>`
    : `<p class="muted">当前文件中未发现明确的废标 / non-responsive 条件。</p>`
}
${
  syn.keyRequirements.filter((k) => k.impact !== "BID_FATAL").length
    ? `<p><b>其他投标关键要求</b></p><table><tr><th>要求</th><th>影响</th><th>严重度</th><th>为什么重要</th></tr>${keyItemRows(
        syn.keyRequirements.filter((k) => k.impact !== "BID_FATAL"),
      )}</table>`
    : ""
}

<h2>04 技术 / 产品符合性</h2>
${
  syn.technicalRequirements.length
    ? `<table><tr><th>要求</th><th>影响</th><th>严重度</th><th>为什么重要</th></tr>${keyItemRows(syn.technicalRequirements)}</table>`
    : `<p class="muted">未识别出独立技术符合性条款。</p>`
}

<h2>05 商务 / 交付 / 合同义务</h2>
${
  syn.commercialAndDelivery.length
    ? `<table><tr><th>条款</th><th>影响</th><th>严重度</th><th>说明</th></tr>${keyItemRows(syn.commercialAndDelivery)}</table>`
    : `<p class="muted">（暂无）</p>`
}

<h2>06 风险与缺口</h2>
${
  syn.risksAndGaps.length
    ? `<table><tr><th>风险</th><th>等级</th><th>影响</th><th>建议动作</th></tr>${syn.risksAndGaps
        .map(
          (r) =>
            `<tr><td><b>${t(r.titleZh)}</b><br/><span class="muted">${t(r.explanationZh)}</span></td><td>${
              SEV_ZH[r.severity] ?? r.severity
            }</td><td>${t(r.impactZh)}</td><td>${t(r.recommendedActionZh)}</td></tr>`,
        )
        .join("")}</table>`
    : `<p class="muted">当前未识别出需要立即处理的风险。</p>`
}

<h2>07 建议提交的澄清问题</h2>
${
  syn.clarifications.length
    ? `<table><tr><th>#</th><th>问题</th><th>为什么要问</th><th>不问的影响</th><th>优先级</th></tr>${syn.clarifications
        .map(
          (c, i) =>
            `<tr><td>${i + 1}</td><td>${t(c.questionZh)}</td><td>${t(c.reasonZh)}</td><td>${t(
              c.ifNotResolvedZh,
            )}</td><td>${c.priority}</td></tr>`,
        )
        .join("")}</table>`
    : `<p class="muted">（暂无）</p>`
}

<h2>08 能力适配与投标结构（待管理层补充）</h2>
<div class="warn">以下为决策框架，<b>需人工结合企业真实能力填写</b>——AI 仅基于招标文件分析，不评估公司能力、成本或利润。</div>
<table><tr><th>能力项</th><th>当前状态（具备 / 部分 / 缺失）</th><th>补齐方式（自建 / 合作 / 放弃）</th></tr>
${["资质与年限要求", "案例与推荐人", "技术 / 生产能力", "检测与认证", "交付与物流", "现金流与商务条款"]
  .map((x) => `<tr><td>${x}</td><td class="fill">（待填写）</td><td class="fill">（待填写）</td></tr>`)
  .join("")}</table>

<h2>09 下一步</h2>
<ol>${[...syn.nextActions]
    .sort((x, y) => x.order - y.order)
    .map((n) => `<li><b>${t(n.actionZh)}</b> — <span class="muted">${t(n.reasonZh)}</span></li>`)
    .join("")}</ol>
<p class="muted">覆盖率：上传 ${syn.coverage.uploaded} · 纳入分析 ${syn.coverage.analyzed}${
    syn.coverage.excluded.length ? ` · 排除 ${syn.coverage.excluded.length}（${syn.coverage.excluded.map((e) => esc(e.filename)).join("、")}）` : ""
  }。本备忘录由青砚 Tender Analyst 生成，关键结论可在系统内「查看证据」回溯原文页码。</p>`;
}

/** 供应商响应表（RFQ）：要求 + 是否满足 + 报价栏；不含内部判断 */
export function buildSupplierRfqHtml(
  h: TenderDocHeader,
  syn: TenderAnalystSynthesisV1,
): string {
  const rows = [...syn.technicalRequirements, ...syn.commercialAndDelivery]
    .filter((k) => k.impact !== "CONTRACT_ONLY" && k.impact !== "INFORMATIONAL")
    .map(
      (k, i) =>
        `<tr><td>${i + 1}</td><td><b>${t(k.titleZh)}</b><br/><span class="muted">${t(
          k.explanationZh,
        )}</span></td><td class="fill">□ 满足 ｜ □ 部分满足 ｜ □ 不满足</td><td class="fill">（说明）</td><td class="fill">（单价 / 报价）</td></tr>`,
    )
    .join("");
  return `${STYLE}
${headerBlock(h, "供应商询价与符合性确认表（Supplier RFQ）", "")}
<p>请贵司针对下列要求逐项确认<b>是否满足</b>，并提供<b>报价</b>与必要说明。对「部分满足 / 不满足」项，请说明差异与替代方案。</p>
<table><tr><th>#</th><th>要求</th><th>符合性确认</th><th>说明</th><th>报价</th></tr>${rows}</table>
<h2>报价与交付信息</h2>
<table>
<tr><th>报价币种 / 有效期</th><td class="fill">（请填写）</td></tr>
<tr><th>交货周期</th><td class="fill">（请填写）</td></tr>
<tr><th>最小起订量 / 分批</th><td class="fill">（请填写）</td></tr>
<tr><th>检测报告 / 认证清单</th><td class="fill">（请列明可提供的报告与标准号）</td></tr>
<tr><th>样品提供</th><td class="fill">（可否 / 周期 / 费用）</td></tr>
</table>
<p class="muted">本表仅用于询价与符合性确认，不构成采购承诺。</p>`;
}
