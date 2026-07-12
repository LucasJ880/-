/**
 * 发布内容规则拦截（确定性检查，先于 AI，不可被绕过）
 *
 * 200 条/天的量级下无法逐条人审，规则层负责兜底：
 * - block：夸大承诺 / 违禁表述，直接拦截，禁止派发
 * - review：含价格、促销承诺等高敏内容，滞留人工审核后才可派发
 * - pass：自动放行
 */

export type RuleVerdict = "pass" | "review" | "block";

export interface RuleCheckResult {
  verdict: RuleVerdict;
  reasons: string[];
}

/** 直接拦截：夸大 / 绝对化 / 平台红线表述 */
const BLOCK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /保证(涨粉|爆单|必爆|效果)/, label: "夸大承诺（保证类）" },
  { re: /全网最低|史上最低|绝对最低/, label: "绝对化价格表述" },
  { re: /永久质保|终身免费/, label: "无限承诺表述" },
  { re: /100%\s*(有效|满意|无风险)/i, label: "绝对化承诺" },
  { re: /\bguaranteed\s+(results?|lowest|best\s+price)\b/i, label: "绝对化承诺 (EN)" },
  { re: /\b(lowest|cheapest)\s+price\s+(ever|in\s+canada)\b/i, label: "绝对化价格表述 (EN)" },
  { re: /\brisk[- ]free\b/i, label: "无风险承诺 (EN)" },
  { re: /\blifetime\s+(warranty|guarantee)\b/i, label: "无限承诺表述 (EN)" },
];

/** 滞留人工：价格 / 折扣 / 促销承诺（内容可能合法，但必须有人确认） */
const REVIEW_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\$\s?\d{2,}/, label: "含具体价格" },
  { re: /\d{1,2}\s?折|[5-9]0%\s?off/i, label: "含折扣信息" },
  { re: /免费(安装|测量|上门)|free\s+(installation|measurement|quote)\b/i, label: "含免费服务承诺" },
  { re: /限时|仅限今日|last\s+chance|today\s+only/i, label: "含限时促销" },
  { re: /(政府|government)[^，。,.!?]{0,8}(补贴|rebate|grant)/i, label: "涉及政府补贴表述" },
];

export function checkContentRules(text: string): RuleCheckResult {
  const reasons: string[] = [];

  for (const { re, label } of BLOCK_PATTERNS) {
    if (re.test(text)) reasons.push(label);
  }
  if (reasons.length > 0) return { verdict: "block", reasons };

  for (const { re, label } of REVIEW_PATTERNS) {
    if (re.test(text)) reasons.push(label);
  }
  if (reasons.length > 0) return { verdict: "review", reasons };

  return { verdict: "pass", reasons: [] };
}
