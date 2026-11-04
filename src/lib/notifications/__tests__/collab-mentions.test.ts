/**
 * 协作通知 COLLAB-2：@ 提及（design D3、D4，spec notifications/mentions）
 * - 名单格式、三个接收条件与 @ 自己、invalidUserIds 不含姓名
 * - 重发判定：讨论区只有带 @ 才判、名单要相同；任务评论不论带不带 @；10 分钟边界；比较前去掉首尾空白
 * - 标题与 80 字摘要，含脱敏；通知事件的字段与去重键
 * 运行：npx tsx src/lib/notifications/__tests__/collab-mentions.test.ts
 */

import type { AuthUser } from "@/lib/auth";
import { eventSourceKey } from "../collab/deliver";
import {
  MENTION_MAX,
  buildMentionMetadata,
  checkMentionRecipients,
  discussionMentionEvent,
  discussionMentionTitle,
  findCommentReplay,
  findDiscussionReplay,
  mentionIdsOf,
  mentionSummary,
  parseMentionList,
  sameMentionList,
  taskCommentMentionEvent,
  taskMentionTitle,
  type MentionCheckDeps,
} from "../collab/mentions";
import { REDACTED_TEXT } from "../collab/redact";

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

function user(id: string, name: string, status = "active"): AuthUser {
  return { id, email: `${id}@x.test`, name, nickname: null, avatar: null, role: "user", status, canEditCustomers: true };
}

function fakeDeps(opts: { users: AuthUser[]; members?: string[]; viewers?: string[] }) {
  const viewCalls: string[] = [];
  const memberCalls: string[] = [];
  const deps: MentionCheckDeps = {
    async loadUsers(ids) {
      return opts.users.filter((u) => ids.includes(u.id));
    },
    async findActiveMemberIds(orgId, ids) {
      memberCalls.push(orgId);
      return ids.filter((id) => (opts.members ?? []).includes(id));
    },
    async canView(u) {
      viewCalls.push(u.id);
      return (opts.viewers ?? []).includes(u.id);
    },
  };
  return { deps, viewCalls, memberCalls };
}

async function main() {
  console.log("名单格式");
  ok(same(parseMentionList(undefined), { ok: true, mentions: [] }), "不带 mentions → 空名单");
  ok(same(parseMentionList(null), { ok: true, mentions: [] }), "mentions 为 null → 空名单");
  ok(same(parseMentionList([]), { ok: true, mentions: [] }), "空数组 → 空名单");
  for (const [label, raw] of [
    ["不是数组（字符串）", "A"],
    ["不是数组（对象）", { userId: "A" }],
    ["某一项缺 userId", [{ name: "张三" }]],
    ["userId 不是字符串", [{ userId: 1 }]],
    ["userId 为空串", [{ userId: "" }]],
    ["某一项不是对象", ["A"]],
  ] as const) {
    const r = parseMentionList(raw);
    ok(!r.ok, `${label} → MENTION_INVALID`, r);
  }
  ok(MENTION_MAX === 20, "一次最多 @ 20 人");
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `U${i}` }));
  ok(parseMentionList(ids(20)).ok, "20 人 → 通过");
  ok(!parseMentionList(ids(21)).ok, "21 人 → MENTION_INVALID");
  ok(parseMentionList([...ids(20), { userId: "U0" }]).ok, "去重后 20 人 → 通过");
  const dup = parseMentionList([{ userId: "A" }, { userId: "A", name: "张三" }]);
  ok(dup.ok && dup.mentions.length === 1 && dup.mentions[0].userId === "A", "按 userId 去重", dup);
  const extra = parseMentionList([{ userId: "A", name: "张三", role: "x" }]);
  ok(extra.ok && same(extra.mentions, [{ userId: "A", name: "张三" }]), "不保存多余字段", extra);
  const badName = parseMentionList([{ userId: "A", name: 123 }]);
  ok(badName.ok && badName.mentions[0].name === null, "name 不是字符串 → 当作没带", badName);

  console.log("保存的提及名单");
  const accountNames = new Map([["A", "张三（账号）"], ["B", "李四"]]);
  ok(same(buildMentionMetadata([{ userId: "A", name: "张三" }], accountNames), [{ userId: "A", name: "张三" }]), "带了 name → 用它");
  ok(same(buildMentionMetadata([{ userId: "A", name: null }], accountNames), [{ userId: "A", name: "张三（账号）" }]), "没带 name → 用账号姓名");
  ok(same(buildMentionMetadata([{ userId: "B", name: "  " }], accountNames), [{ userId: "B", name: "李四" }]), "name 只有空白 → 用账号姓名");
  const long = "名".repeat(60);
  ok(buildMentionMetadata([{ userId: "A", name: long }], accountNames)[0].name.length === 50, "name 截到 50 个字符");
  ok(same(mentionIdsOf({ mentions: [{ userId: "A", name: "x" }, { userId: "B" }, { name: "y" }] }), ["A", "B"]), "从消息 metadata 读出 @ 名单");
  ok(same(mentionIdsOf(null), []) && same(mentionIdsOf({ type: "task_created" }), []), "没有名单 → 空");

  console.log("三个接收条件");
  {
    const users = [user("S", "发送人"), user("A", "张三"), user("B", "李四", "disabled"), user("C", "王五"), user("D", "赵六")];
    const { deps, viewCalls } = fakeDeps({ users, members: ["S", "A", "B", "D"], viewers: ["A", "B", "C"] });
    const r = await checkMentionRecipients(["A", "B", "C", "D", "E", "S"], { actorId: "S", orgId: "O1" }, deps);
    ok(!r.ok && same(r.invalidUserIds, ["B", "C", "D", "E"]), "停用 B、非组织成员 C、看不到的 D、不存在的 E → 不满足", r);
    ok(!JSON.stringify(r).includes("李四") && !JSON.stringify(r).includes("王五") && !JSON.stringify(r).includes("@x.test"), "结果不含姓名与邮箱");
    ok(!viewCalls.includes("S"), "@ 自己不做查看判断");
  }
  {
    const users = [user("S", "发送人"), user("A", "张三")];
    const { deps } = fakeDeps({ users, members: ["S", "A"], viewers: ["A"] });
    const r = await checkMentionRecipients(["A", "S"], { actorId: "S", orgId: "O1" }, deps);
    ok(r.ok && r.names.get("A") === "张三" && r.names.get("S") === "发送人", "都满足 → 通过，并给出账号姓名", r.ok ? [...r.names] : r);
  }
  {
    const users = [user("S", "发送人"), user("C", "王五")];
    const { deps, memberCalls } = fakeDeps({ users, members: [], viewers: ["C"] });
    const r = await checkMentionRecipients(["C"], { actorId: "S", orgId: null }, deps);
    ok(r.ok && memberCalls.length === 0, "对象不属于组织 → 不查组织成员", r);
  }
  {
    const users = [user("S", "发送人")];
    const { deps } = fakeDeps({ users, members: [], viewers: [] });
    const r = await checkMentionRecipients(["S"], { actorId: "S", orgId: "O1" }, deps);
    ok(r.ok, "只 @ 自己 → 视为满足", r);
  }

  console.log("重发判定");
  const now = new Date("2026-11-04T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  ok(sameMentionList(["B", "A", "A"], ["A", "B"]) && !sameMentionList(["A"], ["A", "B"]), "@ 名单去重后排序比较");
  const rows = [
    { id: "m1", body: "明早复尺 @张三", createdAt: ago(5 * MIN), mentionIds: ["A", "B"] },
    { id: "m2", body: "明早复尺 @张三", createdAt: ago(2 * MIN), mentionIds: ["A", "B"] },
  ];
  ok(findDiscussionReplay(rows, { body: "  明早复尺 @张三 ", mentionIds: ["B", "A"] }, now)?.id === "m1", "讨论区：正文（去首尾空白）与名单相同 → 返回最早那条");
  ok(findDiscussionReplay(rows, { body: "明早复尺 @张三", mentionIds: ["A"] }, now) === null, "讨论区：名单不同 → 不算重发");
  ok(findDiscussionReplay(rows, { body: "明早复尺 @张三", mentionIds: [] }, now) === null, "讨论区：不带 @ → 不判");
  ok(findDiscussionReplay([{ id: "x", body: "收到", createdAt: ago(MIN), mentionIds: [] }], { body: "收到", mentionIds: [] }, now) === null, "讨论区：两次「收到」都不带 @ → 都创建");
  ok(findDiscussionReplay([{ ...rows[0], createdAt: ago(10 * MIN) }], { body: "明早复尺 @张三", mentionIds: ["A", "B"] }, now)?.id === "m1", "正好 10 分钟 → 仍算重发");
  ok(findDiscussionReplay([{ ...rows[0], createdAt: ago(10 * MIN + 1) }], { body: "明早复尺 @张三", mentionIds: ["A", "B"] }, now) === null, "超过 10 分钟 → 新建");
  ok(findDiscussionReplay([{ ...rows[0], body: "明早复尺" }], { body: "明早复尺 @张三", mentionIds: ["A", "B"] }, now) === null, "正文不同 → 不算重发");
  const comments = [{ id: "c1", content: "@张三 明早复尺", createdAt: ago(3 * MIN) }];
  ok(findCommentReplay(comments, { content: " @张三 明早复尺  " }, now)?.id === "c1", "任务评论：正文相同（去首尾空白）→ 重发");
  ok(findCommentReplay([{ id: "c2", content: "好的", createdAt: ago(MIN) }], { content: "好的" }, now)?.id === "c2", "任务评论：不带 @ 也算重发");
  ok(findCommentReplay([{ ...comments[0], createdAt: ago(11 * MIN) }], { content: "@张三 明早复尺" }, now) === null, "任务评论：11 分钟后 → 新建");

  console.log("标题与摘要");
  ok(discussionMentionTitle("张三", "Smith 住宅") === "张三 在项目「Smith 住宅」讨论区 @ 了你", "讨论区标题");
  ok(taskMentionTitle("李四", "复尺安排") === "李四 在任务「复尺安排」的评论里 @ 了你", "任务评论标题");
  ok(discussionMentionTitle("张三", "88 Yonge Street 改造") === `张三 在项目「${REDACTED_TEXT}」讨论区 @ 了你`, "项目名含地址 → 项目名整段替换，人名不替换");
  ok(taskMentionTitle("李四", "跟进 $12,000 的订单") === `李四 在任务「${REDACTED_TEXT}」的评论里 @ 了你`, "任务标题含金额 → 整段替换");
  const body120 = "复".repeat(120);
  ok(mentionSummary(`  ${body120}  `) === "复".repeat(80), "长正文 → 去首尾空白后的前 80 个字符");
  ok(mentionSummary("@张三 客户电话 416-555-0199 记得回") === REDACTED_TEXT, "正文含电话 → 整段替换");
  ok(mentionSummary(`${"复".repeat(100)} 416-555-0199`) === REDACTED_TEXT, "敏感内容在 80 字之后 → 仍整段替换");
  ok(mentionSummary("@张三 明早复尺") === "@张三 明早复尺", "不含敏感内容 → 原样");

  console.log("通知事件");
  const ev = discussionMentionEvent({
    messageId: "M1",
    projectId: "P1",
    projectName: "Smith 住宅",
    orgId: "O1",
    actorId: "S",
    actorName: "张三",
    body: "@李四 明早复尺",
    mentionIds: ["A", "S"],
  });
  ok(
    ev.type === "mention" && ev.priority === "high" && ev.entityType === "project_discussion" && ev.entityId === "M1" && ev.projectId === "P1" && ev.orgId === "O1" && ev.actorId === "S",
    "讨论区：mention / high / project_discussion / 消息 id",
    ev,
  );
  ok(same(ev.recipientIds, ["A", "S"]), "收件人为 @ 名单（操作人由投递入口排除）");
  ok(eventSourceKey(ev, "A") === "mention:M1:A", "去重键 mention:<消息 id>:<被 @ 人 id>", eventSourceKey(ev, "A"));
  ok(ev.title === "张三 在项目「Smith 住宅」讨论区 @ 了你" && ev.summary === "@李四 明早复尺", "标题与摘要");
  ok((ev.metadata as { objectLabel?: string }).objectLabel === "项目「Smith 住宅」讨论区", "metadata.objectLabel");
  const tev = taskCommentMentionEvent({
    commentId: "C1",
    taskId: "T1",
    taskTitle: "复尺安排",
    projectId: null,
    orgId: null,
    actorId: "S",
    actorName: "李四",
    content: "@张三 明早复尺",
    mentionIds: ["A"],
    dueAt: new Date("2026-11-05T15:00:00Z"),
  });
  ok(tev.entityType === "task" && tev.entityId === "T1" && tev.projectId === null && eventSourceKey(tev, "A") === "mention:C1:A", "任务评论：entityType task、去重键用评论 id", tev);
  ok(
    (tev.metadata as { objectLabel?: string; dueAt?: string }).objectLabel === "任务「复尺安排」" &&
      (tev.metadata as { dueAt?: string }).dueAt === "2026-11-05T15:00:00.000Z",
    "任务评论：objectLabel 与 dueAt",
    tev.metadata,
  );

  console.log(`\ncollab-mentions: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
