/**
 * 协作通知 COLLAB-2：@ 输入（design D5，spec notifications/mentions「任务评论框支持 @」）
 * - 纯逻辑：触发、按姓名过滤、在光标处插入、按键、发送名单
 * - 源码断言：任务抽屉的评论框与讨论区输入框都接了共用 hook 与 MentionDropdown；
 *   候选列表打开时回车选中候选、不发送；评论 4xx 时在评论框下方显示错误并保留草稿
 * 运行：npx tsx src/lib/notifications/__tests__/collab-mention-input.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addMention,
  detectMentionTrigger,
  filterMentionCandidates,
  insertMentionAt,
  mentionKeyAction,
  mentionsInBody,
} from "../collab/mention-input";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 文件不存在时返回空串，让断言逐条报失败 */
const read = (p: string) => {
  const full = join(process.cwd(), p);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
/** 各片段在 src 中依次出现 */
function inOrder(src: string, parts: string[]): boolean {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    if (i < 0 || i <= at) return false;
    at = i;
  }
  return true;
}
/** 从 marker 开始，截到下一个与 marker 同缩进的 `const ` 声明（或文件尾） */
function fnBlock(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) return "";
  const lineStart = src.lastIndexOf("\n", start) + 1;
  const indent = src.slice(lineStart, start);
  const next = src.indexOf(`\n${indent}const `, start + marker.length);
  return src.slice(start, next < 0 ? undefined : next);
}

console.log("触发");
ok(same(detectMentionTrigger("@", 1), { start: 0, query: "" }), "行首输入 @ → 触发，查询为空");
ok(same(detectMentionTrigger("请 @张", 4), { start: 2, query: "张" }), "空白后输入 @ → 触发，查询取 @ 到光标");
ok(same(detectMentionTrigger("第一行\n@李", 6), { start: 4, query: "李" }), "换行后输入 @ → 触发");
ok(detectMentionTrigger("a@b", 3) === null, "紧跟在字母后的 @ 不触发");
ok(detectMentionTrigger("发到 me@x.com", 11) === null, "邮箱地址里的 @ 不触发");
ok(detectMentionTrigger("@张 三", 5) === null, "@ 到光标之间有空白 → 不触发");
ok(same(detectMentionTrigger("@张三 你好", 3), { start: 0, query: "张三" }), "光标在正文中间：只看光标之前");
ok(detectMentionTrigger(`@${"字".repeat(21)}`, 22) === null, "查询超过 20 字 → 不触发");
ok(detectMentionTrigger("没有艾特", 4) === null, "没有 @ → 不触发");

console.log("过滤");
{
  const members = [
    { userId: "U1", name: "张三" },
    { userId: "U2", name: "张三丰" },
    { userId: "U3", name: "李四" },
    { userId: "U4", name: "Alice" },
  ];
  ok(same(filterMentionCandidates(members, "张").map((m) => m.userId), ["U1", "U2"]), "按姓名包含过滤");
  ok(same(filterMentionCandidates(members, "三").map((m) => m.userId), ["U1", "U2"]), "包含即可，不要求开头相同");
  ok(same(filterMentionCandidates(members, "ali").map((m) => m.userId), ["U4"]), "不区分大小写");
  ok(filterMentionCandidates(members, "").length === 4, "查询为空 → 全部候选");
  ok(filterMentionCandidates(members, "王").length === 0, "没有匹配 → 空");
}

console.log("插入");
ok(same(insertMentionAt("请 @张", 2, 4, "张三"), { value: "请 @张三 ", cursor: 6 }), "在光标处插入 `@姓名 `，光标落在空格之后");
ok(same(insertMentionAt("@张 明天见", 0, 2, "张三"), { value: "@张三  明天见", cursor: 4 }), "光标之后的正文原样保留");
ok(same(insertMentionAt("看下 @", 3, 4, "李四"), { value: "看下 @李四 ", cursor: 7 }), "只输了 @ 也能插入");

console.log("发送名单");
{
  const list = [
    { userId: "U1", name: "张三" },
    { userId: "U2", name: "李四" },
  ];
  ok(same(mentionsInBody(list, "请 @张三 看一下").map((m) => m.userId), ["U1"]), "只含正文里仍出现 `@姓名` 的人");
  ok(mentionsInBody(list, "请看一下").length === 0, "删掉了 @ → 不带");
  ok(mentionsInBody(list, "张三 李四").length === 0, "只出现姓名、没有 @ → 不带");
  const once = addMention([], { userId: "U1", name: "张三" });
  const twice = addMention(once, { userId: "U1", name: "张三" });
  ok(twice.length === 1 && twice === once, "同一人选两次只记一次（返回原数组，不触发多余渲染）");
  ok(addMention(once, { userId: "U2", name: "李四" }).length === 2, "不同的人追加");
}

console.log("按键");
{
  const openList = { open: true, count: 3, activeIndex: 0 };
  ok(same(mentionKeyAction({ ...openList, key: "Enter" }), { kind: "select", index: 0 }), "列表打开：回车 → 选中当前候选（不发送）");
  ok(same(mentionKeyAction({ ...openList, key: "Tab" }), { kind: "select", index: 0 }), "列表打开：Tab → 选中当前候选");
  ok(same(mentionKeyAction({ ...openList, key: "ArrowDown" }), { kind: "move", index: 1 }), "下键 → 下一个");
  ok(same(mentionKeyAction({ ...openList, key: "ArrowUp" }), { kind: "move", index: 2 }), "在第一个按上键 → 回到最后一个");
  ok(same(mentionKeyAction({ ...openList, activeIndex: 2, key: "ArrowDown" }), { kind: "move", index: 0 }), "在最后一个按下键 → 回到第一个");
  ok(same(mentionKeyAction({ ...openList, key: "Escape" }), { kind: "close" }), "Esc → 关闭列表");
  ok(mentionKeyAction({ ...openList, key: "a" }) === null, "其他键不处理");
  ok(mentionKeyAction({ open: false, count: 3, activeIndex: 0, key: "Enter" }) === null, "列表没打开：回车不处理（由调用方发送）");
  ok(mentionKeyAction({ open: true, count: 0, activeIndex: 0, key: "Enter" }) === null, "没有候选：回车不处理");
}

console.log("共用 hook");
{
  const hook = read("src/components/project-discussion/use-mention-input.ts");
  ok(/^"use client";/.test(hook), "hook 是客户端模块");
  for (const fn of ["detectMentionTrigger(", "filterMentionCandidates(", "insertMentionAt(", "mentionKeyAction(", "mentionsInBody(", "addMention("]) {
    ok(hook.includes(fn), `hook 用纯函数 ${fn.slice(0, -1)}`);
  }
  ok(/export function useMentionInput/.test(hook), "导出 useMentionInput");
}

console.log("讨论区输入框接线");
{
  const composer = read("src/components/project-discussion/project-discussion-composer.tsx");
  ok(/import \{ useMentionInput \} from "\.\/use-mention-input"/.test(composer), "导入共用 hook");
  ok(/<MentionDropdown[\s\S]{0,200}members=\{mention\.candidates\}/.test(composer), "下拉列表用 hook 的候选");
  ok(!/lastIndexOf\("@"\)/.test(composer), "输入框不再自己判断触发");
  const keyDown = fnBlock(composer, "const handleKeyDown");
  ok(inOrder(keyDown, ["if (mention.onKeyDown(e)) return;", "handleSend()"]), "列表打开时按键先交给 hook，处理了就不发送");
  const send = fnBlock(composer, "const handleSend");
  ok(/mention\.submitMentions\(trimmed\)/.test(send), "发送名单按正文算");
  ok(inOrder(send, ["if (!r.ok)", "throw new Error", 'setBody("")']), "出错时保留草稿（只在成功后清空）");
}

console.log("任务评论框接线");
{
  const drawer = read("src/components/tasks/task-drawer.tsx");
  ok(/import \{ useMentionInput \} from "@\/components\/project-discussion\/use-mention-input"/.test(drawer), "导入共用 hook");
  ok(/import \{ MentionDropdown \} from "@\/components\/project-discussion\/mention-dropdown"/.test(drawer), "原样复用 MentionDropdown");
  ok(/\/api\/tasks\/\$\{taskId\}\/mention-candidates/.test(drawer), "候选来自候选人接口");
  ok(/<MentionDropdown[\s\S]{0,200}members=\{mention\.candidates\}/.test(drawer), "下拉列表用 hook 的候选");
  ok(/onChange=\{mention\.onChange\}/.test(drawer), "输入交给 hook 判断触发");
  const keyDown = fnBlock(drawer, "const handleKeyDown");
  ok(inOrder(keyDown, ["if (mention.onKeyDown(e)) return;", "handleSend()"]), "候选列表打开时，回车选中候选、不发送");
  const send = fnBlock(drawer, "const handleSend");
  ok(/mention\.submitMentions\(text\)/.test(send), "发送名单只含正文里仍出现的人");
  ok(inOrder(send, ["if (!res.ok)", "setCommentError(", "return;", 'setNewComment("")']), "4xx：显示返回的错误、直接返回，草稿只在成功后清空");
  ok(/data\?\.error/.test(send), "显示接口返回的错误信息");
  ok(inOrder(drawer, ["<textarea", "{commentError && ("]), "错误信息显示在评论框下方");
  ok(/prev\.some\(\(c\) => c\.id === comment\.id\)/.test(send), "重发返回同一条评论时不重复显示");
}

console.log(`\ncollab-mention-input: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
