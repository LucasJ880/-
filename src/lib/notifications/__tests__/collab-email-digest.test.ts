/**
 * 协作通知 COLLAB-2：每日未读汇总邮件（design D15、D16，spec notifications/email-reminders）
 * - 收件人：到点组织里账号在职的 active 成员，跨组织去重；没有未读不发；两类简报不计入；不受免打扰影响；
 *   邮件偏好关、地址不可投递的不发；名下全部未读都列，不论通知属于哪个组织
 * - 内容：主题计数；按类型分组（固定六组在前，其他按类型名）、组内从新到旧；最多 50 条与"另有 M 条"；
 *   事项行、绝对链接、截止按组织时区；其他功能写的通知标题也脱敏
 * - 每人每天一封：同一本地日期已有审计记录时不发；同一轮两个组织、两轮同时触发都只发一封；发送失败当天不补发
 * - 审计记录的内容（本地日期、条数、是否只记日志），且不带组织 id；单轮 300 封与截止时刻；只记日志与缺发信配置
 * 时间（模拟组织当地 7 点）、成员、偏好、通知、审计与发送函数全部从参数注入，无 DB。
 * 运行：npx tsx src/lib/notifications/__tests__/collab-email-digest.test.ts
 */

import { EMAIL_FOOTER, type MailConfig, type OutgoingMail } from "../collab/email";
import {
  DIGEST_AUDIT_ACTION,
  DIGEST_DEADLINE_MS,
  DIGEST_EXCLUDED_TYPES,
  DIGEST_FETCH_LIMIT,
  DIGEST_MAX_EMAILS,
  DIGEST_MAX_LINES,
  countsTowardDigest,
  digestExistingWhere,
  digestGroups,
  digestLockKey,
  digestMail,
  digestOutcome,
  runEmailDigest,
  type DigestAudit,
  type DigestDeps,
  type DigestItem,
  type DigestMember,
  type DigestNotificationRow,
  type DigestOrg,
  type DigestResult,
} from "../collab/digest";
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
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 2026-11-05 07:00 多伦多（EST，UTC−5） */
const NOW = new Date("2026-11-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ORIGIN = "https://qingyan.ca";
const REAL: MailConfig = { realSend: true, origin: ORIGIN, missingEnv: [] };
const DRY: MailConfig = { realSend: false, origin: ORIGIN, missingEnv: [] };
const FAR = new Date("2030-01-01T00:00:00.000Z");
const CHOSE = JSON.stringify({ emailChoiceAt: "2026-11-01T00:00:00.000Z" });
const TORONTO: DigestOrg[] = [
  { id: "org-1", timezone: "America/Toronto" },
  { id: "org-2", timezone: "America/Toronto" },
];

// ── 假依赖 ────────────────────────────────────────────────────

type StoredNotification = DigestNotificationRow & { status: string };
interface Pref {
  emailEnabled: boolean;
  metadata: string | null;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

interface World {
  members: DigestMember[];
  prefs: Map<string, Pref>;
  notifications: StoredNotification[];
  timezones: Map<string, string>;
  taskDue: Map<string, Date | null>;
  audits: Array<{ userId: string; day: string; audit: DigestAudit }>;
  sent: OutgoingMail[];
  logs: string[];
  errors: string[];
  clock: number;
  sendDelayMs: number;
  failSend: (mail: OutgoingMail) => string | null;
  countCalls: Array<{ userIds: string[]; excluded: readonly string[] }>;
  listCalls: Array<{ userId: string; excluded: readonly string[]; take: number }>;
  failMembers: boolean;
}

function world(now: Date = NOW): World {
  return {
    members: [],
    prefs: new Map(),
    notifications: [],
    timezones: new Map([
      ["org-1", "America/Toronto"],
      ["org-2", "America/Toronto"],
      ["org-3", "America/Toronto"],
      ["org-sh", "Asia/Shanghai"],
    ]),
    taskDue: new Map(),
    audits: [],
    sent: [],
    logs: [],
    errors: [],
    clock: now.getTime(),
    sendDelayMs: 0,
    failSend: () => null,
    countCalls: [],
    listCalls: [],
    failMembers: false,
  };
}

const counted = (w: World, userId: string, excluded: readonly string[]) =>
  w.notifications.filter((n) => n.userId === userId && n.status === "unread" && !excluded.includes(n.type));

function deps(w: World): DigestDeps {
  return {
    now: () => new Date(w.clock),
    async loadMembers(orgIds) {
      if (w.failMembers) throw new Error("db down");
      return w.members.filter((m) => orgIds.includes(m.orgId)).map((m) => ({ ...m }));
    },
    async loadPreferences(userIds) {
      return userIds.flatMap((id) => (w.prefs.has(id) ? [{ userId: id, ...w.prefs.get(id)! }] : []));
    },
    async countUnread(userIds, excluded) {
      w.countCalls.push({ userIds: [...userIds], excluded });
      return new Map(userIds.map((id) => [id, counted(w, id, excluded).length]));
    },
    async listUnread(userId, excluded, take) {
      w.listCalls.push({ userId, excluded, take });
      return counted(w, userId, excluded)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take)
        .map((n) => {
          const { status: _status, ...row } = n;
          void _status;
          return row;
        });
    },
    async loadOrgTimezones(orgIds) {
      return new Map(orgIds.flatMap((id) => (w.timezones.has(id) ? [[id, w.timezones.get(id)!] as [string, string]] : [])));
    },
    async loadTaskDueDates(taskIds) {
      return new Map(taskIds.flatMap((id) => (w.taskDue.has(id) ? [[id, w.taskDue.get(id)!] as [string, Date | null]] : [])));
    },
    async claimDigest({ userId, day, audit }) {
      if (w.audits.some((a) => a.userId === userId && a.day === day)) return false;
      w.audits.push({ userId, day, audit });
      return true;
    },
    async send(mail) {
      w.sent.push(mail);
      w.clock += w.sendDelayMs;
      const error = w.failSend(mail);
      return error ? { ok: false, error } : { ok: true };
    },
    log: (message) => {
      w.logs.push(message);
    },
    logError: (message) => {
      w.errors.push(message);
    },
  };
}

function member(w: World, userId: string, orgId = "org-1", over: Partial<DigestMember> = {}) {
  w.members.push({ orgId, userId, email: `${userId}@acme.ca`, memberStatus: "active", userStatus: "active", ...over });
}
let seq = 0;
function note(w: World, userId: string, over: Partial<StoredNotification> = {}): StoredNotification {
  const n: StoredNotification = {
    id: over.id ?? `n${++seq}`,
    userId,
    orgId: "org-1",
    projectId: "proj-1",
    type: "mention",
    status: "unread",
    title: "张三 在项目「Smith 住宅」讨论区 @ 了你",
    summary: null,
    entityType: "project_discussion",
    entityId: "msg-1",
    activityId: null,
    metadata: JSON.stringify({ objectLabel: "项目「Smith 住宅」讨论区" }),
    createdAt: ago(2 * HOUR),
    ...over,
  };
  w.notifications.push(n);
  return n;
}
const run = (w: World, orgs: DigestOrg[] = TORONTO, config: MailConfig = REAL, deadline: Date = FAR): Promise<DigestResult> =>
  runEmailDigest({ orgs, deadline, config }, deps(w));
const mailTo = (w: World, userId: string) => w.sent.filter((m) => m.userId === userId);
const itemLines = (text: string) => text.split("\n").filter((l) => l.includes("｜https://"));
const pref = (p: Partial<Pref> = {}): Pref => ({
  emailEnabled: false,
  metadata: null,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  ...p,
});

async function main() {
  console.log("常量与审计键");
  ok(DIGEST_MAX_EMAILS === 300, "单轮最多 300 封");
  ok(DIGEST_MAX_LINES === 50, "每封最多列 50 条");
  ok(DIGEST_DEADLINE_MS === 285_000, "截止时刻为路由开始后 285 秒");
  ok(DIGEST_FETCH_LIMIT >= DIGEST_MAX_LINES, "每人取的未读条数不少于可列条数");
  ok(DIGEST_AUDIT_ACTION === "notifications.email_digest", "审计动作 notifications.email_digest");
  ok(eq([...DIGEST_EXCLUDED_TYPES].sort(), ["daily_briefing", "sales_daily_briefing"]), "不计入汇总的类型：两类简报");
  ok(!countsTowardDigest("daily_briefing") && !countsTowardDigest("sales_daily_briefing"), "两类简报不计入");
  ok(countsTowardDigest("mention") && countsTowardDigest("quote_signed") && countsTowardDigest("whatever_new"), "其他类型都计入");
  ok(digestLockKey("u-a", "2026-11-05") === "notify-email-digest:u-a:2026-11-05", "按收件人与本地日期串行化的锁键");
  const where = digestExistingWhere("u-a", "2026-11-05") as Record<string, unknown>;
  ok(
    eq(where, { action: "notifications.email_digest", targetType: "user", targetId: "u-a", afterData: { contains: '"day":"2026-11-05"' } }),
    "当天是否已发：按动作、对象（收件人）与本地日期查，走 [targetType, targetId] 索引",
    where,
  );
  ok(!("orgId" in where), "查询不带组织 id");

  console.log("分组与排序（纯函数）");
  {
    const item = (type: string, typeLabel: string, minutesAgo: number): DigestItem => ({
      type,
      typeLabel,
      object: `${type}-${minutesAgo}`,
      dueDate: null,
      link: `${ORIGIN}/notifications`,
      createdAt: ago(minutesAgo * MIN),
    });
    const groups = digestGroups([
      item("followup", "跟进提醒", 1),
      item("order_stage", "工艺单阶段变化", 2),
      item("mention", "@提及", 30),
      item("quote_signed", "客户签署报价", 3),
      item("task_status", "任务状态变化", 4),
      item("whatever_new", "其他通知", 5),
      item("task_comment", "任务新评论", 6),
      item("mention", "@提及", 10),
      item("task_due", "任务截止与逾期", 7),
      item("task_assigned", "任务指派", 8),
      item("calendar_event", "日程与日历提醒", 9),
    ]);
    ok(
      eq(groups.map((g) => g.label), ["@提及", "任务指派", "任务截止与逾期", "任务新评论", "任务状态变化", "工艺单阶段变化", "跟进提醒", "客户签署报价", "其他通知", "日程与日历提醒"]),
      "固定六组在前，其他按类型名排在后面",
      groups.map((g) => g.label),
    );
    ok(eq(groups[0].items.map((i) => i.object), ["mention-10", "mention-30"]), "组内按创建时间从新到旧", groups[0].items.map((i) => i.object));
  }

  console.log("主题与正文（纯函数）");
  {
    const items: DigestItem[] = [];
    for (let i = 0; i < 33; i++) items.push({ type: "mention", typeLabel: "@提及", object: `讨论 ${i}`, dueDate: null, link: `${ORIGIN}/projects/p?tab=workbench#project-discussion`, createdAt: ago((i + 1) * MIN) });
    for (let i = 0; i < 60; i++) items.push({ type: "task_status", typeLabel: "任务状态变化", object: `状态 ${i}`, dueDate: null, link: `${ORIGIN}/tasks?open=t${i}`, createdAt: ago((i + 1) * HOUR) });
    const mail = digestMail({ total: 93, items, origin: ORIGIN });
    ok(mail.subject === "【青砚】今日未读 93 条", "主题里的计数是全部计入汇总的未读", mail.subject);
    const lines = itemLines(mail.text);
    ok(lines.length === 50 && mail.listed === 50, "最多列 50 条", lines.length);
    ok(mail.text.includes("另有 43 条未读，请在青砚查看：https://qingyan.ca/notifications"), "超出时末尾一行：另有 M 条，带通知页链接");
    const paras = mail.text.split("\n\n");
    ok(paras[0].startsWith("【@提及】\n") && paras[0].split("\n").length === 34, "@提及一组 33 条全列", paras[0].split("\n").length);
    ok(paras[1].startsWith("【任务状态变化】\n") && paras[1].split("\n").length === 18, "任务状态变化一组只列最新的 17 条", paras[1].split("\n").length);
    ok(paras[1].includes("状态 0｜") && paras[1].includes("状态 16｜") && !paras[1].includes("状态 17｜"), "被截掉的是该组里较旧的", paras[1].slice(0, 80));
    ok(paras[paras.length - 1] === EMAIL_FOOTER, "页脚在最后");
    ok(mail.html.startsWith("<!doctype html>") && lines.every((l) => mail.html.includes(l)) && mail.html.includes("【@提及】"), "HTML 版本内容与纯文本相同");
    const small = digestMail({ total: 2, items: items.slice(0, 2), origin: ORIGIN });
    ok(small.subject === "【青砚】今日未读 2 条" && !small.text.includes("另有"), "不超过 50 条：没有\"另有\"那一行");
  }

  console.log("收件人");
  {
    const w = world();
    member(w, "u-a", "org-1");
    member(w, "u-a", "org-2");
    member(w, "u-b", "org-1");
    member(w, "u-c", "org-2");
    member(w, "u-gone", "org-1", { userStatus: "disabled" });
    member(w, "u-left", "org-1", { memberStatus: "removed" });
    member(w, "u-off", "org-1");
    member(w, "u-wx", "org-1", { email: "wx_abc@wechat.user" });
    member(w, "u-quiet", "org-1");
    member(w, "u-brief", "org-1");
    member(w, "u-far", "org-9");
    w.prefs.set("u-off", pref({ emailEnabled: false, metadata: CHOSE }));
    w.prefs.set("u-quiet", pref({ emailEnabled: true, metadata: CHOSE, quietHoursEnabled: true, quietHoursStart: "06:00", quietHoursEnd: "09:00" }));
    w.prefs.set("u-b", pref({ emailEnabled: false }));
    note(w, "u-a", { type: "mention", createdAt: ago(1 * HOUR) });
    note(w, "u-a", { type: "task_assigned", title: "李四 把任务「复尺安排」指派给你", entityType: "task", entityId: "task-1", metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", dueAt: "2026-11-06T15:00:00.000Z" }), createdAt: ago(3 * HOUR) });
    note(w, "u-a", { type: "order_stage", title: "工艺单 SS-1042：开始生产", entityType: "blinds_order", entityId: "ord-1", metadata: JSON.stringify({ objectLabel: "工艺单 SS-1042" }), createdAt: ago(5 * HOUR) });
    note(w, "u-a", { type: "mention", status: "read" });
    note(w, "u-a", { type: "daily_briefing", title: "今日简报", entityType: null, entityId: null, metadata: null });
    note(w, "u-b", { status: "read" });
    note(w, "u-c", { orgId: "org-3", type: "task_comment", title: "王五 评论了任务「量尺」", entityType: "task", entityId: "task-3", metadata: JSON.stringify({ objectLabel: "任务「量尺」" }) });
    for (const id of ["u-gone", "u-left", "u-off", "u-wx", "u-quiet", "u-far"]) note(w, id);
    note(w, "u-brief", { type: "daily_briefing", metadata: null });
    note(w, "u-brief", { type: "sales_daily_briefing", metadata: null });
    note(w, "u-a", { type: "mention", metadata: JSON.stringify({ objectLabel: "项目「Smith 住宅」讨论区", emailSkipped: "quiet_hours" }), createdAt: ago(8 * HOUR) });

    const result = await run(w);
    const to = w.sent.map((m) => m.userId).sort();
    ok(eq(to, ["u-a", "u-c", "u-quiet"]), "收件人：到点组织的在职 active 成员，有未读、偏好开、地址可投递", to);
    ok(mailTo(w, "u-a").length === 1, "属于两个到点组织的人只收一封（跨组织去重）");
    ok(mailTo(w, "u-b").length === 0, "没有未读的不发");
    ok(mailTo(w, "u-brief").length === 0, "只有每日简报未读的不发");
    ok(mailTo(w, "u-gone").length === 0 && mailTo(w, "u-left").length === 0, "账号停用、成员身份不是 active 的不发");
    ok(mailTo(w, "u-far").length === 0, "不在到点组织里的人不发");
    ok(mailTo(w, "u-quiet").length === 1, "汇总不受免打扰影响");
    ok(mailTo(w, "u-off").length === 0 && mailTo(w, "u-wx").length === 0, "邮件偏好关、地址不可投递的不发");
    ok(result.skippedByReason.email_off === 1 && result.skippedByReason.undeliverable === 1, "运行结果按原因计跳过数", result.skippedByReason);
    ok(!w.audits.some((a) => a.userId === "u-off" || a.userId === "u-wx"), "不发的人不写审计");

    const a = mailTo(w, "u-a")[0];
    ok(a?.to === "u-a@acme.ca", "收件地址是账号邮箱");
    ok(a?.subject === "【青砚】今日未读 4 条", "主题计数：已读与每日简报不计入，跳过过升级邮件的照样计入", a?.subject);
    const lines = itemLines(a?.text ?? "");
    ok(
      eq(lines, [
        "@提及｜项目「Smith 住宅」讨论区｜https://qingyan.ca/projects/proj-1?tab=workbench#project-discussion",
        "@提及｜项目「Smith 住宅」讨论区｜https://qingyan.ca/projects/proj-1?tab=workbench#project-discussion",
        "任务指派｜任务「复尺安排」｜截止 2026-11-06｜https://qingyan.ca/tasks?open=task-1",
        "工艺单阶段变化｜工艺单 SS-1042｜https://qingyan.ca/blinds-orders/ord-1",
      ]),
      "按组列出事项行：绝对链接、截止按组织时区",
      lines,
    );
    ok(a?.text.startsWith("【@提及】\n") && a.text.includes("\n\n【任务指派】\n") && a.text.includes("\n\n【工艺单阶段变化】\n"), "每组以【类型名】开头", a?.text);
    const c = mailTo(w, "u-c")[0];
    ok(c?.subject === "【青砚】今日未读 1 条" && c.text.includes("任务新评论｜任务「量尺」｜https://qingyan.ca/tasks?open=task-3"), "名下全部未读都列，不论通知属于哪个组织", c?.text);
    ok(w.countCalls.length === 1 && eq([...w.countCalls[0].excluded].sort(), ["daily_briefing", "sales_daily_briefing"]), "计数时排除两类简报（一次批量）", w.countCalls);
    ok(w.listCalls.every((c2) => c2.take === DIGEST_FETCH_LIMIT), "每人按上限取未读");
    ok(!w.listCalls.some((c2) => ["u-b", "u-brief", "u-off", "u-wx"].includes(c2.userId)), "没有未读、偏好关、地址不可投递的不读通知明细", w.listCalls.map((c2) => c2.userId));
  }

  console.log("截止日期与脱敏");
  {
    const w = world();
    member(w, "u-a");
    w.taskDue.set("task-7", new Date("2026-11-07T15:00:00.000Z"));
    note(w, "u-a", { orgId: "org-sh", type: "task_assigned", entityType: "task", entityId: "task-5", metadata: JSON.stringify({ objectLabel: "任务「上海」", dueAt: "2026-11-06T03:00:00.000Z" }), createdAt: ago(1 * HOUR) });
    note(w, "u-a", { orgId: "org-1", type: "task_assigned", entityType: "task", entityId: "task-6", metadata: JSON.stringify({ objectLabel: "任务「多伦多」", dueAt: "2026-11-06T03:00:00.000Z" }), createdAt: ago(2 * HOUR) });
    note(w, "u-a", { orgId: "org-1", type: "task_due", title: "任务「量尺」明天到期", entityType: "task", entityId: "task-7", metadata: null, createdAt: ago(3 * HOUR) });
    note(w, "u-a", { orgId: "org-1", type: "quote_signed", title: "客户签署报价 $12,000", entityType: "sales_quote", entityId: "q-1", metadata: null, createdAt: ago(4 * HOUR) });
    note(w, "u-a", { orgId: null, type: "system", title: "系统维护", projectId: null, entityType: null, entityId: null, metadata: null, createdAt: ago(5 * HOUR) });
    await run(w);
    const text = w.sent[0]?.text ?? "";
    ok(text.includes("任务指派｜任务「上海」｜截止 2026-11-06｜"), "上海组织的通知按上海时区取日期", text);
    ok(text.includes("任务指派｜任务「多伦多」｜截止 2026-11-05｜"), "多伦多组织的通知按多伦多时区取日期", text);
    ok(text.includes("任务截止与逾期｜任务「量尺」明天到期｜截止 2026-11-07｜https://qingyan.ca/tasks?open=task-7"), "没有 dueAt 的任务通知取任务当前的截止时间", text);
    ok(text.includes(`客户签署报价｜${REDACTED_TEXT}｜https://qingyan.ca/sales/quote-sheet?mode=order&quoteId=q-1&orgId=org-1`), "其他功能写的通知标题也脱敏", text);
    const all = `${w.sent[0]?.subject}${text}${w.sent[0]?.html}`;
    ok(!all.includes("12,000"), "邮件中不出现金额");
    ok(text.includes("系统通知（预留）｜系统维护｜https://qingyan.ca/notifications"), "没有跳转目标 → 回落 /notifications", text);
  }

  console.log("每人每天一封");
  {
    const w = world();
    member(w, "u-a");
    member(w, "u-b");
    note(w, "u-a");
    note(w, "u-b");
    note(w, "u-b", { type: "task_assigned", entityType: "task", entityId: "task-1", metadata: JSON.stringify({ objectLabel: "任务「复尺安排」" }) });
    w.audits.push({ userId: "u-a", day: "2026-11-05", audit: { day: "2026-11-05", timezone: "America/Toronto", count: 1, listed: 1, dryRun: false } });
    const result = await run(w);
    ok(mailTo(w, "u-a").length === 0 && result.alreadySent === 1, "同一本地日期已有审计记录 → 不发", result);
    const audit = w.audits.find((x) => x.userId === "u-b");
    ok(
      !!audit && audit.day === "2026-11-05" && eq(audit.audit, { day: "2026-11-05", timezone: "America/Toronto", count: 2, listed: 2, dryRun: false }),
      "发送前写审计：本地日期、时区、条数、是否只记日志（本地日期是第一个键）",
      audit,
    );
    ok(Object.keys(audit?.audit ?? {})[0] === "day", "afterData 的第一个键是 day");
    ok(mailTo(w, "u-b").length === 1 && w.audits.length === 2, "先写审计占位再发送");
    w.clock += HOUR;
    await run(w);
    ok(mailTo(w, "u-b").length === 1, "当天再跑一轮不重发");
  }
  {
    const w = world();
    member(w, "u-a", "org-1");
    member(w, "u-a", "org-2");
    note(w, "u-a");
    const [r1, r2] = await Promise.all([run(w, [TORONTO[0]]), run(w, [TORONTO[1]])]);
    ok(w.sent.length === 1 && r1.alreadySent + r2.alreadySent === 1, "两个多伦多组织在同一时刻各触发一轮：只发一封", { r1, r2 });
  }
  {
    const w = world();
    member(w, "u-a");
    note(w, "u-a");
    w.failSend = () => "Resend 503";
    const r1 = await run(w);
    ok(r1.failed === 1 && w.sent.length === 1 && w.audits.length === 1, "发送失败：失败数加一，审计照留", r1);
    w.failSend = () => null;
    w.clock += HOUR;
    const r2 = await run(w);
    ok(w.sent.length === 1 && r2.alreadySent === 1, "当天不补发", r2);
  }
  {
    // 上海组织 07:00 = 2026-11-04T23:00Z；本地日期按触发组织时区取（多伦多此时还是 11-04）
    const at7Shanghai = new Date("2026-11-04T23:00:00.000Z");
    const w = world(at7Shanghai);
    member(w, "u-a", "org-sh");
    note(w, "u-a", { orgId: "org-sh", createdAt: new Date(at7Shanghai.getTime() - HOUR) });
    await run(w, [{ id: "org-sh", timezone: "Asia/Shanghai" }]);
    ok(w.audits[0]?.day === "2026-11-05" && w.audits[0]?.audit.timezone === "Asia/Shanghai", "本地日期按触发组织的时区", w.audits[0]);
  }

  console.log("只记日志与缺发信配置");
  {
    const w = world();
    member(w, "u-a");
    note(w, "u-a");
    const result = await run(w, TORONTO, DRY);
    ok(w.sent.length === 0, "非生产未开真发：不调用发信服务");
    ok(w.logs.length === 1 && w.logs[0].includes("u-a") && w.logs[0].includes("【青砚】今日未读 1 条"), "日志含收件人 id 与主题", w.logs);
    ok(!w.logs[0]?.includes("u-a@acme.ca") && !w.logs[0]?.includes("｜"), "日志不含邮箱地址与正文", w.logs);
    ok(w.audits[0]?.audit.dryRun === true && result.dryRun === 1, "汇总照常写审计，标只记日志", w.audits[0]);
  }
  {
    const w = world();
    member(w, "u-a");
    note(w, "u-a");
    const result = await run(w, TORONTO, { realSend: true, origin: "", missingEnv: ["RESEND_API_KEY", "NEXT_PUBLIC_APP_URL"] });
    ok(w.sent.length === 0 && w.audits.length === 0 && w.countCalls.length === 0, "真发环境缺发信配置：不查、不写审计、不发");
    const o = digestOutcome(result);
    ok(o.status === "skipped" && JSON.stringify(o.metadata).includes("RESEND_API_KEY") && JSON.stringify(o.metadata).includes("NEXT_PUBLIC_APP_URL"), "运行记为跳过，写明缺少哪项配置", o.metadata);
  }

  console.log("上限、截止时刻与出错");
  {
    const w = world();
    for (let i = 0; i < DIGEST_MAX_EMAILS + 5; i++) {
      member(w, `u-${String(i).padStart(3, "0")}`);
      note(w, `u-${String(i).padStart(3, "0")}`);
    }
    const result = await run(w);
    ok(w.sent.length === 300 && result.capped, "单轮最多 300 封，超出时停下", { sent: w.sent.length, capped: result.capped });
    ok(w.audits.length === 300, "超出的不写审计（下一个 7 点之前也不会再到点）");
    ok((digestOutcome(result).metadata as Record<string, unknown>).capped === true, "运行记录标出达到上限");
  }
  {
    const w = world();
    w.sendDelayMs = MIN;
    for (const id of ["u-1", "u-2", "u-3", "u-4"]) {
      member(w, id);
      note(w, id);
    }
    const result = await run(w, TORONTO, REAL, new Date(NOW.getTime() + 90_000));
    ok(w.sent.length === 2 && result.deadlineHit, "时间预算用完就停", { sent: w.sent.length, result });
    ok((digestOutcome(result).metadata as Record<string, unknown>).deadlineHit === true, "运行记录标出时间预算用完");
  }
  {
    const w = world();
    w.failMembers = true;
    let threw = false;
    try {
      await run(w);
    } catch {
      threw = true;
    }
    ok(threw, "整步查询失败向外抛（由 runTrackedAutomation 记为失败、路由的 .catch 收住）");
  }
  {
    const w = world();
    member(w, "u-a");
    member(w, "u-b");
    note(w, "u-a");
    note(w, "u-b");
    const d = deps(w);
    const broken: DigestDeps = {
      ...d,
      async claimDigest(input) {
        if (input.userId === "u-a") throw new Error("lock timeout");
        return d.claimDigest(input);
      },
    };
    const result = await runEmailDigest({ orgs: TORONTO, deadline: FAR, config: REAL }, broken);
    ok(result.failed === 1 && mailTo(w, "u-b").length === 1 && w.errors.length === 1, "单封出错不影响同一轮的其他邮件", { result, errors: w.errors });
  }

  console.log("运行记录");
  {
    const empty = digestOutcome(await run(world()));
    ok(empty.status === "skipped" && empty.processedCount === 0, "到点组织里没有可发的 → 跳过", empty);
    const w = world();
    member(w, "u-a");
    member(w, "u-b");
    member(w, "u-off");
    w.prefs.set("u-off", pref({ emailEnabled: false, metadata: CHOSE }));
    note(w, "u-a");
    note(w, "u-b");
    note(w, "u-off");
    w.failSend = (m) => (m.userId === "u-b" ? "bounced" : null);
    const o = digestOutcome(await run(w));
    const meta = o.metadata as Record<string, unknown>;
    ok(o.status === "partial" && o.processedCount === 3 && o.succeededCount === 1 && o.failedCount === 1, "处理数、成功数、失败数", o);
    ok((meta.skipped as Record<string, number>).email_off === 1 && meta.sent === 1 && meta.failed === 1, "运行记录含按原因的跳过数", meta);
    const good = world();
    member(good, "u-a");
    note(good, "u-a");
    ok(digestOutcome(await run(good)).status === "succeeded", "全部发出 → succeeded");
  }

  console.log(`\ncollab-email-digest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
