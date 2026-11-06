/**
 * PROC-1 展示用常量与中文标签（客户端安全：不依赖 node / DB）。
 * 业务模块从这里 re-export，保证服务端与界面使用同一份词表。
 */

export const RECORD_CATEGORIES = ["CONTRACT_DOCS", "CALL_UPS_USAGE", "USAGE_REPORTS", "FINANCIALS", "PRICE_SCHEDULE"] as const;
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];
export const UNKNOWN_CATEGORY = "UNKNOWN" as const;
export const RECORD_CATEGORY_LABELS: Record<RecordCategory | typeof UNKNOWN_CATEGORY, string> = {
  CONTRACT_DOCS: "最终合同 / SO 及附件、修订与已行使的续期 / 延期选项",
  CALL_UPS_USAGE: "Call-up / PO / 使用记录（品名、数量、单位、单价、日期、交付地、订单值与累计值）",
  USAGE_REPORTS: "年度或季度使用报告",
  FINANCIALS: "分别列示的 committed / ordered / invoiced / paid 及取消、退货、贷项",
  PRICE_SCHEDULE: "最终 Basis of Payment / 价格表（可披露部分）",
  UNKNOWN: "类别未知（历史导入）",
};

export const PATH_TYPES = ["PUBLIC_RECORD", "COMPLETED_ATI_COPY", "NEW_FORMAL_REQUEST"] as const;
export type PathType = (typeof PATH_TYPES)[number];
export const PATH_TYPE_LABELS: Record<PathType, string> = {
  PUBLIC_RECORD: "直接取得公开资料（无需申请）",
  COMPLETED_ATI_COPY: "索取已完成 ATI 的既有披露副本（非正式，对外申请）",
  NEW_FORMAL_REQUEST: "提出新的正式申请",
};

export const REQUEST_STATUSES = [
  "DRAFT",
  "READY",
  "HANDOFF_PENDING",
  "USER_REPORTED_SUBMISSION",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "PROCESSING",
  "CLOSED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "草稿",
  READY: "就绪（可自助提交）",
  HANDOFF_PENDING: "交接中（尚未提交）",
  USER_REPORTED_SUBMISSION: "用户报告已提交（待核实）",
  SUBMISSION_UNKNOWN: "提交结果不确定",
  SUBMITTED: "已提交（回执已核对）",
  ACKNOWLEDGED: "机关已受理",
  PROCESSING: "处理中",
  CLOSED: "政府处理已结束",
};

export const FILES_STATUS_LABELS: Record<string, string> = {
  NONE: "无文件",
  NOTICE_RECEIVED: "只收到通知 / 来信",
  PARTIAL_FILES_RECEIVED: "已取得部分披露文件",
  FILES_RECEIVED: "已取得全部披露文件",
};

export const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "未分析",
  QUEUED: "排队中",
  RUNNING: "分析中",
  NEEDS_REVIEW: "待复核",
  COMPLETED: "已完成（覆盖范围见缺口）",
  FAILED: "失败",
};

export const GOVERNMENT_OUTCOMES = [
  "FULL_DISCLOSURE",
  "PARTIAL_DISCLOSURE",
  "NO_RECORDS",
  "ALL_WITHHELD",
  "TRANSFERRED",
  "WITHDRAWN",
  "CANCELLED",
  "OTHER",
] as const;
export type GovernmentOutcome = (typeof GOVERNMENT_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<GovernmentOutcome, string> = {
  FULL_DISCLOSURE: "全部披露",
  PARTIAL_DISCLOSURE: "部分披露",
  NO_RECORDS: "无记录（不代表采购金额为 0）",
  ALL_WITHHELD: "全部不予披露",
  TRANSFERRED: "已转交其他机关",
  WITHDRAWN: "已撤回",
  CANCELLED: "已取消",
  OTHER: "其他",
};

export const EVIDENCE_LEVEL_LABELS: Record<string, string> = {
  user_reported: "用户报告（待核实）",
  document_verified: "回执 / 来信已核对",
  runtime_verified: "系统执行核实（V1 不产生）",
};

/** 用户可登记的政府来信 / 处理事件 */
export const CASE_EVENT_TYPES = [
  "ACKNOWLEDGED",
  "CLARIFICATION_REQUEST",
  "CLARIFICATION_SENT",
  "FEE_NOTICE",
  "EXTENSION",
  "TRANSFER_ADVISED",
  "TRANSFERRED",
  "PARTIAL_RELEASE",
  "RESPONSE_LETTER",
  "FINAL_RESPONSE",
  "FILES_RECEIVED_CONFIRMED",
  "WITHDRAWAL_CONFIRMED",
  "INTERNAL_FOLLOW_UP",
  "NOTE",
  "CORRECTION",
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

export const EVENT_LABELS: Record<string, string> = {
  CREATED: "创建申请卡",
  VERSION_CREATED: "保存新版本",
  READY_CHECKED: "通过就绪检查",
  REVERTED_TO_DRAFT: "回到草稿",
  HANDOFF_STARTED: "开始自助交接",
  HANDOFF_CANCELLED: "取消交接",
  COPIED_BODY: "复制正文（不等于已提交）",
  OPENED_PORTAL: "打开官方入口（不等于已提交）",
  VIEWED_FIELD_GUIDE: "查看字段对应",
  USER_REPORTED_SUBMISSION: "用户报告已提交（待核实）",
  SUBMISSION_UNKNOWN: "提交结果不确定",
  SUBMISSION_VERIFIED: "回执核对通过",
  RESOLVED_NOT_SUBMITTED: "确认未提交（解除不确定）",
  ACKNOWLEDGED: "机关受理 / 案件编号",
  CLARIFICATION_REQUEST: "机关要求澄清 / 补充",
  CLARIFICATION_SENT: "已回复澄清",
  FEE_NOTICE: "费用通知",
  EXTENSION: "延期通知",
  TRANSFER_ADVISED: "建议向另一机关申请",
  TRANSFERRED: "机关已正式转交",
  PARTIAL_RELEASE: "部分披露（中期）",
  RESPONSE_LETTER: "回复信 / 披露通知",
  FINAL_RESPONSE: "最终回应",
  FILES_RECEIVED_CONFIRMED: "确认已取得全部披露文件",
  WITHDRAWAL_CONFIRMED: "撤回已获机关确认",
  INTERNAL_FOLLOW_UP: "内部跟进提醒",
  NOTE: "备注",
  CORRECTION: "更正",
  ARCHIVED: "本地归档（未提交）",
  ATTACHMENT_ADDED: "上传附件",
  ANALYSIS_RUN: "生成分析",
  LINE_ITEM_REVIEWED: "复核明细",
  HISTORICAL_IMPORT: "导入历史记录",
};

export const AMOUNT_BASES = ["CEILING", "EVALUATED", "COMMITTED", "ORDERED", "INVOICED", "PAID", "UNKNOWN"] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];
export const AMOUNT_BASIS_LABELS: Record<AmountBasis, string> = {
  CEILING: "上限 / 框架值（ceiling）",
  EVALUATED: "评估价（evaluated）",
  COMMITTED: "承诺（committed）",
  ORDERED: "订单（ordered）",
  INVOICED: "发票（invoiced）",
  PAID: "已付（paid）",
  UNKNOWN: "口径未识别",
};

export const DOCUMENT_TYPES = ["CONTRACT", "AMENDMENT", "CALL_UP", "PURCHASE_ORDER", "INVOICE", "PAYMENT", "USAGE_REPORT", "PRICE_SCHEDULE", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SOURCE_STATUSES = ["SUCCESS", "PARTIAL", "UNAVAILABLE", "PARSE_FAILED", "SKIPPED"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  SUCCESS: "成功",
  PARTIAL: "部分成功",
  UNAVAILABLE: "无法获取",
  PARSE_FAILED: "解析失败",
  SKIPPED: "未执行",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "运行中",
  SUCCEEDED: "成功",
  PARTIAL: "部分成功（有来源失败）",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export const ATTACHMENT_KINDS = ["RECEIPT", "GOVERNMENT_LETTER", "DISCLOSURE_FILE", "PAYMENT_PROOF", "PORTAL_SCREENSHOT", "OTHER"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  RECEIPT: "提交回执 / 确认",
  GOVERNMENT_LETTER: "政府来信",
  DISCLOSURE_FILE: "披露文件",
  PAYMENT_PROOF: "付款凭证（不能单独证明提交）",
  PORTAL_SCREENSHOT: "门户截图（不能单独证明提交）",
  OTHER: "其他",
};

export const PARSE_STATUS_LABELS: Record<string, string> = {
  PENDING: "待解析",
  PARSING: "解析中",
  PARSED: "已解析",
  NEEDS_OCR: "需要 OCR（无文字层，可人工录入）",
  ENCRYPTED: "已加密，无法读取",
  CORRUPT: "文件损坏",
  UNSUPPORTED: "格式不支持",
  FAILED: "解析失败（稍后重试）",
};

export const TRIAGE_LABELS: Record<string, string> = {
  CANDIDATE: "候选",
  WATCHING: "已关注",
  IGNORED: "已忽略",
  ARCHIVED: "已归档",
  HISTORY: "历史记录",
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  CANADABUYS_TENDER_NOTICES: "CanadaBuys 招标公告",
  OPEN_CANADA_CONTRACTS: "Open Government 合同披露",
  OPEN_CANADA_ATI_SUMMARIES: "Completed ATI 摘要",
  CANADABUYS_CONTRACT_HISTORY_PAGE: "CanadaBuys 合同历史页",
  MANUAL_LINK: "人工导入",
  TASKBRIEF_SEED: "研究种子（未复核）",
};
