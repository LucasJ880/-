"use client";

/**
 * @ 输入的共用 hook（COLLAB-2，design D5）：项目讨论区输入框与任务评论框共用。
 * 触发、过滤、插入、按键与发送名单的规则都在 src/lib/notifications/collab/mention-input.ts（纯函数，有单测）；
 * 这里只管状态。下拉列表用 MentionDropdown。
 */

import { useCallback, useMemo, useState, type RefObject } from "react";
import type { MentionItem } from "@/lib/project-discussion/types";
import {
  addMention,
  detectMentionTrigger,
  filterMentionCandidates,
  insertMentionAt,
  mentionKeyAction,
  mentionsInBody,
  type MentionCandidate,
  type MentionTrigger,
} from "@/lib/notifications/collab/mention-input";

export function useMentionInput<M extends MentionCandidate>(opts: {
  /** 可 @ 的人 */
  members: M[];
  /** 输入框当前正文与它的 setter（正文状态仍由调用方持有） */
  value: string;
  setValue: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { members, value, setValue, textareaRef } = opts;
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates = useMemo(
    () => (trigger ? filterMentionCandidates(members, trigger.query) : []),
    [members, trigger],
  );
  const open = candidates.length > 0;

  const close = useCallback(() => {
    setTrigger(null);
    setActiveIndex(0);
  }, []);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setValue(next);
      setTrigger(detectMentionTrigger(next, e.target.selectionStart));
      setActiveIndex(0);
    },
    [setValue],
  );

  /** 选中候选：在光标处插入 `@姓名 `，并记进 @ 名单 */
  const select = useCallback(
    (member: M) => {
      const ta = textareaRef.current;
      if (!ta || !trigger) return;
      const inserted = insertMentionAt(value, trigger.start, ta.selectionStart, member.name);
      setValue(inserted.value);
      setMentions((prev) => addMention(prev, { userId: member.userId, name: member.name }));
      setTrigger(null);
      setActiveIndex(0);
      setTimeout(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = inserted.cursor;
      }, 0);
    },
    [textareaRef, trigger, value, setValue],
  );

  /** 候选列表打开时处理上下键、回车 / Tab 与 Esc；处理了返回 true，调用方就不再发送 */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const action = mentionKeyAction({ key: e.key, open, count: candidates.length, activeIndex });
      if (!action) return false;
      e.preventDefault();
      if (action.kind === "move") setActiveIndex(action.index);
      else if (action.kind === "select") select(candidates[action.index]);
      else close();
      return true;
    },
    [open, candidates, activeIndex, select, close],
  );

  /** 从别处（例如点成员头像）直接加入 @ 名单 */
  const add = useCallback((item: MentionItem) => {
    setMentions((prev) => addMention(prev, item));
  }, []);

  /** 发送时提交的 @ 名单：只含正文里仍出现 `@姓名` 的人 */
  const submitMentions = useCallback((body: string) => mentionsInBody(mentions, body), [mentions]);

  /** 发送成功后清空 @ 名单 */
  const reset = useCallback(() => {
    setMentions([]);
    setTrigger(null);
    setActiveIndex(0);
  }, []);

  return {
    open,
    candidates,
    query: trigger?.query ?? "",
    activeIndex,
    onChange,
    onKeyDown,
    select,
    close,
    addMention: add,
    submitMentions,
    reset,
  };
}
