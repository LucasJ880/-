/**
 * 协作通知 COLLAB-2：@ 输入的纯逻辑（design D5，spec notifications/mentions「任务评论框支持 @」）
 *
 * 从讨论区输入框里抽出来，讨论区与任务评论框共用；
 * React 部分在 src/components/project-discussion/use-mention-input.ts。
 */

/** @ 之后最多按这么多字查候选，超过就当作普通文字 */
export const MENTION_QUERY_MAX = 20;

export interface MentionCandidate {
  userId: string;
  name: string;
}

export interface MentionTrigger {
  /** `@` 在正文里的位置 */
  start: number;
  /** `@` 与光标之间的文字 */
  query: string;
}

/** 光标前最近的 `@` 在行首或空白后，且它与光标之间没有空白、不超过 20 字 → 触发 */
export function detectMentionTrigger(value: string, cursor: number): MentionTrigger | null {
  const before = value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > MENTION_QUERY_MAX) return null;
  return { start: at, query };
}

/** 按姓名包含关系过滤，不区分大小写；查询为空时返回全部 */
export function filterMentionCandidates<M extends MentionCandidate>(
  members: readonly M[],
  query: string,
): M[] {
  const q = query.toLowerCase();
  if (!q) return [...members];
  return members.filter((m) => m.name.toLowerCase().includes(q));
}

/** 用 `@姓名 ` 替换从 `@` 到光标的文字，返回新正文与新光标位置（落在空格之后） */
export function insertMentionAt(
  value: string,
  start: number,
  cursor: number,
  name: string,
): { value: string; cursor: number } {
  const tag = `@${name} `;
  const before = value.slice(0, start);
  const after = value.slice(Math.max(cursor, start));
  return { value: before + tag + after, cursor: before.length + tag.length };
}

/** 同一人只记一次；已在名单里时返回原数组 */
export function addMention<T extends MentionCandidate>(list: readonly T[], item: T): T[] {
  if (list.some((m) => m.userId === item.userId)) return list as T[];
  return [...list, item];
}

/** 发送时只提交正文里仍出现 `@姓名` 的人 */
export function mentionsInBody<T extends MentionCandidate>(list: readonly T[], body: string): T[] {
  return list.filter((m) => body.includes(`@${m.name}`));
}

export type MentionKeyAction =
  | { kind: "move"; index: number }
  | { kind: "select"; index: number }
  | { kind: "close" };

/**
 * 候选列表打开时的按键：上下键移动、回车或 Tab 选中、Esc 关闭。
 * 返回 null 表示不处理——列表没打开时回车由调用方照常发送。
 */
export function mentionKeyAction(input: {
  key: string;
  open: boolean;
  count: number;
  activeIndex: number;
}): MentionKeyAction | null {
  const { key, open, count, activeIndex } = input;
  if (!open || count <= 0) return null;
  if (key === "ArrowDown") return { kind: "move", index: (activeIndex + 1) % count };
  if (key === "ArrowUp") return { kind: "move", index: (activeIndex - 1 + count) % count };
  if (key === "Enter" || key === "Tab") {
    return { kind: "select", index: Math.min(Math.max(activeIndex, 0), count - 1) };
  }
  if (key === "Escape") return { kind: "close" };
  return null;
}
