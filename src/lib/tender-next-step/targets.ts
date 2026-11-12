/**
 * FLOW-H1 「下一步」的结果与它指向的位置（零依赖，前后端共用）
 *
 * 位置是数据：页面按它切页签、滚动、开文件抽屉或跳转。这里不执行任何动作。
 */

export type NextStepTab = "workbench" | "requirements" | "bid" | "intel" | "submission";

export type WebNextStepTarget =
  /** 项目页的一个页签；anchor 是页内一个元素的 id（没有 = 页签顶部） */
  | { kind: "tab"; tab: NextStepTab; anchor: string | null }
  /** 项目文件抽屉（上传在这里） */
  | { kind: "files" }
  /** 项目页之外的页面（审批中心） */
  | { kind: "href"; href: string };

/**
 * 页内位置的元素 id。都在「无论有没有数据都会渲染」的元素上——位置不存在，点了就哪儿也去不了。
 * analysis / rfqRound 是页面上已有的；其余由对应的区块提供。
 */
export const NEXT_STEP_ANCHORS = {
  analysis: "tender-analysis",
  /** 供应商询价这一整块（「问供应商要价」按钮在它的顶部；还没有轮次时也在） */
  rfqSection: "rfq-section",
  bidQuote: "bid-quote-area",
  bidWorkspace: "bid-workspace",
  /** 工作台的项目进度 · 关键日期 */
  keyDates: "project-key-dates",
} as const;
export const rfqRoundAnchorId = (inquiryId: string): string => `rfq-round-${inquiryId}`;
export const APPROVAL_CENTER_HREF = "/capabilities/approvals";

export type WebNextStepRule =
  | "closed"
  | "won"
  | "submitted"
  | "past_closing"
  | "pending_approval"
  | "no_documents"
  | "parsing"
  | "analysis_failed"
  | "no_analysis"
  | "analysis_running"
  | "unknown_facts"
  | "mandatory_gap"
  | "requirements_review"
  | "no_confirmed_requirements"
  | "no_rfq"
  | "no_reply"
  | "reply_deadline_passed"
  | "replies_to_record"
  | "waiting_replies"
  | "single_quote"
  | "no_quotes"
  | "quotes_ready"
  | "price_pending"
  | "prepare_submission"
  | "idle";

export type WebNextStepAction = { labelZh: string; target: WebNextStepTarget };

/** 六段阶段（与 src/lib/tender/types 的 TenderStage 同一组值；这个文件零依赖，所以在这里再写一遍，测试核对两者一致） */
export type NextStepStage = "initiation" | "distribution" | "interpretation" | "supplier_inquiry" | "supplier_quote" | "submission";

export type WebNextStepView = {
  rule: WebNextStepRule;
  /** 一句结论：现在卡在哪 */
  headlineZh: string;
  /** 不超过三条原因 */
  reasonsZh: string[];
  /** 去哪里；没有可去的位置为 null（如正在分析） */
  action: WebNextStepAction | null;
  /** 三天内截标且未提交时的提醒；与下一步并存 */
  urgencyZh: string | null;
  /** 截标时间（ISO）；没有填为 null。手工填的截标时间只有日期，所以页面只显示到日 */
  closesAt: string | null;
  /** 顺带要办的事，不超过三条 */
  also: Array<{ textZh: string; target: WebNextStepTarget }>;
  /**
   * FLOW-H1b：按实际进度，这个标到了六段里的哪一段（有提交时间 / 有报价 / 有已发出的询价 / 有可用的分析）。
   * 页面拿它与记录的阶段比，显示靠后的那个。只是一个阶段名。
   */
  actualStage: NextStepStage;
};

/**
 * 位置对应的网址（都在站内）。页签 → `/projects/{id}?tab=…#anchor`；文件抽屉用页面认得的旧别名 `?tab=files`。
 * 页面内导航不整页跳转，只用它更新地址栏；它也是卡片按钮的 href（新标签页打开时仍然到位）。
 */
export function nextStepHref(projectId: string, target: WebNextStepTarget): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (target.kind === "href") return target.href;
  if (target.kind === "files") return `${base}?tab=files`;
  return `${base}?tab=${target.tab}${target.anchor ? `#${encodeURIComponent(target.anchor)}` : ""}`;
}

/** 两个位置是不是同一处 */
export function sameTarget(a: WebNextStepTarget, b: WebNextStepTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 来自数据库的自由文字（审批标题、阻断项说明、询价入口的说明）里如果带着金额或百分比，整段换掉——
 * 这个接口不出任何金额，不做局部遮盖。
 */
export function withoutMoney(text: string, replacement: string): string {
  return /[$¥￥€£]|\d\s*%|\d\s*(?:元|万元|美元|加元)|\b(?:CAD|USD|RMB|CNY|EUR)\b|毛利|利润率|估值/i.test(text) ? replacement : text;
}
