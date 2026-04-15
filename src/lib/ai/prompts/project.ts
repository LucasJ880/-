/**
 * 青砚 AI 提示词 — 项目管理类（投标准备清单等）
 */

import type { ProgressSummaryContext } from "./types";

// ── 投标准备清单提示词 ─────────────────────────────────────────

export function getBidChecklistPrompt(ctx: ProgressSummaryContext): string {
  const lines: string[] = [];

  lines.push("你是青砚 AI 投标准备顾问。根据以下项目数据，生成一份结构化的投标准备清单。");
  lines.push("这份清单帮助用户一目了然地看到：哪些准备工作已经完成、哪些还没做、哪些有风险。");
  lines.push("");

  lines.push("## 项目基本信息");
  lines.push(`- 名称: ${ctx.project.name}`);
  if (ctx.project.clientOrganization) lines.push(`- 客户: ${ctx.project.clientOrganization}`);
  if (ctx.project.tenderStatus) lines.push(`- 当前阶段: ${ctx.project.tenderStatus}`);
  lines.push(`- 优先级: ${ctx.project.priority}`);
  if (ctx.project.closeDate) lines.push(`- 截标/截止: ${ctx.project.closeDate}`);
  if (ctx.project.location) lines.push(`- 地点: ${ctx.project.location}`);
  if (ctx.project.estimatedValue) {
    lines.push(`- 预估金额: ${ctx.project.estimatedValue} ${ctx.project.currency || "CAD"}`);
  }
  if (ctx.project.description) lines.push(`- 描述: ${ctx.project.description.slice(0, 300)}`);

  lines.push("");
  lines.push("## 任务统计");
  lines.push(`- 总数: ${ctx.taskStats.total}, 已完成: ${ctx.taskStats.done}, 逾期: ${ctx.taskStats.overdue}`);

  if (ctx.inquiries.length > 0) {
    lines.push("");
    lines.push("## 询价轮次");
    for (const iq of ctx.inquiries) {
      const selected = iq.selectedSupplier ? `，已选: ${iq.selectedSupplier}` : "";
      lines.push(`- 第${iq.roundNumber}轮: ${iq.status}，${iq.itemCount}家供应商，${iq.quotedCount}家已报价${selected}`);
    }
  }

  if (ctx.members.length > 0) {
    lines.push("");
    lines.push("## 项目成员");
    for (const m of ctx.members) {
      lines.push(`- ${m.name} (${m.role})`);
    }
  }

  if (ctx.documents.length > 0) {
    lines.push("");
    lines.push(`## 项目文档 (${ctx.documents.length}个)`);
    for (const d of ctx.documents.slice(0, 8)) {
      lines.push(`- ${d.title} [${d.fileType}]`);
    }
  }

  lines.push("");
  lines.push("## 输出要求");
  lines.push("返回纯 JSON，不要包含其他文本：");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "categories": [`);
  lines.push(`    {`);
  lines.push(`      "name": "分类名（如：文档准备、供应商管理、投标文件、内部审批等）",`);
  lines.push(`      "items": [`);
  lines.push(`        {`);
  lines.push(`          "title": "检查项名称",`);
  lines.push(`          "status": "done / in_progress / todo / at_risk",`);
  lines.push(`          "note": "简短说明（为什么判断为此状态，或建议）"`);
  lines.push(`        }`);
  lines.push(`      ]`);
  lines.push(`    }`);
  lines.push(`  ],`);
  lines.push(`  "overallReadiness": 0-100,`);
  lines.push(`  "criticalBlockers": ["如果有阻塞项，列出（0-3个）"],`);
  lines.push(`  "recommendation": "一句话总结当前准备状态和最重要的下一步"`);
  lines.push(`}`);
  lines.push("```");

  lines.push("");
  lines.push("## 分析原则");
  lines.push("1. 状态判断必须基于数据：有任务完成=done，有进行中任务=in_progress，无相关数据=todo，有逾期/缺失=at_risk");
  lines.push("2. 分类通常包含：项目解读、文档准备、供应商询价/报价、投标定价、内部审批、投标提交");
  lines.push("3. 根据项目当前阶段调整重点 — 早期项目关注文档和解读，后期项目关注报价和提交");
  lines.push("4. overallReadiness 计算：done 项占全部项的百分比，at_risk 项要额外扣分");
  lines.push("5. criticalBlockers 只列出真正阻塞投标的问题");
  lines.push("6. 每个分类 3-6 个检查项，总计不超过 30 项");

  return lines.join("\n");
}
