/**
 * S3-A：工作台文案映射（纯函数，无 DB / 无 React，服务端与客户端共用，可 CI 单测）。
 *
 * 纪律：
 *   - 身份关联 ≠ 采购批准。任何状态都不得显示成「认证通过 / 本标合格 / 首选供应商 / 可下单」。
 *   - Run 的 COMPLETED **不等于**「全部来源搜索成功」；有失败源时必须显示「部分来源失败」。
 *   - 来源状态 SUCCESS / EMPTY / DISABLED / FAILED / 未执行 五者必须可区分。
 *   - 按钮与状态一律采购人员用语，不出现 resolve / run / gate / finalize 等内部术语。
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface LabelWithTone {
  label: string;
  tone: Tone;
  /** 供 title / 说明行使用的一句话解释；没有歧义时为 null */
  hint: string | null;
}

/* ───────────────── 信号状态 ───────────────── */

export function signalStatusDisplay(status: string): LabelWithTone {
  switch (status) {
    case "NEW":
      return { label: "待查看", tone: "info", hint: null };
    case "REVIEWED":
      return { label: "已查看待处理", tone: "warning", hint: "已人工查看，尚未关联或排除" };
    case "LINKED":
      return { label: "已关联供应商", tone: "success", hint: "仅表示身份归属已确认，不代表通过采购审核" };
    case "REJECTED":
      return { label: "不采用", tone: "neutral", hint: "该线索不进入后续采购流程" };
    default:
      return { label: status, tone: "neutral", hint: "未知状态" };
  }
}

/* ───────────────── 身份解析结论 ───────────────── */

export function resolutionDecisionDisplay(decision: string): LabelWithTone {
  switch (decision) {
    case "MATCHED_EXISTING":
      return {
        label: "可能对应现有供应商，待人工确认",
        tone: "info",
        hint: "系统按强身份键预填，仍需人工确认后才建立关联",
      };
    case "NEW_SUPPLIER_CANDIDATE":
      return {
        label: "未匹配到现有供应商",
        tone: "neutral",
        hint: "库内没有同一身份的供应商；如确需建档，请走供应商建档流程",
      };
    case "NEEDS_HUMAN_REVIEW":
      return {
        label: "身份存疑，需人工判断",
        tone: "warning",
        hint: "存在冲突或身份扫描不完整，系统不给强匹配",
      };
    default:
      return { label: decision, tone: "neutral", hint: null };
  }
}

/** 身份扫描完整性——不完整就不能把结论当强匹配用 */
export function scanCompletenessDisplay(complete: boolean): LabelWithTone {
  return complete
    ? { label: "身份扫描完整", tone: "success", hint: "已扫描本组织全部相关记录" }
    : {
        label: "身份扫描未完整",
        tone: "warning",
        hint: "本次未覆盖全部记录，结论不可用作强匹配，请人工核对",
      };
}

/* ───────────────── 搜索运行 ───────────────── */

export function runStatusDisplay(status: string): LabelWithTone {
  switch (status) {
    case "PLANNED":
      return { label: "待开始", tone: "neutral", hint: "已按当前需求生成搜索计划，尚未执行" };
    case "RUNNING":
      return { label: "搜索中", tone: "info", hint: null };
    case "COMPLETED":
      return { label: "搜索已结束", tone: "success", hint: null };
    case "FAILED":
      return { label: "搜索失败", tone: "danger", hint: "所有实际执行的来源都失败了" };
    case "CANCELLED":
      return { label: "已取消", tone: "neutral", hint: null };
    default:
      return { label: status, tone: "neutral", hint: null };
  }
}

export function sourceStatusDisplay(status: string): LabelWithTone {
  switch (status) {
    case "SUCCESS":
      return { label: "有结果", tone: "success", hint: null };
    case "EMPTY":
      return { label: "无结果", tone: "neutral", hint: "该来源正常执行，但没有命中" };
    case "DISABLED":
      return { label: "未启用", tone: "neutral", hint: "该来源未开通或缺少凭据，本轮没有执行" };
    case "FAILED":
      return { label: "该来源失败", tone: "danger", hint: null };
    case "PLANNED":
      return { label: "未执行", tone: "neutral", hint: "已列入计划但本轮没有执行" };
    default:
      return { label: status, tone: "neutral", hint: null };
  }
}

/**
 * Run 级别的诚实总结：终态 + 逐源状态 → 一句话。
 * COMPLETED 且存在 FAILED 源时必须说「部分来源失败」，不得写成全部成功。
 */
export function runOutcomeSummary(
  status: string,
  sources: Record<string, { status: string }> | null | undefined,
): LabelWithTone {
  const values = sources ? Object.values(sources) : [];
  const failed = values.filter((s) => s.status === "FAILED").length;
  const executed = values.filter((s) => s.status !== "PLANNED" && s.status !== "DISABLED").length;
  const withResults = values.filter((s) => s.status === "SUCCESS").length;

  if (status === "FAILED") {
    return { label: "搜索失败：所有已执行来源都失败", tone: "danger", hint: null };
  }
  if (status === "CANCELLED") {
    return { label: "已取消", tone: "neutral", hint: "取消由服务端确认；晚到的结果会被丢弃" };
  }
  if (status === "RUNNING") {
    return { label: "搜索中", tone: "info", hint: null };
  }
  if (status === "PLANNED") {
    return { label: "待开始", tone: "neutral", hint: null };
  }
  // COMPLETED
  if (failed > 0) {
    return {
      label: `搜索已结束，部分来源失败（${failed}/${executed} 个来源失败）`,
      tone: "warning",
      hint: "失败来源的结果缺失，不代表这些渠道没有供应商",
    };
  }
  if (executed === 0) {
    return {
      label: "搜索已结束，但没有任何来源实际执行",
      tone: "warning",
      hint: "外部来源未启用且内部源未运行时会出现这种情况",
    };
  }
  if (withResults === 0) {
    return { label: "搜索已结束，所有来源均无结果", tone: "neutral", hint: null };
  }
  return { label: "搜索已结束", tone: "success", hint: null };
}

/* ───────────────── 平台与来源能力（如实展示，不夸大） ───────────────── */

export function platformDisplay(platform: string): LabelWithTone {
  switch (platform) {
    case "DOUYIN":
      return { label: "抖音", tone: "neutral", hint: "来自公开搜索结果，未直连平台" };
    case "XIAOHONGSHU":
      return { label: "小红书", tone: "neutral", hint: "来自公开搜索结果，未直连平台" };
    case "WECHAT_CHANNELS":
      return { label: "微信视频号", tone: "warning", hint: "平台封闭，需人工手动提交线索" };
    case "ONE688":
      return { label: "1688", tone: "neutral", hint: "专用采集未实现，本轮不执行" };
    case "OPEN_WEB":
      return { label: "公开网页", tone: "neutral", hint: "搜索引擎已索引的公开结果" };
    case "WEBSITE":
      return { label: "官网", tone: "neutral", hint: null };
    case "MANUAL":
      return { label: "人工录入", tone: "info", hint: "采购人员手动提交的线索" };
    default:
      return { label: platform, tone: "neutral", hint: null };
  }
}

export function sourceOriginDisplay(origin: string): LabelWithTone {
  switch (origin) {
    case "USER_SUBMITTED":
      return { label: "用户提交链接", tone: "info", hint: "仅解析了分享链接与文字，未读取完整视频或帖子" };
    case "MANUAL_ENTRY":
      return { label: "人工录入", tone: "info", hint: null };
    case "PUBLIC_WEB":
      return { label: "公开搜索发现", tone: "neutral", hint: "只保存搜索引擎已索引的元数据，未抓取页面" };
    case "PROVIDER":
      return { label: "数据源返回", tone: "neutral", hint: null };
    default:
      return { label: origin, tone: "neutral", hint: null };
  }
}

/* ───────────────── canonical 来源阻断原因 ───────────────── */

export function canonicalBlockReasonText(reasonCode: string): string {
  switch (reasonCode) {
    case "RISKS_SECTION_MISSING":
    case "STRUCTURED_JSON_NULL":
      return "本次分析缺少风险章节，无法判定哪些要求的强制性不确定";
    case "NON_CANONICAL_WRITER_SHAPE":
    case "RISKS_NOT_ARRAY":
    case "STRUCTURED_JSON_NOT_OBJECT":
    case "RISK_ENTRY_NOT_CANONICAL":
      return "风险章节的结构不是当前分析管线的标准输出，无法据此还原强制性";
    case "MULTIPLE_UNCERTAIN_AGGREGATES":
    case "EMPTY_UNCERTAIN_AGGREGATE":
      return "风险章节里的「强制性待确认」记录自相矛盾，无法确定完整清单";
    case "RELATED_IDS_NOT_ARRAY":
    case "RELATED_IDS_MEMBER_INVALID":
      return "「强制性待确认」清单结构非法，无法逐条对应到要求";
    case "UNCERTAIN_LIST_AT_CAP":
      return "「强制性待确认」清单已达到上限，可能被截断，无法证明完整";
    default:
      return "招标要求来源无法证明完整";
  }
}
