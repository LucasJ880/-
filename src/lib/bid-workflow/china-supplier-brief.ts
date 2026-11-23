/**
 * 供应商侧敏感词判断（全量模式）。
 *
 * 文件名是历史遗留：这里原先还拼「国内供应商简报（China Brief）」的正文，RFQ-PDF-1 已停止生成那份文件
 * （发给供应商的文件收口到询价单，见 src/lib/tender-rfq/）。留下的是询价生成、催单与追问、
 * 供应商情报外发查询共用的敏感词表：人写的自由文本命中即整份拒绝，不做局部替换。
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /estimatedValue/i,
  /ourBidPrice/i,
  /winningBidPrice/i,
  /毛利|利润|成本|预算|底价|底线|售价|报价底/i,
  /margin|profit|cost|budget|internal note|风险评分|中标概率/i,
  /竞争对手|竞品|竞争策略/i,
  /客户电话|客户邮箱|contactEmail|contactPhone/i,
];

export function containsSensitiveSupplierBriefText(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}
