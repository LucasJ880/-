/**
 * PROC-1 导出（纯函数）：申请卡 Markdown 与明细 CSV。继承调用方的读权限；不导出附件内容。
 */

import { AMOUNT_BASIS_LABELS, type AmountBasis } from "./extract-pure";
import { OUTCOME_LABELS } from "./case-pure";
import { PATH_TYPE_LABELS, RECORD_CATEGORY_LABELS, type PathType } from "./request-pure";
import type { RequestDetail } from "./views";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // 防表格公式注入：以 = + - @ 开头的文本加前导单引号
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function lineItemsCsv(d: RequestDetail): string {
  const head = [
    "line_id", "instrument_number", "document_type", "amount_basis", "amendment_mode", "doc_ref", "doc_date", "product", "specification",
    "quantity", "unit", "unit_price", "amount", "currency", "delivery_location", "tax_freight", "credit_or_cancellation",
    "source_file", "source_page", "source_sheet", "source_row", "extraction_method", "review_status", "raw_snippet",
  ];
  const fileName = new Map(d.attachments.map((a) => [a.id, a.originalFilename]));
  const rows = d.lineItems.map((l) => [
    l.id, l.instrumentNumber, l.documentType, l.amountBasis, l.amendmentMode, l.docRef, l.docDate, l.productDescription, l.specification,
    l.quantity, l.unit, l.unitPrice, l.amount, l.currency, l.deliveryLocation, l.taxFreightNote, l.isCancellationOrCredit ? "yes" : "no",
    fileName.get(l.attachmentId) ?? l.attachmentId, l.sourcePage, l.sourceSheet, l.sourceRow, l.extractionMethod, l.reviewStatus, l.rawSnippet,
  ]);
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const cents = (c: number | null | undefined, cur?: string | null) => (c === null || c === undefined ? "未知（不按 0 处理）" : `${(c / 100).toFixed(2)} ${cur ?? ""}`.trim());

export function requestCardMarkdown(d: RequestDetail): string {
  const v = d.currentVersion;
  const analysis = d.analyses[0];
  const res = (analysis?.result ?? null) as { headlineZh?: string; totals?: Array<{ basis: string; currency: string; total: string; lineCount: number }> } | null;
  const lines: string[] = [
    `# 资料申请卡：${d.title}`,
    "",
    `- 状态：${d.status} ｜ 文件：${d.filesStatus} ｜ 分析：${d.analysisStatus} ｜ 政府处理结果：${d.governmentOutcome ? OUTCOME_LABELS[d.governmentOutcome as keyof typeof OUTCOME_LABELS] ?? d.governmentOutcome : "—"}`,
    `- 来源：${d.origin}${d.originNote ? `（${d.originNote}）` : ""}`,
    `- 关联 Tender：${d.project?.name ?? "—"}`,
    `- 关联合同 / SO / 招标：${(v?.instrumentRefs ?? []).map((r) => r.number).join("、") || "—"}`,
    `- 司法辖区 / 法律：${d.jurisdictionLabel} / ${d.lawLabel ?? "未核实"}`,
    `- 接收机关：${d.recipientDisplay ?? "未填写"}；持有依据：${d.recordsHolderBasis ?? "未填写"}`,
    `- 路径 / 渠道：${PATH_TYPE_LABELS[d.pathType as PathType] ?? d.pathType} / ${d.channel}`,
    `- 期间：${v?.startDate ?? "?"} 至 ${v?.endDate ?? "?"}（含首尾日）`,
    `- 记录类别：${((v?.categories ?? []) as string[]).map((c) => RECORD_CATEGORY_LABELS[c as keyof typeof RECORD_CATEGORY_LABELS] ?? c).join("；") || "—"}`,
    `- 规则：${d.rule ? `${d.rule.verificationStatus === "VERIFIED" ? "已核实" : "未核实"}；费用 ${cents(d.rule.applicationFeeCents, d.rule.currency)}；入口 ${d.rule.officialPortalUrl ?? "未核实"}` : "缺失"}`,
    `- 重复检查：${d.duplicate.result}${d.duplicate.ledgerVerified ? "" : "（台账未核实）"}`,
    `- 就绪：${d.ready.ready ? "READY 条件满足" : `未满足：${d.ready.blockers.map((b) => b.code).join("、")}`}`,
    `- 提交：${d.submission.submittedAt ?? "未提交"}；submission reference：${d.submission.submissionReference ?? "—"}；case number：${d.submission.caseNumber ?? "—"}；证据等级：${d.submission.evidenceLevel ?? "—"}`,
    `- 期限：官方 ${d.deadlines.officialDueAt ?? "—"}；估算 ${d.deadlines.estimatedDueAt ?? "—"}${d.deadlines.estimateBasis ? `（${d.deadlines.estimateBasis}）` : ""}`,
    "",
    "## 中文说明",
    "",
    v?.explanationZh ?? "—",
    "",
    `## 英文正文（v${v?.versionNo ?? "?"} · text hash ${v?.textHash.slice(0, 16) ?? "?"}）`,
    "",
    "```text",
    v?.bodyEn ?? "",
    "```",
    "",
    "## 时间线",
    "",
    ...d.events.map((e) => `- ${e.recordedAt.slice(0, 16).replace("T", " ")} ${e.label}${e.evidenceLevel ? `［${e.evidenceLevel}］` : ""}${e.actor ? ` · ${e.actor}` : ""}${e.noteZh ? ` — ${e.noteZh}` : ""}`),
    "",
    "## 分析",
    "",
    analysis
      ? [`${res?.headlineZh ?? "已取得记录的合计"}（分析 v${analysis.versionNo}，${analysis.status}）`, ...(res?.totals ?? []).map((t) => `- ${AMOUNT_BASIS_LABELS[t.basis as AmountBasis] ?? t.basis}：${t.total} ${t.currency}（${t.lineCount} 条）`), "", "缺口：", ...((analysis.gaps as string[]) ?? []).map((g) => `- ${g}`)].join("\n")
      : "尚未分析",
    "",
  ];
  return lines.join("\n");
}
