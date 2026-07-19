/**
 * 把适配出来的 PendingAction 草稿格式化为微信短文本（编号确认）。
 *
 * 约束：
 * - 最多展示 3 个动作
 * - 不暴露数据库 ID / 不输出内部 payload
 * - 每个动作带编号，编号顺序与创建顺序一致（与数字回复解析逻辑对齐）
 */

import type { AdaptedPendingAction } from "./to-pending-action";

const MAX_DISPLAY = 3;

/**
 * 仅展示「成功创建草稿」的动作。占位（executable=false）的动作也会展示，
 * 但会标注"仅建议"，用户确认时 executor 会安全降级返回 unsupported。
 */
export function formatPendingActionsForWeChat(
  actions: AdaptedPendingAction[],
): string {
  const usable = actions.filter((a) => a.ok && a.actionId).slice(0, MAX_DISPLAY);
  if (usable.length === 0) return "";

  const lines = usable.map((a, i) => {
    const suffix = a.executable ? "" : "（仅建议，暂不执行）";
    return `${i + 1} = ${a.title}${suffix}`;
  });

  return [
    "可执行动作：",
    ...lines,
    "",
    "回复编号即可确认，回复\u201c取消\u201d放弃。也可打开工作台确认。",
  ].join("\n");
}
