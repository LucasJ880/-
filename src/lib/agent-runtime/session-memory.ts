/**
 * Session 工作记忆 — 压缩摘要，禁止无限追加全文
 */

const MAX_SUMMARY_CHARS = 1800;
const MAX_LINE = 160;

/** 从本轮对话生成一行压缩摘要 */
export function buildTurnSummaryLine(input: {
  userText: string;
  assistantText: string;
  entities?: {
    projectId?: string | null;
    customerId?: string | null;
    quoteId?: string | null;
  };
}): string {
  const user = input.userText.replace(/\s+/g, " ").trim().slice(0, 40);
  const reply = input.assistantText.replace(/\s+/g, " ").trim().slice(0, 60);
  const bits: string[] = [];
  if (input.entities?.projectId) bits.push(`项目:${input.entities.projectId.slice(0, 8)}`);
  if (input.entities?.customerId) bits.push(`客户:${input.entities.customerId.slice(0, 8)}`);
  if (input.entities?.quoteId) bits.push(`报价:${input.entities.quoteId.slice(0, 8)}`);
  const ent = bits.length ? ` [${bits.join(",")}]` : "";
  return `${user} → ${reply}${ent}`.slice(0, MAX_LINE);
}

/** 合并历史摘要：保留最近若干行，总长截断 */
export function mergeSessionSummary(
  previous: string | null | undefined,
  turnLine: string,
): string {
  const prevLines = (previous || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const next = [...prevLines, turnLine.trim()].filter(Boolean);
  // 只保留最近 12 轮摘要行
  const kept = next.slice(-12);
  let joined = kept.join("\n");
  if (joined.length > MAX_SUMMARY_CHARS) {
    joined = joined.slice(-MAX_SUMMARY_CHARS);
    const cut = joined.indexOf("\n");
    if (cut > 0 && cut < 80) joined = joined.slice(cut + 1);
  }
  return joined;
}
