/**
 * 把适配出来的 PendingAction 草稿格式化为微信短文本（编号确认）。
 *
 * 约束：
 * - 最多展示 3 个动作
 * - 不暴露数据库 ID / 不输出内部 payload
 * - 每个动作带编号，编号顺序与创建顺序一致（与数字回复解析逻辑对齐）
 */

import type { AdaptedPendingAction } from "./to-pending-action";
import { isWeChatConfirmableAction } from "./wechat-confirm-policy";

const MAX_DISPLAY = 3;

/**
 * 仅展示「成功创建草稿」的动作。占位（executable=false）的动作也会展示，
 * 但会标注"仅建议"，用户确认时 executor 会安全降级返回 unsupported。
 */
export function formatPendingActionsForWeChat(
  actions: AdaptedPendingAction[],
): string {
  const created = actions.filter((a) => a.ok && a.actionId);
  // 只给微信可确认（白名单）的动作编号；对外发送 / 改买家可见内容（如报价备注）/ 高风险的只列标题，引导去网页审批
  const confirmable = (a: AdaptedPendingAction) => isWeChatConfirmableAction(a.pendingType, { targetType: a.noteTargetType });
  const usable = created.filter(confirmable).slice(0, MAX_DISPLAY);
  const webOnly = created.filter((a) => !confirmable(a)).slice(0, MAX_DISPLAY);
  if (usable.length === 0 && webOnly.length === 0) return "";

  const out: string[] = [];
  if (usable.length > 0) {
    out.push(
      "可执行动作：",
      ...usable.map((a, i) => {
        const suffix = a.executable ? "" : "（仅建议，暂不执行）";
        return `${i + 1} = ${a.title}${suffix}`;
      }),
      "",
      "回复编号即可确认，回复\u201c取消\u201d放弃。也可打开工作台确认。",
    );
  }
  if (webOnly.length > 0) {
    if (out.length) out.push("");
    out.push("需在青砚网页看完内容后审批：", ...webOnly.map((a) => `· ${a.title}`));
  }
  return out.join("\n");
}
