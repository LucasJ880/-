/**
 * 协作通知 COLLAB-2：事件通知
 * - 公共部分（design D1、D2）：收件人过滤、去重键、P2002、门禁、失败隔离——数据库与门禁都从参数注入
 * - 任务三类事件（design D2、D9，spec activity-events）：指派（改派、取消指派、创建时指派）、状态（含批量）、
 *   评论（排除已被 @ 的人）的收件人、标题、摘要与事件区分键；截止日期按组织时区
 * - 工艺单阶段（design D7）：四个阶段的标题、摘要与事件区分键；下一阶段负责角色按品类键或 install.task.assign 取人
 * - 项目文件上传（design D8）：标题、摘要（前 3 个文件名）、事件区分键与收件人
 * 运行：npx tsx src/lib/notifications/__tests__/collab-events.test.ts
 */

import {
  collabSourceKey,
  deliverCollabNotification,
  isUniqueViolation,
  type CollabDeliverDeps,
  type CollabEvent,
  type CollabNotificationRow,
} from "../collab/deliver";
import {
  filterCollabRecipients,
  nextStageRoleKeys,
  normalizeCandidates,
  orderStageRecipients,
  projectFileRecipients,
} from "../collab/recipients";
import {
  formatLocalDate,
  orderStageEvent,
  projectFilesEvent,
  taskAssignedEvents,
  taskCommentEvent,
  taskStatusEvent,
  taskSummary,
  type OrderEventOrder,
  type TaskEventContext,
  type TaskEventTask,
} from "../collab/events";
import { taskCommentMentionEvent } from "../collab/mentions";
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

interface FakeOpts {
  activeUsers?: string[];
  members?: Record<string, string[]>;
  gateOff?: string[];
  existing?: string[];
  p2002For?: string[];
  failCreateFor?: string[];
  failUserLookup?: boolean;
  failGateFor?: string[];
  /** 收件人都开了"只看高优先级" */
  onlyHigh?: boolean;
}

function fakeDeps(opts: FakeOpts = {}) {
  const created: CollabNotificationRow[] = [];
  const errors: string[] = [];
  const memberCalls: string[] = [];
  const existing = new Set(opts.existing ?? []);
  const deps: CollabDeliverDeps = {
    async findActiveUserIds(ids) {
      if (opts.failUserLookup) throw new Error("db down");
      const active = new Set(opts.activeUsers ?? ids);
      return ids.filter((id) => active.has(id));
    },
    async findActiveMemberIds(orgId, ids) {
      memberCalls.push(orgId);
      const members = new Set(opts.members?.[orgId] ?? []);
      return ids.filter((id) => members.has(id));
    },
    async shouldDeliver(userId, args) {
      if (opts.failGateFor?.includes(userId)) throw new Error("gate boom");
      if (opts.onlyHigh && args.priority !== "high") return false;
      return !(opts.gateOff ?? []).includes(userId);
    },
    async findBySourceKey(sourceKey) {
      return existing.has(sourceKey) ? { id: `old:${sourceKey}` } : null;
    },
    async createNotification(row) {
      if (opts.failCreateFor?.includes(row.userId)) throw new Error("insert failed");
      if (opts.p2002For?.includes(row.userId)) {
        existing.add(row.sourceKey);
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      created.push(row);
      return { id: `n${created.length}` };
    },
    logError(message) {
      errors.push(message);
    },
  };
  return { deps, created, errors, memberCalls };
}

function event(over: Partial<CollabEvent> = {}): CollabEvent {
  return {
    type: "task_assigned",
    priority: "high",
    title: "张三 把任务「复尺」指派给你",
    summary: "项目 金山湖 · 截止 2026-11-08",
    entityType: "task",
    entityId: "T1",
    eventKey: "1730800000000",
    orgId: "O1",
    projectId: "P1",
    actorId: "A",
    recipientIds: ["B"],
    metadata: { objectLabel: "复尺", dueAt: "2026-11-08" },
    ...over,
  };
}

async function main() {
  console.log("收件人：去重、排除操作人");
  ok(same(normalizeCandidates(["B", "A", null, "", "B", undefined, "C"], "A"), ["B", "C"]), "去掉空值、操作人与重复，保留先后顺序");
  ok(same(normalizeCandidates(["A"], "A"), []), "只有操作人 → 空");
  ok(same(normalizeCandidates(["B", "C"], null), ["B", "C"]), "没有操作人时只去重");

  console.log("收件人：在职、组织 active 成员");
  {
    const { deps, memberCalls } = fakeDeps({ activeUsers: ["B", "D"], members: { O1: ["B", "C"] } });
    const ids = await filterCollabRecipients(["A", "B", "C", "D", "B"], { orgId: "O1", actorId: "A" }, deps);
    ok(same(ids, ["B"]), "C 已离职、D 不是 O1 的 active 成员 → 只剩 B", ids);
    ok(same(memberCalls, ["O1"]), "按对象所属组织查成员");
  }
  {
    const { deps, memberCalls } = fakeDeps({ activeUsers: ["B", "C"] });
    const ids = await filterCollabRecipients(["B", "C"], { orgId: null, actorId: "A" }, deps);
    ok(same(ids, ["B", "C"]), "对象不属于组织 → 只看在职", ids);
    ok(memberCalls.length === 0, "对象不属于组织 → 不查成员");
  }
  {
    const { deps } = fakeDeps();
    const ids = await filterCollabRecipients(["A"], { orgId: "O1", actorId: "A" }, deps);
    ok(ids.length === 0, "没有候选人 → 空，不查库");
  }

  console.log("去重键");
  ok(collabSourceKey("mention", "M1", "created", "U1") === "mention:M1:created:U1", "<类型>:<对象 id>:<事件区分键>:<收件人 id>");
  ok(isUniqueViolation({ code: "P2002" }), "P2002 → 唯一约束冲突");
  ok(!isUniqueViolation({ code: "P2025" }) && !isUniqueViolation(new Error("x")) && !isUniqueViolation(null), "其他错误不算");

  console.log("写入");
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["A", "B", "C"] } });
    const r = await deliverCollabNotification(event({ recipientIds: ["A", "B", "C", "B"] }), deps);
    ok(same(r.created, ["B", "C"]), "操作人不收、同一人只写一条", r);
    ok(errors.length === 0, "无错误日志");
    const row = created[0];
    ok(
      row.userId === "B" &&
        row.type === "task_assigned" &&
        row.category === "task_assigned" &&
        row.priority === "high" &&
        row.status === "unread" &&
        row.entityType === "task" &&
        row.entityId === "T1" &&
        row.projectId === "P1" &&
        row.orgId === "O1" &&
        row.title === "张三 把任务「复尺」指派给你" &&
        row.summary === "项目 金山湖 · 截止 2026-11-08",
      "通知行的各字段",
      row,
    );
    ok(row.sourceKey === "task_assigned:T1:1730800000000:B", "写入去重键", row.sourceKey);
    ok(row.metadata === JSON.stringify({ objectLabel: "复尺", dueAt: "2026-11-08" }), "metadata 存 JSON 字符串", row.metadata);
  }
  {
    const { deps, created } = fakeDeps({ members: { O1: ["B"] }, existing: ["task_assigned:T1:1730800000000:B"] });
    const r = await deliverCollabNotification(event(), deps);
    ok(created.length === 0 && same(r.existing, ["B"]), "去重键已存在 → 不再写，记为已存在", r);
  }
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, p2002For: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.existing, ["B"]) && same(r.created, ["C"]), "并发写同一去重键（P2002）→ 当作已存在，其他人照写", r);
    ok(errors.length === 0 && created.length === 1, "P2002 不记错误日志");
  }
  {
    const { deps, created } = fakeDeps({ members: { O1: ["B", "C"] }, gateOff: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.gated, ["B"]) && created.every((x) => x.userId !== "B"), "门禁不通过 → 不写", r);
  }

  console.log("失败隔离");
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, failCreateFor: ["B"] });
    let threw = false;
    let r;
    try {
      r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    } catch {
      threw = true;
    }
    ok(!threw, "写入出错 → 不外抛");
    ok(r && same(r.failed, ["B"]) && created.length === 1 && created[0].userId === "C", "一人写入出错，其他人照写", r);
    ok(errors.length === 1, "写入出错 → 记一条错误日志", errors);
  }
  {
    const { deps, created, errors } = fakeDeps({ failUserLookup: true });
    let threw = false;
    try {
      await deliverCollabNotification(event(), deps);
    } catch {
      threw = true;
    }
    ok(!threw && created.length === 0 && errors.length === 1, "查收件人出错 → 不外抛、不写、记日志", errors);
  }
  {
    const { deps, created, errors } = fakeDeps({ members: { O1: ["B", "C"] }, failGateFor: ["B"] });
    const r = await deliverCollabNotification(event({ recipientIds: ["B", "C"] }), deps);
    ok(same(r.failed, ["B"]) && created.length === 1 && errors.length === 1, "门禁判断出错 → 该人跳过并记日志，其他人照写", r);
  }

  // ── 任务三类事件 ──────────────────────────────────────────────
  const UPDATED_AT = new Date(1730800000000);
  // 多伦多 2026-11-05 下午（UTC-5）
  const DUE = new Date("2026-11-05T20:00:00Z");
  const task = (over: Partial<TaskEventTask> = {}): TaskEventTask => ({
    id: "T1",
    title: "复尺",
    status: "todo",
    assigneeId: "C",
    creatorId: "A",
    projectId: "P1",
    dueDate: DUE,
    updatedAt: UPDATED_AT,
    ...over,
  });
  const ctx = (over: Partial<TaskEventContext> = {}): TaskEventContext => ({
    actorId: "A",
    actorName: "张三",
    orgId: "O1",
    projectName: "Smith 住宅",
    ...over,
  });
  const TZ = "America/Toronto";

  console.log("任务摘要与截止日期");
  ok(formatLocalDate(DUE, TZ) === "2026-11-05", "截止日期按组织时区取日期");
  {
    // 多伦多 2026-11-05 22:00 = 上海 2026-11-06 11:00
    const lateEvening = new Date("2026-11-06T03:00:00Z");
    ok(formatLocalDate(lateEvening, TZ) === "2026-11-05", "多伦多晚上 → 当地日期");
    ok(formatLocalDate(lateEvening, "Asia/Shanghai") === "2026-11-06", "组织设了上海时区 → 按上海取日期");
    ok(
      taskSummary({ projectName: null, dueDate: lateEvening, timeZone: "Asia/Shanghai" }) === "截止 2026-11-06",
      "摘要里的截止日期也按组织时区",
    );
  }
  ok(
    taskSummary({ projectName: "Smith 住宅", dueDate: DUE, timeZone: TZ }) === "项目「Smith 住宅」 · 截止 2026-11-05",
    "有项目和截止时间：两段用 ` · ` 连接",
  );
  ok(taskSummary({ projectName: "Smith 住宅", dueDate: null, timeZone: TZ }) === "项目「Smith 住宅」", "只有项目");
  ok(taskSummary({ projectName: null, dueDate: DUE, timeZone: TZ }) === "截止 2026-11-05", "只有截止时间");
  ok(taskSummary({ projectName: null, dueDate: null, timeZone: TZ }) === null, "两段都没有 → 摘要为空");
  ok(
    taskSummary({ projectName: "王总 13812345678", dueDate: null, timeZone: TZ }) === `项目「${REDACTED_TEXT}」`,
    "项目名含电话 → 整段替换",
  );

  console.log("任务指派：改派");
  {
    const evs = taskAssignedEvents({
      kind: "update",
      beforeAssigneeId: "B",
      task: task({ assigneeId: "C" }),
      newAssigneeName: "王五",
      ctx: ctx(),
      timeZone: TZ,
    });
    ok(evs.length === 2, "新负责人与原负责人各一个事件", evs);
    const [toNew, toOld] = evs;
    ok(
      same(toNew.recipientIds, ["C"]) &&
        toNew.type === "task_assigned" &&
        toNew.priority === "high" &&
        toNew.title === "张三 把任务「复尺」指派给你",
      "新负责人：high，「{操作人} 把任务「…」指派给你」",
      toNew,
    );
    ok(
      same(toOld.recipientIds, ["B"]) && toOld.priority === "medium" && toOld.title === "任务「复尺」已改派给 王五",
      "原负责人：medium，「任务「…」已改派给 {新负责人}」",
      toOld,
    );
    ok(evs.every((e) => e.summary === "项目「Smith 住宅」 · 截止 2026-11-05"), "摘要：项目 · 截止日期", evs.map((e) => e.summary));
    ok(evs.every((e) => e.eventKey === "1730800000000"), "事件区分键：本次更新时间的毫秒数");
    ok(
      evs.every(
        (e) =>
          e.entityType === "task" &&
          e.entityId === "T1" &&
          e.orgId === "O1" &&
          e.projectId === "P1" &&
          e.actorId === "A" &&
          !e.sourceKeyPrefix,
      ),
      "对象为该任务，带组织、项目与操作人",
    );
    ok(
      evs.every((e) => same(e.metadata, { objectLabel: "任务「复尺」", dueAt: DUE.toISOString() })),
      "metadata：邮件里的对象名与截止时间",
      evs[0]?.metadata,
    );

    const { deps, created } = fakeDeps({ members: { O1: ["A", "B", "C"] } });
    for (const e of evs) await deliverCollabNotification(e, deps);
    ok(
      same(created.map((r) => r.sourceKey), ["task_assigned:T1:1730800000000:C", "task_assigned:T1:1730800000000:B"]),
      "写入：两人各一条，去重键各带收件人",
      created.map((r) => r.sourceKey),
    );
  }
  {
    const evs = taskAssignedEvents({
      kind: "update",
      beforeAssigneeId: "B",
      task: task({ assigneeId: null }),
      newAssigneeName: null,
      ctx: ctx(),
      timeZone: TZ,
    });
    ok(
      evs.length === 1 && same(evs[0].recipientIds, ["B"]) && evs[0].priority === "medium" && evs[0].title === "任务「复尺」已取消指派",
      "取消指派：只通知原负责人「任务「…」已取消指派」",
      evs,
    );
  }
  {
    const evs = taskAssignedEvents({
      kind: "update",
      beforeAssigneeId: null,
      task: task({ assigneeId: "C" }),
      newAssigneeName: "王五",
      ctx: ctx(),
      timeZone: TZ,
    });
    ok(evs.length === 1 && same(evs[0].recipientIds, ["C"]) && evs[0].priority === "high", "原来没有负责人：只通知新负责人", evs);
  }
  ok(
    taskAssignedEvents({ kind: "update", beforeAssigneeId: "C", task: task({ assigneeId: "C" }), newAssigneeName: "王五", ctx: ctx(), timeZone: TZ }).length === 0,
    "负责人没变（例如只改了标题）→ 不发",
  );
  {
    const evs = taskAssignedEvents({
      kind: "update",
      beforeAssigneeId: "B",
      task: task({ assigneeId: "C", projectId: null, dueDate: null }),
      newAssigneeName: "王五",
      ctx: ctx({ orgId: null, projectName: null }),
      timeZone: TZ,
    });
    ok(evs.length === 2 && evs.every((e) => e.summary === null), "没有项目也没有截止时间 → 指派通知的摘要为空", evs.map((e) => e.summary));
    ok(evs.every((e) => same(e.metadata, { objectLabel: "任务「复尺」" })), "没有截止时间 → metadata 不带 dueAt");
  }
  {
    const evs = taskAssignedEvents({
      kind: "update",
      beforeAssigneeId: "B",
      task: task({ title: "跟进 $12,000 的订单" }),
      newAssigneeName: "王五",
      ctx: ctx(),
      timeZone: TZ,
    });
    ok(evs[0]?.title === `张三 把任务「${REDACTED_TEXT}」指派给你`, "任务标题含金额 → 标题里的任务名整段替换", evs[0]?.title);
    ok(evs[1]?.title === `任务「${REDACTED_TEXT}」已改派给 王五`, "人名是系统生成的部分，不替换", evs[1]?.title);
    ok(same(evs[0]?.metadata, { objectLabel: `任务「${REDACTED_TEXT}」`, dueAt: DUE.toISOString() }), "对象名同样脱敏");
  }

  console.log("任务指派：创建时");
  {
    const evs = taskAssignedEvents({
      kind: "create",
      beforeAssigneeId: null,
      task: task({ creatorId: "A", assigneeId: "B" }),
      newAssigneeName: "李四",
      ctx: ctx(),
      timeZone: TZ,
    });
    ok(
      evs.length === 1 && same(evs[0].recipientIds, ["B"]) && evs[0].priority === "high" && evs[0].eventKey === "created",
      "创建时负责人不是创建人 → 通知负责人，事件区分键为 created",
      evs,
    );
    ok(evs[0]?.title === "张三 把任务「复尺」指派给你", "标题同指派");
  }
  ok(
    taskAssignedEvents({ kind: "create", beforeAssigneeId: null, task: task({ creatorId: "A", assigneeId: "A" }), newAssigneeName: "张三", ctx: ctx(), timeZone: TZ }).length === 0,
    "创建时负责人是创建人自己 → 不发",
  );
  ok(
    taskAssignedEvents({ kind: "create", beforeAssigneeId: null, task: task({ creatorId: "A", assigneeId: null }), newAssigneeName: null, ctx: ctx(), timeZone: TZ }).length === 0,
    "创建时没有负责人 → 不发",
  );

  console.log("任务状态");
  {
    const ev = taskStatusEvent({
      beforeStatus: "todo",
      task: task({ status: "done", creatorId: "A" }),
      ctx: ctx({ actorId: "B", actorName: "李四" }),
      batch: false,
    });
    ok(
      ev !== null &&
        same(ev.recipientIds, ["A"]) &&
        ev.type === "task_status" &&
        ev.priority === "medium" &&
        ev.title === "任务「复尺」：待办 → 已完成" &&
        ev.summary === "李四 修改了状态" &&
        ev.eventKey === "done.1730800000000",
      "负责人完成任务 → 创建人收到「任务「…」：待办 → 已完成」，事件区分键 {新状态}.{毫秒数}",
      ev,
    );
    ok(ev !== null && same(ev.metadata, { objectLabel: "任务「复尺」", dueAt: DUE.toISOString() }), "metadata 同指派");
  }
  ok(
    taskStatusEvent({ beforeStatus: "done", task: task({ status: "done" }), ctx: ctx({ actorId: "B" }), batch: false }) === null,
    "状态没变 → 不发",
  );
  {
    const ev = taskStatusEvent({ beforeStatus: "todo", task: task({ status: "weird_state" }), ctx: ctx({ actorId: "B" }), batch: false });
    ok(ev?.title === "任务「复尺」：待办 → weird_state", "无法识别的状态值原样显示", ev?.title);
  }
  {
    const ev = taskStatusEvent({ beforeStatus: "todo", task: task({ status: "in_progress", creatorId: "A" }), ctx: ctx({ actorId: "A" }), batch: false });
    const { deps, created } = fakeDeps({ members: { O1: ["A"] } });
    if (ev) await deliverCollabNotification(ev, deps);
    ok(ev !== null && created.length === 0, "创建人自己改 → 不写通知");
  }
  console.log("任务状态：批量 A/A/B");
  {
    const tasks = [
      task({ id: "T1", creatorId: "A", status: "done" }),
      task({ id: "T2", creatorId: "A", status: "done" }),
      task({ id: "T3", creatorId: "B", status: "done" }),
    ];
    const evs = tasks
      .map((t) => taskStatusEvent({ beforeStatus: "todo", task: t, ctx: ctx({ actorId: "C", actorName: "王五" }), batch: true }))
      .filter((e) => e !== null);
    ok(evs.length === 3 && evs.every((e) => e.summary === "王五 批量修改了状态"), "批量：摘要「{操作人} 批量修改了状态」");
    const { deps, created } = fakeDeps({ members: { O1: ["A", "B", "C"] } });
    for (const e of evs) await deliverCollabNotification(e, deps);
    ok(
      created.filter((r) => r.userId === "A").length === 2 && created.filter((r) => r.userId === "B").length === 1,
      "A 收到两条、B 收到一条",
      created.map((r) => r.userId),
    );
    ok(
      same(created.map((r) => r.sourceKey), [
        "task_status:T1:done.1730800000000:A",
        "task_status:T2:done.1730800000000:A",
        "task_status:T3:done.1730800000000:B",
      ]),
      "每个任务各一个去重键",
      created.map((r) => r.sourceKey),
    );
  }

  console.log("任务评论");
  const LONG = "一二三四五六七八九十".repeat(12);
  {
    const ev = taskCommentEvent({
      commentId: "CM1",
      content: "  明早复尺，记得带样品  ",
      task: task({ creatorId: "A", assigneeId: "B" }),
      mentionIds: [],
      ctx: ctx({ actorId: "C", actorName: "王五" }),
    });
    ok(
      same(ev.recipientIds, ["B", "A"]) &&
        ev.type === "task_comment" &&
        ev.priority === "medium" &&
        ev.title === "王五 评论了任务「复尺」" &&
        ev.summary === "明早复尺，记得带样品" &&
        ev.eventKey === "CM1",
      "第三人评论 → 负责人与创建人；摘要去首尾空白；事件区分键为评论 id",
      ev,
    );
    ok(same(ev.metadata, { objectLabel: "任务「复尺」", dueAt: DUE.toISOString() }), "metadata 同指派");
    const { deps, created } = fakeDeps({ members: { O1: ["A", "B", "C"] } });
    await deliverCollabNotification(ev, deps);
    ok(same(created.map((r) => r.sourceKey), ["task_comment:T1:CM1:B", "task_comment:T1:CM1:A"]), "A 与 B 各一条", created.map((r) => r.sourceKey));
  }
  {
    const ev = taskCommentEvent({
      commentId: "CM2",
      content: "@李四 明早复尺",
      task: task({ creatorId: "A", assigneeId: "B" }),
      mentionIds: ["B"],
      ctx: ctx({ actorId: "C", actorName: "王五" }),
    });
    ok(same(ev.recipientIds, ["A"]), "评论里 @ 了负责人 → 负责人不收评论通知（他收提及通知），创建人照收", ev.recipientIds);
  }
  {
    const ev = taskCommentEvent({
      commentId: "CM3",
      content: "收到",
      task: task({ creatorId: "A", assigneeId: "A" }),
      mentionIds: [],
      ctx: ctx({ actorId: "C", actorName: "王五" }),
    });
    const { deps, created } = fakeDeps({ members: { O1: ["A", "C"] } });
    await deliverCollabNotification(ev, deps);
    ok(created.length === 1 && created[0].userId === "A", "创建人与负责人是同一人 → 只收一条", created);
  }
  {
    const ev = taskCommentEvent({
      commentId: "CM4",
      content: "好的",
      task: task({ creatorId: "A", assigneeId: "B" }),
      mentionIds: [],
      ctx: ctx({ actorId: "B", actorName: "李四" }),
    });
    const { deps, created } = fakeDeps({ members: { O1: ["A", "B"] } });
    await deliverCollabNotification(ev, deps);
    ok(same(created.map((r) => r.userId), ["A"]), "负责人自己评论 → 不收自己的评论通知", created.map((r) => r.userId));
  }
  {
    const ev = taskCommentEvent({ commentId: "CM5", content: LONG, task: task(), mentionIds: [], ctx: ctx({ actorId: "C" }) });
    ok(ev.summary === LONG.slice(0, 80), "长评论：摘要取前 80 个字符", ev.summary?.length);
    const sensitive = taskCommentEvent({ commentId: "CM6", content: "客户电话 416-555-0199 记得回", task: task(), mentionIds: [], ctx: ctx({ actorId: "C" }) });
    ok(sensitive.summary === REDACTED_TEXT, "评论含电话 → 摘要整段替换", sensitive.summary);
  }

  console.log("门禁：只看高优先级");
  {
    const mentionEv = taskCommentMentionEvent({
      commentId: "CM7",
      taskId: "T1",
      taskTitle: "复尺",
      projectId: "P1",
      orgId: "O1",
      actorId: "C",
      actorName: "王五",
      content: "@李四 看一下",
      mentionIds: ["B"],
      dueAt: DUE,
    });
    const commentEv = taskCommentEvent({
      commentId: "CM8",
      content: "看一下",
      task: task({ creatorId: "A", assigneeId: "B" }),
      mentionIds: [],
      ctx: ctx({ actorId: "C", actorName: "王五" }),
    });
    const { deps, created } = fakeDeps({ members: { O1: ["A", "B", "C"] }, onlyHigh: true });
    await deliverCollabNotification(mentionEv, deps);
    const r = await deliverCollabNotification(commentEv, deps);
    ok(created.length === 1 && created[0].type === "mention" && created[0].userId === "B", "写入 mention（high）", created.map((x) => x.type));
    ok(same(r.gated, ["B", "A"]), "不写 task_comment（medium）", r);
  }

  // ── 工艺单阶段 ────────────────────────────────────────────────
  const order = (over: Partial<OrderEventOrder> = {}): OrderEventOrder => ({
    id: "B1",
    code: "BO-2026-0012",
    status: "confirmed",
    projectId: "P1",
    updatedAt: UPDATED_AT,
    expectedInstallDate: null,
    installDate: null,
    ...over,
  });
  const orderCtx = { actorId: "A", actorName: "张三", orgId: "O1" };

  console.log("工艺单阶段：标题、摘要与事件区分键");
  {
    const stages: Array<[string, string, string]> = [
      ["draft", "confirmed", "已确认"],
      ["confirmed", "in_production", "开始生产"],
      ["in_production", "ready", "备货完成"],
    ];
    for (const [from, to, label] of stages) {
      const ev = orderStageEvent({ beforeStatus: from, order: order({ status: to }), recipientIds: ["C"], ctx: orderCtx, timeZone: TZ });
      ok(
        ev !== null &&
          ev.type === "order_stage" &&
          ev.priority === "medium" &&
          ev.title === `工艺单 BO-2026-0012：${label}` &&
          ev.summary === `张三 推进到「${label}」` &&
          ev.eventKey === `${to}.1730800000000`,
        `${from} → ${to}：「工艺单 {编号}：${label}」`,
        ev,
      );
    }
    const ev = orderStageEvent({ beforeStatus: "draft", order: order(), recipientIds: ["C", "D"], ctx: orderCtx, timeZone: TZ });
    ok(
      ev !== null &&
        ev.entityType === "blinds_order" &&
        ev.entityId === "B1" &&
        ev.orgId === "O1" &&
        ev.projectId === "P1" &&
        ev.actorId === "A" &&
        same(ev.recipientIds, ["C", "D"]) &&
        same(ev.metadata, { objectLabel: "工艺单 BO-2026-0012" }),
      "对象为该工艺单；metadata 带邮件里的对象名",
      ev,
    );
  }
  {
    // 多伦多 2026-11-05 20:00 = UTC 2026-11-06 01:00；工艺单上的 installDate 存的是 UTC 日期
    const ev = orderStageEvent({
      beforeStatus: "ready",
      order: order({ status: "scheduled", expectedInstallDate: new Date("2026-11-06T01:00:00Z"), installDate: "2026-11-06" }),
      recipientIds: ["C"],
      ctx: orderCtx,
      timeZone: TZ,
    });
    ok(
      ev?.title === "工艺单 BO-2026-0012：已排期" && ev.summary === "张三 推进到「已排期」 · 安装日期 2026-11-05",
      "已排期：摘要带安装日期（按组织时区取日期）",
      ev,
    );
    const legacy = orderStageEvent({
      beforeStatus: "ready",
      order: order({ status: "scheduled", installDate: "2026-11-07" }),
      recipientIds: ["C"],
      ctx: orderCtx,
      timeZone: TZ,
    });
    ok(legacy?.summary === "张三 推进到「已排期」 · 安装日期 2026-11-07", "没有预约时间时用工艺单上的安装日期", legacy?.summary);
    const none = orderStageEvent({ beforeStatus: "ready", order: order({ status: "scheduled" }), recipientIds: ["C"], ctx: orderCtx, timeZone: TZ });
    ok(none?.summary === "张三 推进到「已排期」", "没有安装日期 → 不加这一段", none?.summary);
  }
  for (const [from, to] of [["scheduled", "installed"], ["installed", "completed"], ["ready", "cancelled"], ["confirmed", "draft"], ["confirmed", "confirmed"]]) {
    ok(
      orderStageEvent({ beforeStatus: from, order: order({ status: to }), recipientIds: ["C"], ctx: orderCtx, timeZone: TZ }) === null,
      `${from} → ${to}：不发`,
    );
  }

  console.log("工艺单阶段：下一阶段负责角色");
  {
    const holders: Record<string, string[]> = {
      "orders.fulfillment.update.drapery": ["DR"],
      "orders.fulfillment.update.shades": ["SH", "DR"],
      "orders.fulfillment.update.vinyl": ["VI"],
      "orders.fulfillment.update": ["OWNER"],
      "install.task.assign": ["OPS1", "OPS2"],
    };
    const calls: string[] = [];
    const deps = {
      async listUsersWithPermission(orgId: string, key: string) {
        calls.push(`${orgId}:${key}`);
        return holders[key] ?? [];
      },
    };
    ok(
      same(nextStageRoleKeys("confirmed", ["drapery", "shades"]), ["orders.fulfillment.update.drapery", "orders.fulfillment.update.shades"]),
      "已确认：取该单各品类的履约推进键",
    );
    ok(same(nextStageRoleKeys("in_production", ["vinyl"]), ["orders.fulfillment.update.vinyl"]), "开始生产：同样按品类键");
    ok(same(nextStageRoleKeys("ready", ["vinyl"]), ["install.task.assign"]) && same(nextStageRoleKeys("scheduled", []), ["install.task.assign"]), "备货完成 / 已排期：install.task.assign");
    ok(nextStageRoleKeys("installed", ["vinyl"]).length === 0, "其他状态：没有负责角色");

    const mixed = await orderStageRecipients(
      { toStatus: "confirmed", creatorId: "CR", opportunityOwnerId: "OPP", orgId: "O1", categories: ["drapery", "shades"] },
      deps,
    );
    ok(same(mixed, ["CR", "OPP", "DR", "SH"]), "窗帘与卷帘混合单被确认 → 创建人、商机负责人、两位品类负责人（去重）", mixed);
    ok(!mixed.includes("OWNER") && !calls.some((c) => c.endsWith(":orders.fulfillment.update")), "只持全品类键的人不因这条规则收到（也不查全品类键）", calls);

    calls.length = 0;
    const ready = await orderStageRecipients(
      { toStatus: "ready", creatorId: "CR", opportunityOwnerId: null, orgId: "O1", categories: ["vinyl"] },
      deps,
    );
    ok(same(ready, ["CR", "OPS1", "OPS2"]), "备货完成：持 install.task.assign 的人；没有商机时不含商机负责人", ready);
    ok(same(calls, ["O1:install.task.assign"]), "按工艺单所属组织取人");

    calls.length = 0;
    const noOrg = await orderStageRecipients(
      { toStatus: "confirmed", creatorId: "CR", opportunityOwnerId: "OPP", orgId: null, categories: ["vinyl"] },
      deps,
    );
    ok(same(noOrg, ["CR", "OPP"]) && calls.length === 0, "工艺单没有所属组织 → 只通知创建人与商机负责人", noOrg);

    const none = await orderStageRecipients(
      { toStatus: "confirmed", creatorId: "CR", opportunityOwnerId: null, orgId: "O1", categories: [] },
      deps,
    );
    ok(same(none, ["CR"]), "没有可判定的品类 → 不加品类负责人", none);

    // 排期负责人 OPS1 自己把单转为已排期：其他持排期权限的人、创建人、商机负责人各一条，操作人不收
    const recipients = await orderStageRecipients(
      { toStatus: "scheduled", creatorId: "CR", opportunityOwnerId: "OPP", orgId: "O1", categories: ["vinyl"] },
      deps,
    );
    const ev = orderStageEvent({
      beforeStatus: "ready",
      order: order({ status: "scheduled", installDate: "2026-11-07" }),
      recipientIds: recipients,
      ctx: { actorId: "OPS1", actorName: "运营一", orgId: "O1" },
      timeZone: TZ,
    });
    const fake = fakeDeps({ members: { O1: ["CR", "OPP", "OPS1", "OPS2"] } });
    if (ev) await deliverCollabNotification(ev, fake.deps);
    ok(same(fake.created.map((r) => r.userId), ["CR", "OPP", "OPS2"]), "备货完成转已排期：操作人不收", fake.created.map((r) => r.userId));
    ok(fake.created.every((r) => r.sourceKey.startsWith("order_stage:B1:scheduled.1730800000000:")), "去重键 order_stage:<单 id>:<新状态>.<毫秒数>:<收件人>");
  }

  console.log("项目文件上传");
  {
    const ev = projectFilesEvent({
      projectId: "P1",
      projectName: "Smith 住宅",
      orgId: "O1",
      actorId: "A",
      actorName: "张三",
      documents: [
        { id: "D1", title: "复尺.pdf" },
        { id: "D2", title: "效果图.png" },
      ],
      recipientIds: ["B", "A"],
    });
    ok(
      ev !== null &&
        ev.type === "project_update" &&
        ev.priority === "medium" &&
        ev.title === "张三 在项目「Smith 住宅」上传了 2 个文件" &&
        ev.summary === "复尺.pdf、效果图.png" &&
        ev.entityType === "project_files" &&
        ev.entityId === "P1" &&
        ev.projectId === "P1" &&
        ev.orgId === "O1" &&
        ev.eventKey === "upload.D1" &&
        same(ev.metadata, { objectLabel: "项目「Smith 住宅」文件" }),
      "上传两个文件：标题、摘要、对象与事件区分键 upload.{第一个文档 id}",
      ev,
    );
    const fake = fakeDeps({ members: { O1: ["A", "B"] } });
    if (ev) await deliverCollabNotification(ev, fake.deps);
    ok(same(fake.created.map((r) => r.userId), ["B"]), "上传人不收", fake.created.map((r) => r.userId));
  }
  {
    const ev = projectFilesEvent({
      projectId: "P1",
      projectName: "Smith 住宅",
      orgId: "O1",
      actorId: "A",
      actorName: "张三",
      documents: [
        { id: "D1", title: "一.pdf" },
        { id: "D2", title: "王总 13812345678.pdf" },
        { id: "D3", title: "三.pdf" },
        { id: "D4", title: "四.pdf" },
      ],
      recipientIds: ["B"],
    });
    ok(ev?.title === "张三 在项目「Smith 住宅」上传了 4 个文件", "N 为本次上传的文件数", ev?.title);
    ok(ev?.summary === `一.pdf、${REDACTED_TEXT}、三.pdf 等`, "摘要取前 3 个文件名，超过 3 个加「 等」；含敏感内容的文件名整段替换", ev?.summary);
  }
  {
    const ev = projectFilesEvent({
      projectId: "P1",
      projectName: "报价 $12,000",
      orgId: null,
      actorId: "A",
      actorName: "张三",
      documents: [{ id: "D9", title: "a.pdf" }],
      recipientIds: ["B"],
    });
    ok(ev?.title === `张三 在项目「${REDACTED_TEXT}」上传了 1 个文件`, "项目名含金额 → 整段替换", ev?.title);
  }
  ok(
    projectFilesEvent({ projectId: "P1", projectName: "X", orgId: null, actorId: "A", actorName: "张三", documents: [], recipientIds: ["B"] }) === null,
    "没有上传成功的文件 → 不发",
  );
  {
    const deps = { async findActiveProjectMemberIds() { return ["A", "B", "C"]; } };
    ok(same(await projectFileRecipients({ projectId: "P1", ownerId: "O" }, deps), ["A", "B", "C", "O"]), "收件人：active 项目成员与项目负责人");
    ok(same(await projectFileRecipients({ projectId: "P1", ownerId: "B" }, deps), ["A", "B", "C"]), "负责人也是成员 → 只算一次");
  }

  console.log(`\ncollab-events: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
