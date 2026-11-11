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

/** 页内位置的元素 id。前三个是页面上已有的；后两个由「标书与报价」页签包一层提供 */
export const NEXT_STEP_ANCHORS = {
  analysis: "tender-analysis",
  rfqRounds: "rfq-rounds",
  bidQuote: "bid-quote-area",
  bidWorkspace: "bid-workspace",
} as const;
export const rfqRoundAnchorId = (inquiryId: string): string => `rfq-round-${inquiryId}`;
export const APPROVAL_CENTER_HREF = "/capabilities/approvals";

export type WebNextStepRule =
  | "closed"
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
  | "no_rfq"
  | "no_reply"
  | "reply_deadline_passed"
  | "waiting_replies"
  | "single_quote"
  | "no_quotes"
  | "quotes_ready"
  | "price_pending"
  | "prepare_submission"
  | "idle";

export type WebNextStepAction = { labelZh: string; target: WebNextStepTarget };

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
  /** 截标时间（ISO）；没有填为 null。由页面按本地时区显示 */
  closesAt: string | null;
  /** 顺带要办的事，不超过三条 */
  also: Array<{ textZh: string; target: WebNextStepTarget }>;
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

/** 两个位置是不是同一处（卡片用来判断「你已经在这里了」） */
export function sameTarget(a: WebNextStepTarget, b: WebNextStepTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
