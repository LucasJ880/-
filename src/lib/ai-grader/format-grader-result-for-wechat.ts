/**
 * 把 GraderResult + 适配出的 PendingAction 格式化为微信短文本（今日体检）。
 *
 * 约束：
 * - 总长 ≤ 1200 字
 * - 最多展示 Top 5 issues、Top 3 actions
 * - 不暴露数据库 ID / 内部 payload
 * - 中文短句为主
 * - 动作编号与适配出的 pending actions 顺序一致（与数字回复解析对齐）
 */

import type { GraderResult, RiskLevel } from "./types";
import type { AdaptedPendingAction } from "./actions/to-pending-action";

const MAX_ISSUES = 5;
const MAX_ACTIONS = 3;
const MAX_LEN = 1200;

const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export interface FormatGraderOptions {
  /** 顶部标题，默认「青砚今日体检」 */
  title?: string;
  /** 标题下的主体行，如「客户：Lucas」（可选） */
  subject?: string;
  /** issues 小节标题，默认「今天建议优先处理：」 */
  issuesHeader?: string;
  /** 无 issues 时的提示文案 */
  emptyText?: string;
}

export function formatGraderResultForWeChat(
  result: GraderResult,
  adaptedActions: AdaptedPendingAction[] = [],
  opts: FormatGraderOptions = {},
): string {
  const lines: string[] = [];

  lines.push(`【${opts.title ?? "青砚今日体检"}】`);
  if (opts.subject) lines.push(opts.subject);
  lines.push(`评分：${result.score}/100`);
  lines.push(`风险：${RISK_LABEL[result.riskLevel]}`);
  lines.push("");

  if (result.issues.length === 0) {
    lines.push(opts.emptyText || result.summary || "暂未发现明显风险，保持节奏 👍");
    return clamp(lines.join("\n"));
  }

  lines.push(opts.issuesHeader ?? "今天建议优先处理：");
  result.issues.slice(0, MAX_ISSUES).forEach((issue, i) => {
    lines.push(`${i + 1}. ${issue.title}`);
  });

  const usable = adaptedActions.filter((a) => a.ok && a.actionId).slice(0, MAX_ACTIONS);
  if (usable.length > 0) {
    lines.push("");
    lines.push("可执行：");
    usable.forEach((a, i) => {
      const suffix = a.executable ? "" : "（仅建议，暂不执行）";
      lines.push(`${i + 1} = ${a.title}${suffix}`);
    });
    lines.push("");
    lines.push("回复编号即可确认，回复\u201c取消\u201d放弃。");
  }

  return clamp(lines.join("\n"));
}

function clamp(text: string): string {
  if (text.length <= MAX_LEN) return text;
  return text.slice(0, MAX_LEN - 1) + "…";
}
