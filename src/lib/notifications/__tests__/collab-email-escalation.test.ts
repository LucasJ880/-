/**
 * 协作通知 COLLAB-2：未读升级邮件（design D14、D16，spec notifications/email-reminders）
 * - 发送条件：只限 mention / task_assigned / rfq_chase_ready（T-1）、仍未读、创建于 [now − 24h, now − 15min]（两个边界）
 * - 防重：已发 / 已跳过 / 尝试满 3 次 / 10 分钟内正在发送的不再处理；认领的条件更新没命中时不发；两轮重叠只发一封
 * - 跳过：偏好关、免打扰（不论优先级）、账号停用、不是 active 成员、地址不可投递；跳过之后不再试
 * - 失败：记错误与次数，本轮不重试、下一轮再试、满 3 次不再试；metadata 合并保留原内容，状态不变
 * - 内容：主题、正文五段、事项行（｜ → /、截止按组织时区、绝对链接、回落 /notifications）、脱敏
 * - 收件地址只取账号邮箱并过滤占位域名；非生产只记日志并标 emailDryRun；缺发信配置整轮跳过；单轮 100 封与截止时刻
 * 时间、通知、偏好、用户、成员与发送函数全部从参数注入，无 DB。
 * 运行：npx tsx src/lib/notifications/__tests__/collab-email-escalation.test.ts
 */

import {
  EMAIL_FOOTER,
  buildMailItem,
  deliverMail,
  escalationMail,
  isDeliverableAddress,
  itemLine,
  normalizeOrigin,
  notificationLink,
  resolveMailConfig,
  type MailConfig,
  type MailItemContext,
  type MailNotification,
  type OutgoingMail,
} from "../collab/email";
import { chaseReadyNotice, quoteReceivedNotice } from "@/lib/tender-rfq/tracking-notify-pure";
import {
  ESCALATION_CANDIDATE_LIMIT,
  ESCALATION_DEADLINE_MS,
  ESCALATION_MAX_ATTEMPTS,
  ESCALATION_MAX_EMAILS,
  escalationEligibility,
  escalationOutcome,
  escalationSkipReason,
  runEmailEscalation,
  type EscalationCandidateRow,
  type EscalationDeps,
  type EscalationPreference,
  type EscalationResult,
  type EscalationUser,
} from "../collab/escalation";
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
/** 2026-11-04 13:00 多伦多（EST，UTC−5） */
const T0 = new Date("2026-11-04T18:00:00.000Z");
/** 2026-11-04 23:00 多伦多 */
const AT_23 = new Date("2026-11-05T04:00:00.000Z");
/** 2026-11-05 08:30 多伦多 */
const AT_0830 = new Date("2026-11-05T13:30:00.000Z");
const ago = (ms: number, from: Date = T0) => new Date(from.getTime() - ms);
const ORIGIN = "https://qingyan.ca";
const REAL: MailConfig = { realSend: true, origin: ORIGIN, missingEnv: [] };
const DRY: MailConfig = { realSend: false, origin: ORIGIN, missingEnv: [] };
const FAR = new Date("2030-01-01T00:00:00.000Z");
const CHOSE = JSON.stringify({ emailChoiceAt: "2026-11-01T00:00:00.000Z" });

// ── 假依赖：一张内存通知表，条件更新按 metadata（与可选的未读状态）比对 ─────────────

interface World {
  rows: Map<string, EscalationCandidateRow>;
  users: Map<string, EscalationUser>;
  prefs: Map<string, EscalationPreference>;
  memberships: Array<{ userId: string; orgId: string; orgActive: boolean }>;
  timezones: Map<string, string>;
  taskDue: Map<string, Date | null>;
  sent: OutgoingMail[];
  logs: string[];
  errors: string[];
  clock: number;
  sendDelayMs: number;
  failSend: (mail: OutgoingMail) => string | null;
  throwSendFor: Set<string>;
  throwUpdateFor: Set<string>;
  claimMiss: Set<string>;
  candidateCalls: Array<{ types: readonly string[]; createdFrom: Date; createdTo: Date; take: number }>;
  /** true：findCandidates 按查询语义返回（类型、未读、时间窗，从新到旧取前 take 条）；默认 false，全部返回 */
  honorQuery: boolean;
}

function world(now: Date = T0): World {
  return {
    rows: new Map(),
    users: new Map([["u-b", { id: "u-b", email: "b@acme.ca", status: "active" }]]),
    prefs: new Map(),
    memberships: [{ userId: "u-b", orgId: "org-1", orgActive: true }],
    timezones: new Map([
      ["org-1", "America/Toronto"],
      ["org-sh", "Asia/Shanghai"],
    ]),
    taskDue: new Map(),
    sent: [],
    logs: [],
    errors: [],
    clock: now.getTime(),
    sendDelayMs: 0,
    failSend: () => null,
    throwSendFor: new Set(),
    throwUpdateFor: new Set(),
    claimMiss: new Set(),
    candidateCalls: [],
    honorQuery: false,
  };
}

function deps(w: World): EscalationDeps {
  return {
    now: () => new Date(w.clock),
    async findCandidates(args) {
      w.candidateCalls.push(args);
      if (w.honorQuery) {
        return [...w.rows.values()]
          .filter(
            (r) =>
              args.types.includes(r.type) &&
              r.status === "unread" &&
              r.createdAt.getTime() >= args.createdFrom.getTime() &&
              r.createdAt.getTime() <= args.createdTo.getTime(),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take)
          .map((r) => ({ ...r }));
      }
      // 故意不按参数筛：时间窗、类型与状态的判断由被测代码在内存里再做一遍
      return [...w.rows.values()].map((r) => ({ ...r }));
    },
    async loadUsers(ids) {
      return ids.flatMap((id) => (w.users.has(id) ? [w.users.get(id)!] : []));
    },
    async loadPreferences(ids) {
      return ids.flatMap((id) => (w.prefs.has(id) ? [{ userId: id, ...w.prefs.get(id)! }] : []));
    },
    async loadMemberships(ids) {
      return w.memberships.filter((m) => ids.includes(m.userId));
    },
    async loadOrgTimezones(ids) {
      return new Map(ids.flatMap((id) => (w.timezones.has(id) ? [[id, w.timezones.get(id)!] as [string, string]] : [])));
    },
    async loadTaskDueDates(ids) {
      return new Map(ids.flatMap((id) => (w.taskDue.has(id) ? [[id, w.taskDue.get(id)!] as [string, Date | null]] : [])));
    },
    async updateMetadata(id, expected, next, opts) {
      if (w.throwUpdateFor.has(id)) throw new Error(`db down for ${id}`);
      const row = w.rows.get(id);
      if (!row || w.claimMiss.has(id)) return false;
      if (row.metadata !== expected) return false;
      if (opts.requireUnread && row.status !== "unread") return false;
      row.metadata = next;
      return true;
    },
    async send(mail) {
      w.sent.push(mail);
      w.clock += w.sendDelayMs;
      if (w.throwSendFor.has(mail.userId)) throw new Error("socket hang up");
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

let seq = 0;
function addRow(w: World, over: Partial<EscalationCandidateRow> = {}): EscalationCandidateRow {
  const id = over.id ?? `n${++seq}`;
  const row: EscalationCandidateRow = {
    id,
    userId: "u-b",
    orgId: "org-1",
    projectId: "proj-1",
    type: "task_assigned",
    status: "unread",
    priority: "high",
    title: "张三 把任务「复尺安排」指派给你",
    summary: "项目「Smith 住宅」 · 截止 2026-11-05",
    entityType: "task",
    entityId: "task-1",
    activityId: null,
    metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", dueAt: "2026-11-05T17:00:00.000Z" }),
    createdAt: ago(16 * MIN, new Date(w.clock)),
    ...over,
  };
  w.rows.set(id, row);
  return row;
}
const metaOf = (w: World, id: string) => JSON.parse(w.rows.get(id)!.metadata ?? "{}") as Record<string, unknown>;
const run = (w: World, config: MailConfig = REAL, deadline: Date = FAR): Promise<EscalationResult> =>
  runEmailEscalation({ deadline, config }, deps(w));
const pref = (p: Partial<EscalationPreference> = {}): EscalationPreference => ({
  emailEnabled: false,
  metadata: null,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  ...p,
});

async function main() {
  console.log("常量");
  ok(ESCALATION_MAX_EMAILS === 100, "单轮最多 100 封");
  ok(ESCALATION_CANDIDATE_LIMIT === 500, "候选最多取 500 条");
  ok(ESCALATION_MAX_ATTEMPTS === 3, "最多尝试 3 次");
  ok(ESCALATION_DEADLINE_MS === 285_000, "截止时刻为路由开始后 285 秒");

  console.log("发送条件（纯函数）");
  {
    const base = { type: "task_assigned", status: "unread", metadata: null as string | null };
    const at = (ms: number, over: Partial<typeof base> = {}) => escalationEligibility({ ...base, ...over, createdAt: ago(ms) }, T0);
    ok(at(15 * MIN) === "eligible", "刚满 15 分钟 → 发");
    ok(at(15 * MIN - 1) === "too_new", "差 1 毫秒满 15 分钟 → 不发");
    ok(at(24 * HOUR) === "eligible", "正好 24 小时 → 发");
    ok(at(24 * HOUR + 1) === "too_old", "超过 24 小时 → 不发");
    ok(at(25 * HOUR, { type: "mention" }) === "too_old", "25 小时前的 mention、从未发过 → 不发");
    ok(at(20 * MIN, { type: "mention" }) === "eligible", "mention 满 20 分钟 → 发");
    for (const type of ["task_status", "task_comment", "order_stage", "project_update", "task_due", "daily_briefing"]) {
      ok(at(20 * MIN, { type }) === "wrong_type", `${type} 不发`);
    }
    for (const status of ["read", "done", "snoozed", "archived"]) {
      ok(at(20 * MIN, { status }) === "not_unread", `状态 ${status}（已读 / 已完成 / 稍后提醒）不发`);
    }
    const m = (meta: Record<string, unknown>) => JSON.stringify(meta);
    ok(at(20 * MIN, { metadata: m({ emailedAt: ago(5 * MIN).toISOString() }) }) === "emailed", "已发过的不再发");
    ok(at(20 * MIN, { metadata: m({ emailedAt: ago(5 * MIN).toISOString(), emailDryRun: true }) }) === "emailed", "只记日志的也算已发");
    ok(at(20 * MIN, { metadata: m({ emailSkipped: "quiet_hours" }) }) === "skipped_before", "跳过过的不再试");
    ok(at(20 * MIN, { metadata: m({ emailAttempts: 3, emailError: "boom" }) }) === "attempts_exhausted", "累计 3 次的不再试");
    ok(at(20 * MIN, { metadata: m({ emailAttempts: 2, emailError: "boom" }) }) === "eligible", "失败 2 次的还可以再试");
    ok(at(20 * MIN, { metadata: m({ emailAttempts: 1, emailSendingAt: ago(5 * MIN).toISOString() }) }) === "in_flight", "10 分钟内正在发送的跳过");
    ok(at(20 * MIN, { metadata: m({ emailAttempts: 1, emailSendingAt: ago(10 * MIN + 1).toISOString() }) }) === "eligible", "正在发送超过 10 分钟（进程中断）→ 再试");
    ok(at(20 * MIN, { metadata: m({ emailAttempts: 1, emailSendingAt: ago(2 * MIN).toISOString(), emailError: "boom" }) }) === "eligible", "已有失败结果的不算正在发送");
    ok(at(20 * MIN, { metadata: "not json" }) === "unreadable_metadata", "metadata 不是 JSON 对象 → 不处理（不覆盖原内容）");
    ok(at(20 * MIN, { metadata: "[1,2]" }) === "unreadable_metadata", "metadata 是数组 → 不处理");
  }

  console.log("跳过原因（纯函数）");
  {
    const user: EscalationUser = { id: "u-b", email: "b@acme.ca", status: "active" };
    const skip = (over: Partial<Parameters<typeof escalationSkipReason>[0]> = {}) =>
      escalationSkipReason({ user, memberships: [{ orgId: "org-1", orgActive: true }], orgId: "org-1", preference: undefined, now: T0, ...over });
    ok(skip() === null, "在职、active 成员、没有偏好行（默认开）、地址可投递 → 不跳过");
    ok(skip({ user: undefined }) === "account_inactive", "账号不存在 → 账号停用");
    ok(skip({ user: { ...user, status: "disabled" } }) === "account_inactive", "账号停用 → 跳过");
    ok(skip({ memberships: [{ orgId: "org-2", orgActive: true }] }) === "not_member", "不是通知所属组织的 active 成员 → 跳过");
    ok(skip({ memberships: [] }) === "not_member", "没有任何 active 成员身份 → 跳过");
    ok(skip({ orgId: null, memberships: [{ orgId: "org-2", orgActive: true }] }) === null, "通知没有组织：是某个在用组织的 active 成员 → 不跳过");
    ok(skip({ orgId: null, memberships: [{ orgId: "org-3", orgActive: false }] }) === "not_member", "通知没有组织：只在停用的组织里 → 跳过");
    ok(skip({ orgId: null, memberships: [] }) === "not_member", "通知没有组织：不是任何组织的成员 → 跳过");
    ok(skip({ preference: pref({ emailEnabled: false, metadata: CHOSE }) }) === "email_off", "在设置页关了邮件 → 跳过");
    ok(skip({ preference: pref({ emailEnabled: false }) }) === null, "从没选过（列默认 false）→ 视为开启");
    ok(skip({ preference: pref({ emailEnabled: true, metadata: CHOSE }) }) === null, "在设置页开着 → 不跳过");
    const quiet = pref({ quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" });
    ok(skip({ preference: quiet, now: AT_23 }) === "quiet_hours", "免打扰 22:00–08:00，23:00 → 跳过");
    ok(skip({ preference: quiet, now: T0 }) === null, "免打扰 22:00–08:00，13:00 → 不跳过");
    ok(skip({ preference: { ...quiet, quietHoursEnabled: false }, now: AT_23 }) === null, "免打扰没开 → 不跳过");
    ok(skip({ user: { ...user, email: "wx_abc@wechat.user" } }) === "undeliverable", "微信注册的占位邮箱 → 地址不可投递");
  }

  console.log("收件地址过滤");
  {
    const cases: Array<[string | null, boolean]> = [
      ["b@acme.ca", true],
      ["Some.Name+tag@sub.example.com", true],
      ["wx_abc@wechat.user", false],
      ["WX_ABC@WeChat.User", false],
      ["system@qingyan.internal", false],
      ["a@printer.local", false],
      ["a@corp.internal", false],
      ["a@x.invalid", false],
      ["a@x.test", false],
      ["a@x.example", false],
      ["a@dev.localhost", false],
      ["not-an-email", false],
      ["a@b", false],
      ["a b@c.com", false],
      ["", false],
      [null, false],
    ];
    for (const [email, expected] of cases) ok(isDeliverableAddress(email) === expected, `${JSON.stringify(email)} → ${expected ? "可投递" : "不可投递"}`);
  }

  console.log("发信配置");
  {
    ok(normalizeOrigin("https://qingyan.ca/") === ORIGIN, "去掉末尾斜杠");
    ok(normalizeOrigin("  https://qingyan.ca  ") === ORIGIN, "去掉首尾空白");
    ok(normalizeOrigin("qingyan.ca") === null, "不带协议 → 视为缺失");
    ok(normalizeOrigin("ftp://qingyan.ca") === null, "不是 http(s) → 视为缺失");
    ok(normalizeOrigin(undefined) === null && normalizeOrigin("") === null, "空值 → 缺失");
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    ok(eq(resolveMailConfig(env({ NEXT_PUBLIC_APP_URL: ORIGIN }), true).missingEnv, ["RESEND_API_KEY"]), "真发环境缺 RESEND_API_KEY");
    ok(eq(resolveMailConfig(env({ RESEND_API_KEY: "re_test" }), true).missingEnv, ["NEXT_PUBLIC_APP_URL"]), "真发环境缺 NEXT_PUBLIC_APP_URL");
    ok(eq(resolveMailConfig(env({ RESEND_API_KEY: "  ", NEXT_PUBLIC_APP_URL: "" }), true).missingEnv, ["RESEND_API_KEY", "NEXT_PUBLIC_APP_URL"]), "空白值视为缺失");
    const full = resolveMailConfig(env({ RESEND_API_KEY: "re_test", NEXT_PUBLIC_APP_URL: "https://qingyan.ca/" }), true);
    ok(full.realSend && full.missingEnv.length === 0 && full.origin === ORIGIN, "配置齐全：真发，根地址规范化", full);
    const dry = resolveMailConfig(env({}), false);
    ok(!dry.realSend && dry.missingEnv.length === 0, "只记日志的环境不要求发信配置");
  }

  console.log("事项行与链接（纯函数）");
  {
    const n = (metadata: Record<string, unknown>, over: Partial<MailNotification> = {}): MailNotification => ({
      type: "task_assigned",
      title: "张三 把任务「复尺安排」指派给你",
      summary: null,
      entityType: "task",
      entityId: "task-9",
      projectId: null,
      activityId: null,
      orgId: "org-1",
      metadata,
      ...over,
    });
    const ctx = (timeZone: string, due: Map<string, Date | null> = new Map()): MailItemContext => ({ origin: ORIGIN, timeZone, taskDueDates: due });
    const late = { objectLabel: "任务「复尺安排」", dueAt: "2026-11-05T03:00:00.000Z" };
    ok(buildMailItem(n(late), ctx("America/Toronto")).dueDate === "2026-11-04", "截止按组织时区：多伦多是 11-04 晚上");
    ok(buildMailItem(n(late), ctx("Asia/Shanghai")).dueDate === "2026-11-05", "截止按组织时区：上海是 11-05 上午");
    const due = new Map<string, Date | null>([["task-9", new Date("2026-11-07T15:00:00.000Z")]]);
    ok(buildMailItem(n({ objectLabel: "任务「复尺安排」" }), ctx("America/Toronto", due)).dueDate === "2026-11-07", "metadata 没有 dueAt：取任务当前的截止时间");
    ok(buildMailItem(n({ dueAt: "garbage" }), ctx("America/Toronto", due)).dueDate === "2026-11-07", "dueAt 无效：当作没有，取任务当前的截止时间");
    ok(buildMailItem(n({}), ctx("America/Toronto", new Map([["task-9", null]]))).dueDate === null, "任务没有截止时间 → 没有截止");
    ok(buildMailItem(n({}, { entityType: "project_discussion" }), ctx("America/Toronto", due)).dueDate === null, "不是任务的通知不取任务截止");

    const item = buildMailItem(n(late), ctx("America/Toronto"));
    ok(item.typeLabel === "任务指派" && item.object === "任务「复尺安排」", "类型名与对象（objectLabel）", item);
    ok(item.link === "https://qingyan.ca/tasks?open=task-9", "链接 = 站点根地址 + 共用跳转表，绝对地址", item.link);
    ok(itemLine(item) === "任务指派｜任务「复尺安排」｜截止 2026-11-04｜https://qingyan.ca/tasks?open=task-9", "事项行四段", itemLine(item));
    ok(itemLine({ ...item, dueDate: null }) === "任务指派｜任务「复尺安排」｜https://qingyan.ca/tasks?open=task-9", "没有截止 → 省略第三段");
    ok(itemLine({ ...item, object: "任务「复尺｜二次」" }) === "任务指派｜任务「复尺/二次」｜截止 2026-11-04｜https://qingyan.ca/tasks?open=task-9", "对象里的｜换成 /");
    ok(itemLine({ ...item, object: "任务「复尺\n二次」" }).split("\n").length === 1, "对象里的换行不拆行：每条事项单独占一行");

    const bare = buildMailItem(n({}, { type: "mention", title: "张三 @ 了你", entityType: null, entityId: null }), ctx("America/Toronto"));
    ok(bare.link === "https://qingyan.ca/notifications", "没有跳转目标 → 回落 /notifications", bare.link);
    ok(bare.object === "张三 @ 了你" && bare.typeLabel === "@提及", "没有 objectLabel → 对象取标题");
    ok(notificationLink(ORIGIN, { entityType: "project_discussion", entityId: "msg-1", projectId: "proj-1" }) === "https://qingyan.ca/projects/proj-1?tab=workbench#project-discussion", "讨论区链接");
    const secret = buildMailItem(n({ objectLabel: "任务「报价 $12,000」" }), ctx("America/Toronto"));
    ok(secret.object === REDACTED_TEXT, "对象命中金额 → 整段替换", secret.object);
    const titled = buildMailItem(n({}, { title: "客户签署报价 $12,000" }), ctx("America/Toronto"));
    ok(titled.object === REDACTED_TEXT, "其他功能通知的标题同样脱敏", titled.object);
  }

  console.log("主题与正文");
  {
    const w = world();
    const row = addRow(w);
    await run(w);
    const mail = w.sent[0];
    ok(w.sent.length === 1, "满 16 分钟未读的任务指派：发一封");
    ok(mail?.subject === "【青砚】任务指派 · 任务「复尺安排」", "主题", mail?.subject);
    const paras = mail?.text.split("\n\n") ?? [];
    ok(
      eq(paras, [
        "张三 把任务「复尺安排」指派给你",
        "项目「Smith 住宅」 · 截止 2026-11-05",
        "任务指派｜任务「复尺安排」｜截止 2026-11-05｜https://qingyan.ca/tasks?open=task-1",
        "在青砚打开：https://qingyan.ca/tasks?open=task-1",
        EMAIL_FOOTER,
      ]),
      "正文依次为标题、摘要、事项行、打开链接、页脚",
      paras,
    );
    ok(
      EMAIL_FOOTER === "这封邮件由青砚自动发出，只发到你的青砚账号邮箱。不想再收：青砚 → 设置 → 通知，关闭「未读提醒与每日汇总邮件」。",
      "页脚原文",
    );
    ok(!!mail && mail.html.startsWith("<!doctype html>") && paras.every((p) => mail.html.includes(p)), "HTML 版本内容与纯文本相同");
    ok(mail?.to === "b@acme.ca" && mail?.userId === "u-b", "发给收件人自己的账号邮箱");
    ok(w.rows.get(row.id)!.status === "unread", "发出后通知仍为未读");
  }
  {
    const w = world();
    addRow(w, {
      type: "mention",
      priority: "high",
      title: "张三 在项目「Smith 住宅」讨论区 @ 了你",
      summary: null,
      entityType: "project_discussion",
      entityId: "msg-1",
      metadata: JSON.stringify({ objectLabel: "项目「Smith 住宅」讨论区" }),
    });
    await run(w);
    const mail = w.sent[0];
    ok(mail?.subject === "【青砚】@提及 · 项目「Smith 住宅」讨论区", "讨论区 @ 的主题", mail?.subject);
    const paras = mail?.text.split("\n\n") ?? [];
    ok(paras.length === 4, "没有摘要 → 省略摘要段", paras);
    ok(paras[1] === "@提及｜项目「Smith 住宅」讨论区｜https://qingyan.ca/projects/proj-1?tab=workbench#project-discussion", "讨论区 @ 没有截止：事项行三段", paras[1]);
  }
  {
    const w = world();
    w.memberships.push({ userId: "u-b", orgId: "org-sh", orgActive: true });
    const meta = JSON.stringify({ objectLabel: "任务「复尺安排」", dueAt: "2026-11-05T03:00:00.000Z" });
    addRow(w, { id: "tor", orgId: "org-1", metadata: meta });
    addRow(w, { id: "sha", orgId: "org-sh", metadata: meta });
    addRow(w, { id: "none", orgId: null, metadata: meta });
    await run(w);
    const lines = w.sent.map((m) => m.text.split("\n\n")[2]);
    ok(lines.filter((l) => l.includes("截止 2026-11-04")).length === 2 && lines.filter((l) => l.includes("截止 2026-11-05")).length === 1, "截止按通知所属组织的时区：多伦多与没有组织的是 11-04，上海是 11-05", lines);
  }
  {
    const w = world();
    w.taskDue.set("task-7", new Date("2026-11-07T15:00:00.000Z"));
    addRow(w, { entityId: "task-7", metadata: JSON.stringify({ objectLabel: "任务「量尺」" }) });
    await run(w);
    ok(w.sent[0]?.text.includes("任务指派｜任务「量尺」｜截止 2026-11-07｜https://qingyan.ca/tasks?open=task-7"), "metadata 没有 dueAt：取任务当前的截止时间（每轮批量查）", w.sent[0]?.text);
  }
  {
    const w = world();
    addRow(w, {
      title: "张三 把任务「报价 $12,000」指派给你",
      summary: "客户电话 416-555-0199",
      metadata: JSON.stringify({ objectLabel: "任务「报价 $12,000」" }),
    });
    await run(w);
    const mail = w.sent[0];
    const all = `${mail?.subject}\n${mail?.text}\n${mail?.html}`;
    ok(!!mail && !all.includes("12,000") && !all.includes("416-555-0199"), "主题、正文与 HTML 都不出现金额与电话");
    ok(mail?.subject === `【青砚】任务指派 · ${REDACTED_TEXT}`, "主题里的对象整段替换", mail?.subject);
    const paras = mail?.text.split("\n\n") ?? [];
    ok(paras[0] === REDACTED_TEXT && paras[1] === REDACTED_TEXT, "标题与摘要整段替换", paras);
  }
  {
    const long = `任务「${"很".repeat(50)}」`;
    const item = { typeLabel: "任务指派", object: long, dueDate: null, link: `${ORIGIN}/tasks?open=t` };
    const mail = escalationMail({ title: "t", summary: null }, item);
    ok(mail.subject === `【青砚】任务指派 · ${Array.from(long).slice(0, 40).join("")}`, "对象超过 40 个字符截断", mail.subject);
    const short = escalationMail({ title: "t", summary: null }, { ...item, object: "任务「复尺」" });
    ok(short.subject === "【青砚】任务指派 · 任务「复尺」", "不超过 40 个字符不截断");
  }
  {
    const w = world();
    addRow(w, { metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", email: "someone@else.com", to: "x@y.com" }) });
    await run(w);
    ok(w.sent[0]?.to === "b@acme.ca", "收件地址只取账号邮箱，不取通知内容里的地址", w.sent[0]?.to);
  }

  console.log("防重与记录");
  {
    const w = world();
    const row = addRow(w, { metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", dueAt: "2026-11-05T17:00:00.000Z", keep: "原有内容" }) });
    const first = await run(w);
    w.clock += 15 * MIN;
    const second = await run(w);
    ok(w.sent.length === 1 && first.sent === 1 && second.sent === 0, "下一轮不再为这条通知发邮件", { first, second });
    const meta = metaOf(w, row.id);
    ok(meta.keep === "原有内容" && meta.objectLabel === "任务「复尺安排」" && meta.dueAt === "2026-11-05T17:00:00.000Z", "metadata 合并保留原内容", meta);
    ok(meta.emailAttempts === 1 && meta.emailSendingAt === T0.toISOString() && meta.emailedAt === T0.toISOString(), "记下 emailSendingAt、emailAttempts 与 emailedAt", meta);
    ok(meta.emailDryRun === undefined && meta.emailError === undefined, "真发不标 emailDryRun，没有错误");
    ok(w.rows.get(row.id)!.status === "unread", "状态不变");
  }
  {
    const w = world();
    const row = addRow(w);
    w.claimMiss.add(row.id);
    const result = await run(w);
    ok(w.sent.length === 0 && result.claimMissed === 1, "认领的条件更新没命中 → 不发", result);
  }
  {
    const w = world();
    const row = addRow(w, { metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", emailAttempts: 1, emailSendingAt: ago(5 * MIN).toISOString() }) });
    const before = w.rows.get(row.id)!.metadata;
    await run(w);
    ok(w.sent.length === 0 && w.rows.get(row.id)!.metadata === before, "10 分钟内正在发送的跳过，不动它");
  }
  {
    const w = world();
    addRow(w, { status: "read" });
    addRow(w, { status: "done" });
    addRow(w, { status: "snoozed" });
    addRow(w, { type: "task_status" });
    addRow(w, { createdAt: ago(10 * MIN) });
    addRow(w, { type: "mention", createdAt: ago(25 * HOUR) });
    const result = await run(w);
    ok(w.sent.length === 0 && result.eligible === 0, "已读、已完成、稍后提醒、其他类型、未满 15 分钟、超过 24 小时：都不发", result);
    const o = escalationOutcome(result);
    ok(o.status === "skipped" && o.processedCount === 0, "没有可发的 → 运行记为跳过", o);
  }
  {
    const w = world();
    for (let i = 0; i < 5; i++) addRow(w);
    const [a, b] = await Promise.all([run(w), run(w)]);
    const attempts = [...w.rows.keys()].map((id) => metaOf(w, id).emailAttempts);
    ok(w.sent.length === 5 && attempts.every((n) => n === 1), "两轮同时处理：每条只发一封", { sent: w.sent.length, attempts });
    ok(a.sent + b.sent === 5 && a.claimMissed + b.claimMissed === 5, "另一轮的认领落空", { a: a.claimMissed, b: b.claimMissed });
  }
  {
    const w = world();
    const row = addRow(w);
    const result = await run(w);
    const c = w.candidateCalls[0];
    ok(
      !!c &&
        eq([...c.types].sort(), ["mention", "rfq_chase_ready", "task_assigned"]) &&
        c.take === 500 &&
        c.createdFrom.getTime() === T0.getTime() - 24 * HOUR &&
        c.createdTo.getTime() === T0.getTime() - 15 * MIN,
      "候选查询：三种类型、[now − 24h, now − 15min]、前 500 条",
      c,
    );
    ok(result.candidates === 1 && result.eligible === 1 && row.id.length > 0, "运行结果记候选数与可发数", result);
  }

  console.log("跳过规则（之后不再试）");
  {
    const w = world(AT_23);
    const users: Array<[string, EscalationUser]> = [
      ["u-off", { id: "u-off", email: "off@acme.ca", status: "active" }],
      ["u-quiet", { id: "u-quiet", email: "quiet@acme.ca", status: "active" }],
      ["u-gone", { id: "u-gone", email: "gone@acme.ca", status: "disabled" }],
      ["u-out", { id: "u-out", email: "out@acme.ca", status: "active" }],
      ["u-wx", { id: "u-wx", email: "wx_abc@wechat.user", status: "active" }],
    ];
    for (const [id, u] of users) w.users.set(id, u);
    for (const id of ["u-off", "u-quiet", "u-gone", "u-wx"]) w.memberships.push({ userId: id, orgId: "org-1", orgActive: true });
    w.memberships.push({ userId: "u-out", orgId: "org-2", orgActive: true });
    w.prefs.set("u-off", pref({ emailEnabled: false, metadata: CHOSE }));
    w.prefs.set("u-quiet", pref({ emailEnabled: true, metadata: CHOSE, quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" }));
    const createdAt = ago(15 * MIN, AT_23);
    for (const [id] of users) addRow(w, { id: `row-${id}`, userId: id, priority: "urgent", createdAt });
    addRow(w, { id: "row-u-b", userId: "u-b", createdAt });
    const result = await run(w);
    ok(w.sent.length === 1 && w.sent[0].userId === "u-b", "只有不需要跳过的人收到邮件", w.sent.map((m) => m.userId));
    const reasons = Object.fromEntries(users.map(([id]) => [id, metaOf(w, `row-${id}`).emailSkipped]));
    ok(
      eq(reasons, { "u-off": "email_off", "u-quiet": "quiet_hours", "u-gone": "account_inactive", "u-out": "not_member", "u-wx": "undeliverable" }),
      "通知上记下跳过原因（免打扰不论优先级）",
      reasons,
    );
    const counts = Object.entries(result.skippedByReason).sort(([a], [b]) => a.localeCompare(b));
    ok(
      eq(counts, [["account_inactive", 1], ["email_off", 1], ["not_member", 1], ["quiet_hours", 1], ["undeliverable", 1]]),
      "运行结果按原因计跳过数",
      result.skippedByReason,
    );
    ok(users.every(([id]) => w.rows.get(`row-${id}`)!.status === "unread"), "跳过不改状态");
    w.clock = AT_0830.getTime();
    const next = await run(w);
    ok(w.sent.length === 1 && Object.values(next.skippedByReason).every((n) => n === 0), "08:30 那一轮也不再为跳过的通知发邮件或重算", next);
  }

  console.log("发送失败与重试");
  {
    const w = world();
    const row = addRow(w, { metadata: JSON.stringify({ objectLabel: "任务「复尺安排」", keep: 1 }) });
    w.failSend = () => "Resend 503";
    const r1 = await run(w);
    let meta = metaOf(w, row.id);
    ok(w.sent.length === 1 && r1.failed === 1, "第一轮失败：本轮只试一次", r1);
    ok(meta.emailError === "Resend 503" && meta.emailAttempts === 1 && meta.emailedAt === undefined && meta.keep === 1, "记下错误与累计次数，保留原内容", meta);
    ok(w.rows.get(row.id)!.status === "unread", "失败不改状态");
    w.clock += 15 * MIN;
    await run(w);
    w.clock += 15 * MIN;
    await run(w);
    meta = metaOf(w, row.id);
    ok(w.sent.length === 3 && meta.emailAttempts === 3, "之后两轮各再试一次，累计 3 次", { sent: w.sent.length, meta });
    w.clock += 15 * MIN;
    const r4 = await run(w);
    ok(w.sent.length === 3 && r4.eligible === 0, "累计失败 3 次后不再试", r4);
  }
  {
    const w = world();
    const row = addRow(w);
    let calls = 0;
    w.failSend = () => (++calls === 1 ? "timeout" : null);
    await run(w);
    w.clock += 15 * MIN;
    await run(w);
    const meta = metaOf(w, row.id);
    ok(w.sent.length === 2 && typeof meta.emailedAt === "string" && meta.emailAttempts === 2 && meta.emailError === undefined, "失败一次、下一轮发出：记 emailedAt，累计 2 次", meta);
  }
  {
    const w = world();
    w.users.set("u-c", { id: "u-c", email: "c@acme.ca", status: "active" });
    w.memberships.push({ userId: "u-c", orgId: "org-1", orgActive: true });
    const boom = addRow(w, { userId: "u-c", createdAt: ago(30 * MIN) });
    const broken = addRow(w, { createdAt: ago(25 * MIN) });
    const fine = addRow(w, { createdAt: ago(20 * MIN) });
    w.throwSendFor.add("u-c");
    w.throwUpdateFor.add(broken.id);
    const result = await run(w);
    ok(metaOf(w, boom.id).emailError === "socket hang up", "发信抛错：当作失败记下", metaOf(w, boom.id));
    ok(typeof metaOf(w, fine.id).emailedAt === "string", "单封出错不影响同一轮的其他邮件");
    ok(result.failed === 2 && result.sent === 1 && w.errors.length >= 1, "写库出错也只算这一封失败并记日志", { result, errors: w.errors });
  }

  console.log("非生产只记日志");
  {
    const w = world();
    const row = addRow(w);
    const result = await run(w, DRY);
    ok(w.sent.length === 0, "未开真发：不调用发信服务");
    ok(w.logs.length === 1 && w.logs[0].includes("u-b") && w.logs[0].includes("【青砚】任务指派 · 任务「复尺安排」"), "日志含收件人 id 与主题", w.logs);
    ok(!w.logs[0]?.includes("b@acme.ca") && !w.logs[0]?.includes("在青砚打开") && !w.logs[0]?.includes("任务指派｜"), "日志不含邮箱地址与正文", w.logs);
    const meta = metaOf(w, row.id);
    ok(meta.emailDryRun === true && meta.emailedAt === T0.toISOString(), "按已发处理：记 emailedAt 与 emailDryRun: true", meta);
    ok(result.dryRun === 1 && result.sent === 0 && !result.realSend, "运行结果记只记日志的封数");
    w.clock += 15 * MIN;
    await run(w, DRY);
    ok(w.logs.length === 1, "只记日志的也不再重复处理");
  }
  {
    const logs: string[] = [];
    let sends = 0;
    const mailDeps = {
      send: async () => {
        sends++;
        return { ok: true };
      },
      log: (m: string) => {
        logs.push(m);
      },
    };
    const mail: OutgoingMail = { userId: "u-x", to: "x@acme.ca", subject: "【青砚】@提及 · 任务「a」", text: "正文", html: "<p>正文</p>" };
    ok((await deliverMail(mail, false, mailDeps)).status === "dry_run" && sends === 0 && logs.length === 1, "deliverMail：只记日志的环境不发");
    ok((await deliverMail(mail, true, mailDeps)).status === "sent" && sends === 1, "deliverMail：真发环境调用发信服务");
    const failedOutcome = await deliverMail(mail, true, { ...mailDeps, send: async () => ({ ok: false, error: "domain not verified" }) });
    ok(failedOutcome.status === "failed" && "error" in failedOutcome && failedOutcome.error === "domain not verified", "deliverMail：发信服务返回失败", failedOutcome);
    const thrown = await deliverMail(mail, true, {
      ...mailDeps,
      send: async () => {
        throw new Error("ECONNRESET");
      },
    });
    ok(thrown.status === "failed" && "error" in thrown && thrown.error === "ECONNRESET", "deliverMail：发信抛错当作失败，不向外抛", thrown);
  }

  console.log("缺少发信配置");
  {
    const w = world();
    const row = addRow(w);
    const before = w.rows.get(row.id)!.metadata;
    const result = await run(w, { realSend: true, origin: "", missingEnv: ["NEXT_PUBLIC_APP_URL"] });
    ok(w.candidateCalls.length === 0 && w.sent.length === 0 && w.logs.length === 0, "缺 NEXT_PUBLIC_APP_URL：不查通知、不发");
    ok(w.rows.get(row.id)!.metadata === before, "通知不变");
    const o = escalationOutcome(result);
    ok(o.status === "skipped" && JSON.stringify(o.metadata).includes("NEXT_PUBLIC_APP_URL"), "运行记为跳过，并写明缺少哪项配置", o.metadata);
    const o2 = escalationOutcome(await run(world(), { realSend: true, origin: ORIGIN, missingEnv: ["RESEND_API_KEY"] }));
    ok(o2.status === "skipped" && JSON.stringify(o2.metadata).includes("RESEND_API_KEY"), "缺 RESEND_API_KEY 同样整轮跳过", o2.metadata);
  }

  console.log("上限与截止时刻");
  {
    const w = world();
    const rows: EscalationCandidateRow[] = [];
    for (let i = 0; i < ESCALATION_MAX_EMAILS + 5; i++) rows.push(addRow(w, { createdAt: ago(16 * MIN + i * 1000) }));
    const result = await run(w);
    ok(w.sent.length === 100 && result.capped, "单轮最多 100 封，超出时停下", { sent: w.sent.length, capped: result.capped });
    const untouched = rows.filter((r) => metaOf(w, r.id).emailAttempts === undefined).map((r) => r.id);
    ok(eq(untouched, rows.slice(0, 5).map((r) => r.id)), "按创建时间先旧后新：最新的 5 条留给下一轮，不动", untouched);
    const o = escalationOutcome(result);
    ok((o.metadata as Record<string, unknown>).capped === true, "运行记录标出达到上限");
  }
  {
    const w = world();
    w.sendDelayMs = MIN;
    for (let i = 0; i < 6; i++) addRow(w, { createdAt: ago(16 * MIN + i * 1000) });
    const result = await run(w, REAL, new Date(T0.getTime() + 150_000));
    ok(w.sent.length === 3 && result.deadlineHit, "时间预算用完就停", { sent: w.sent.length, result });
    ok((escalationOutcome(result).metadata as Record<string, unknown>).deadlineHit === true, "运行记录标出时间预算用完");
  }

  console.log("候选窗口");
  {
    // 发过邮件、一直没读的通知会在 24 小时窗口里留很久；候选从新到旧取，新到的通知总在前 500 条之内
    const w = world();
    w.honorQuery = true;
    for (let i = 0; i < ESCALATION_CANDIDATE_LIMIT + 100; i++) {
      addRow(w, {
        id: `old-${i}`,
        createdAt: ago(2 * HOUR + i * 1000),
        metadata: JSON.stringify({ objectLabel: "任务「旧」", emailedAt: ago(HOUR).toISOString(), emailAttempts: 1 }),
      });
    }
    const fresh = addRow(w, { id: "fresh", createdAt: ago(16 * MIN) });
    const result = await run(w);
    ok(
      w.sent.length === 1 && w.sent[0].userId === "u-b" && typeof metaOf(w, fresh.id).emailedAt === "string",
      "窗口里发过邮件、仍未读的通知超过 500 条时，新到的照样在这一轮发出",
      { sent: w.sent.length, eligible: result.eligible },
    );
    ok(result.candidates === ESCALATION_CANDIDATE_LIMIT && result.candidatesTruncated === true, "候选取满 500 条：运行结果标出窗口被截断", result);
    ok((escalationOutcome(result).metadata as Record<string, unknown>).candidatesTruncated === true, "运行记录标出候选窗口被截断");
  }
  {
    const w = world();
    addRow(w);
    const result = await run(w);
    ok(result.candidatesTruncated === false, "候选没取满：不标截断", result);
  }

  console.log("运行记录");
  {
    const w = world();
    w.users.set("u-off", { id: "u-off", email: "off@acme.ca", status: "active" });
    w.users.set("u-c", { id: "u-c", email: "c@acme.ca", status: "active" });
    w.memberships.push({ userId: "u-off", orgId: "org-1", orgActive: true }, { userId: "u-c", orgId: "org-1", orgActive: true });
    w.prefs.set("u-off", pref({ emailEnabled: false, metadata: CHOSE }));
    addRow(w, { userId: "u-b" });
    addRow(w, { userId: "u-off" });
    addRow(w, { userId: "u-c" });
    w.failSend = (m) => (m.userId === "u-c" ? "bounced" : null);
    const o = escalationOutcome(await run(w));
    const meta = o.metadata as Record<string, unknown>;
    ok(o.status === "partial" && o.processedCount === 3 && o.succeededCount === 1 && o.failedCount === 1, "处理数、成功数、失败数", o);
    ok((meta.skipped as Record<string, number>).email_off === 1 && meta.sent === 1 && meta.failed === 1, "运行记录含按原因的跳过数", meta);
    const allGood = world();
    addRow(allGood);
    ok(escalationOutcome(await run(allGood)).status === "succeeded", "全部发出 → succeeded");
  }

  console.log("T-1 催单待批的升级邮件");
  {
    const round = { inquiryId: "R1", projectId: "P1", projectName: "Alberta 露营装备", roundNumber: 2 };
    const ready = chaseReadyNotice({
      round,
      days: 3,
      cards: [
        { actionId: "a1", supplierName: "丙厂", kind: "no_reply", missingFields: [] },
        { actionId: "a2", supplierName: "丁厂", kind: "no_reply", missingFields: [] },
        { actionId: "q1", supplierName: "甲厂", kind: "missing_fields", missingFields: ["validUntil"] },
      ],
    })!;
    const quote = quoteReceivedNotice({ round, itemId: "it-1", messageId: "m-1", supplierName: "甲厂", missingFields: [] });
    const asRow = (n: typeof ready, over: Partial<EscalationCandidateRow> = {}): Partial<EscalationCandidateRow> => ({
      type: n.type,
      priority: n.priority,
      title: n.title,
      summary: n.summary,
      projectId: n.projectId,
      entityType: n.entityType,
      entityId: n.entityId,
      metadata: JSON.stringify(n.metadata),
      ...over,
    });
    const at = (type: string, ms: number) =>
      escalationEligibility({ type, status: "unread", metadata: null, createdAt: ago(ms) }, T0);
    ok(at("rfq_chase_ready", 16 * MIN) === "eligible", "rfq_chase_ready 满 15 分钟未读 → 进候选");
    ok(at("rfq_chase_ready", 15 * MIN - 1) === "too_new", "rfq_chase_ready 不满 15 分钟 → 不发");
    for (const type of ["rfq_quote_received", "rfq_reply_received", "rfq_no_response"]) {
      ok(at(type, 20 * MIN) === "wrong_type", `${type} 不升级`);
    }

    const w = world();
    const r = addRow(w, asRow(ready, { id: "chase-1", createdAt: ago(16 * MIN) }));
    addRow(w, asRow(quote, { id: "quote-1", createdAt: ago(20 * MIN) }));
    const result = await run(w);
    ok(result.sent === 1 && w.sent.length === 1, "只发催单待批那一封，报价通知不发", result);
    const mail = w.sent[0];
    ok(mail?.subject === "【青砚】催单待批 · 项目「Alberta 露营装备」第 2 轮询价", "主题：【青砚】催单待批 · 项目「…」第 n 轮询价", mail?.subject);
    ok(!!mail && mail.text.includes(`在青砚打开：${ORIGIN}/projects/P1?tab=bid#rfq-round-R1`), "打开链接指向该询价轮次", mail?.text);
    ok(!!mail && mail.text.includes("催单待批｜项目「Alberta 露营装备」第 2 轮询价｜"), "事项行：类型名｜对象｜链接", mail?.text);
    ok(!!mail && mail.text.includes(ready.title) && mail.text.includes(ready.summary), "正文含通知标题与摘要");
    ok(!!mail && !/\$|¥|USD|CAD|\d+\.\d{2}/.test(mail.subject + mail.text), "主题与纯文本正文不出现任何金额");
    // HTML 版内容与纯文本相同；模板 CSS 里有 0.16em 之类的小数，所以 HTML 只查货币符号与币种
    ok(!!mail && !/\$|¥|USD|CAD/.test(mail.html), "HTML 正文不出现货币符号与币种");
    ok(typeof metaOf(w, r.id).emailedAt === "string", "发过之后记 emailedAt");
    ok(typeof metaOf(w, "quote-1").emailedAt === "undefined", "报价通知没有被认领");
    const again = await run(w);
    ok(again.sent === 0 && w.sent.length === 1, "下一轮不再为这条通知发邮件", again);

    const w2 = world();
    addRow(w2, asRow(ready, { id: "chase-read", status: "read", createdAt: ago(20 * MIN) }));
    const r2 = await run(w2);
    ok(r2.sent === 0 && w2.sent.length === 0, "已点开（已读）的催单待批不发");
  }

  console.log(`\ncollab-email-escalation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
