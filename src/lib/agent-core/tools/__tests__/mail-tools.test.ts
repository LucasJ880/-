/**
 * MAIL-1 读信工具：参数表、只读本人邮箱、客户作用域、错误码、附件不下载、审计、不落库
 * （spec mail/assistant-read；change mail-read-tools）
 * 无真实 Google、无数据库：Gmail 走注入的假 API（经真实的读接口函数），客户查询与审计走注入的假实现。
 * 运行：npx tsx src/lib/agent-core/tools/__tests__/mail-tools.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../../tool-registry";
import "../index";
import { createMailTools, type MailAuditEntry, type MailCustomerRow, type MailToolDeps } from "../mail";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types";
import { GMAIL_COMPOSE_SCOPE, getThreadText, searchMailbox } from "@/lib/google-email";
import { PROVIDER, b64, fakeGmail, gmailDeps, type FakeGmailOptions } from "@/lib/mail-read/__tests__/fake-gmail";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codeOf = (r: ToolExecutionResult) => (r.data as { code?: string } | null)?.code;

// ── 夹具 ────────────────────────────────────────────────────

const ORG = "org_sunny";
const THREAD_ID = "18c2f0a9b7d1e234";
const BODY_1 = "您好，报价见附件，含税总价请见第二页。";
const BODY_2 = "周五上午十点上门可以，麻烦带上样品册。";
const SUBJECT = "Re: 客厅百叶窗报价";
const SENDER = "王总 <client@example.com>";

const CUSTOMERS: Record<string, MailCustomerRow> = {
  c_mine: { id: "c_mine", orgId: ORG, createdById: "u_a", email: "Client@Example.com" },
  c_theirs: { id: "c_theirs", orgId: ORG, createdById: "u_b", email: "other@example.com" },
  c_noemail: { id: "c_noemail", orgId: ORG, createdById: "u_a", email: null },
  c_otherorg: { id: "c_otherorg", orgId: "org_other", createdById: "u_a", email: "x@example.com" },
};

const THREAD = {
  messages: [
    {
      id: "m1",
      labelIds: ["SENT"],
      internalDate: String(Date.UTC(2026, 10, 9, 15, 0, 0)),
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "lynn@sunny.example" }, { name: "To", value: "client@example.com" }, { name: "Subject", value: "客厅百叶窗报价" }],
        parts: [
          { mimeType: "text/plain", body: { data: b64(BODY_1) } },
          { mimeType: "application/pdf", filename: "quote.pdf", body: { attachmentId: "att1", size: 34567 } },
        ],
      },
    },
    {
      id: "m2",
      labelIds: ["INBOX"],
      internalDate: String(Date.UTC(2026, 10, 10, 15, 0, 0)),
      payload: { mimeType: "text/plain", headers: [{ name: "From", value: SENDER }, { name: "Subject", value: SUBJECT }], body: { data: b64(BODY_2) } },
    },
  ],
};

function harness(opts: {
  gmail?: FakeGmailOptions;
  provider?: Record<string, unknown> | null;
  auditThrows?: boolean;
  overrides?: Partial<MailToolDeps>;
} = {}) {
  const g = fakeGmail({ listIds: ["a1", "a2"], threads: { [THREAD_ID]: THREAD }, subjectOf: () => SUBJECT, snippetOf: () => BODY_2.slice(0, 12), from: SENDER, ...opts.gmail });
  const provider = opts.provider === undefined ? PROVIDER : opts.provider;
  const audits: MailAuditEntry[] = [];
  const customerLookups: Array<{ customerId: string; orgId: string }> = [];
  const readUserIds: string[] = [];
  const [search, readThread] = createMailTools({
    isEnabled: () => true,
    searchMailbox: (userId, o) => {
      readUserIds.push(userId);
      return searchMailbox(userId, o, gmailDeps(g.api, provider));
    },
    getThreadText: (userId, threadId) => {
      readUserIds.push(userId);
      return getThreadText(userId, threadId, gmailDeps(g.api, provider));
    },
    findCustomer: async (input) => {
      customerLookups.push(input);
      const row = CUSTOMERS[input.customerId];
      return row && row.orgId === input.orgId ? row : null;
    },
    writeAudit: async (entry) => {
      if (opts.auditThrows) throw new Error("audit down");
      audits.push(entry);
    },
    ...opts.overrides,
  });
  return { search, readThread, gmail: g, audits, customerLookups, readUserIds };
}

function ctx(args: Record<string, unknown>, over: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    args,
    userId: "u_a",
    orgId: ORG,
    role: "sales",
    orgRole: "org_member",
    hasMembership: true,
    entryGate: { marketing: false, mail: true },
    scopeGuard: { orgId: ORG, principalUserId: "u_a" },
    ...over,
  };
}

async function main() {
  console.log("mail-tools（读信工具）");

  console.log("\n参数表里没有邮箱或用户");
  {
    const s = registry.get("mail_search")!;
    const r = registry.get("mail_read_thread")!;
    ok(JSON.stringify(Object.keys(s.parameters.properties).sort()) === '["customerId","newerThanDays","query","unreadOnly"]', "mail_search 的参数只有 query / customerId / newerThanDays / unreadOnly", Object.keys(s.parameters.properties));
    ok(JSON.stringify(Object.keys(r.parameters.properties)) === '["threadId"]' && JSON.stringify(r.parameters.required) === '["threadId"]', "mail_read_thread 的参数只有 threadId");
    const all = JSON.stringify([s.parameters, r.parameters]).toLowerCase();
    ok(!/"(userid|user|email|mailbox|account|address|orgid)"/.test(all), "两个参数表里没有 userId / email / mailbox / account 之类的字段");
    ok(s.domain === "secretary" && r.domain === "secretary", "两者挂在所有角色都有的 secretary 域（受众另由入口门决定）");
  }

  console.log("\n管理者也只能读本人邮箱");
  {
    const prev = process.env.MAIL_READ_ENABLED;
    process.env.MAIL_READ_ENABLED = "true";
    const admin = ctx({ query: "x", userId: "u_lynn" }, { userId: "u_admin", role: "super_admin", orgRole: "org_admin", scopeGuard: { orgId: ORG, principalUserId: "u_admin" } });
    const r = await registry.execute("mail_search", admin);
    ok(r.success === false && codeOf(r) === "SCOPE_USER_OVERRIDE", "super_admin 带他人用户 id：被执行前守卫拒绝（SCOPE_USER_OVERRIDE）", r);
    if (prev === undefined) delete process.env.MAIL_READ_ENABLED;
    else process.env.MAIL_READ_ENABLED = prev;

    const h = harness();
    const r2 = await h.search.execute(ctx({ query: "x", mailbox: "lynn@sunny.example", email: "lynn@sunny.example", account: "lynn" }, { userId: "u_admin", role: "super_admin", orgRole: "org_admin" }));
    ok(r2.success === true && JSON.stringify(h.readUserIds) === '["u_admin"]', "多余的邮箱 / 账号参数被忽略，Gmail 读取只按调用者本人的 userId 发起", h.readUserIds);
    const q = String(h.gmail.calls.find((c) => c.api === "messages.list")!.args.q);
    ok(!q.includes("lynn"), "多余参数不进入搜索条件", q);
    await h.readThread.execute(ctx({ threadId: THREAD_ID, userId: "u_lynn" }, { userId: "u_boss", role: "boss" }));
    ok(h.readUserIds[1] === "u_boss", "读线程同样只按调用者本人");
  }

  console.log("\n不碰组织授权邮箱（源码断言）");
  {
    const mail = read("src/lib/agent-core/tools/mail.ts");
    ok(!/mailboxEmail|fromEmail|settingsJson/.test(code("src/lib/agent-core/tools/mail.ts")) && !/mailboxEmail/.test(code("src/lib/mail-read/pure.ts")), "读信工具与读信模块没有 mailboxEmail / fromEmail / settingsJson 的引用");
    ok(/searchMailbox\(ctx\.userId,/.test(mail) && /getThreadText\(ctx\.userId,/.test(mail), "两个工具都以 ctx.userId 取邮箱");
  }

  console.log("\n搜索：结果字段与上限");
  {
    const h = harness({ gmail: { listIds: Array.from({ length: 10 }, (_, i) => `x${i}`), nextPageToken: "more" } });
    const r = await h.search.execute(ctx({ query: "报价", unreadOnly: true, newerThanDays: 9999 }));
    const d = r.data as { messages: Array<Record<string, unknown>>; resultCount: number; hasMore: boolean; filters: Record<string, unknown> };
    ok(r.success && d.messages.length === 10 && d.resultCount === 10 && d.hasMore === true, "25 封匹配：返回 10 封并标明还有更多");
    ok(JSON.stringify(Object.keys(d.messages[0]).sort()) === '["date","from","labelIds","messageId","snippet","subject","threadId","to"]', "每封只有 8 个元数据字段（没有正文全文）", Object.keys(d.messages[0]));
    ok(d.filters.newerThanDays === 365 && d.filters.unreadOnly === true, "返回里回显实际使用的条件（天数已按上限）");
    const q = String(h.gmail.calls.find((c) => c.api === "messages.list")!.args.q);
    ok(q === 'newer_than:365d is:unread "报价"', "搜索条件", q);
  }

  console.log("\n按客户搜索：地址来自客户档案");
  {
    const h = harness();
    const r = await h.search.execute(ctx({ customerId: "c_mine", query: "报价", email: "attacker@evil.example" }));
    const q = String(h.gmail.calls.find((c) => c.api === "messages.list")!.args.q);
    ok(r.success && q === 'newer_than:30d (from:client@example.com OR to:client@example.com) "报价"', "条件限定为客户档案里的地址（小写）", q);
    ok(!q.includes("attacker"), "工具参数里的地址不被采用");
    ok(JSON.stringify(h.customerLookups) === JSON.stringify([{ customerId: "c_mine", orgId: ORG }]), "客户查询恒带当前组织");
  }

  console.log("\n按客户搜索：看不到的客户");
  {
    const h = harness();
    const hidden = await h.search.execute(ctx({ customerId: "c_theirs" }));
    const missing = await h.search.execute(ctx({ customerId: "c_does_not_exist" }));
    const otherOrg = await h.search.execute(ctx({ customerId: "c_otherorg" }));
    ok(codeOf(hidden) === "MAIL_CUSTOMER_NOT_FOUND" && (hidden.data as { message: string }).message === "客户不存在或无权限", "销售 A 传 B 名下、A 不可见的客户：MAIL_CUSTOMER_NOT_FOUND");
    ok(JSON.stringify(hidden) === JSON.stringify(missing) && JSON.stringify(hidden) === JSON.stringify(otherOrg), "与不存在的 id、别的组织的客户返回完全相同", [hidden, missing, otherOrg]);
    ok(h.gmail.calls.length === 0 && h.audits.length === 0, "三次都没有调用 Gmail，也没有写读信审计");
    const boss = await h.search.execute(ctx({ customerId: "c_theirs" }, { userId: "u_boss", role: "boss" }));
    ok(boss.success === true, "老板（全局可见范围）可按这位客户搜索——搜的仍是老板自己的邮箱");
    ok(h.readUserIds[0] === "u_boss", "读取按老板本人的 userId");
    const noEmail = await h.search.execute(ctx({ customerId: "c_noemail" }));
    ok(codeOf(noEmail) === "MAIL_CUSTOMER_NO_EMAIL", "客户档案没有邮箱：MAIL_CUSTOMER_NO_EMAIL");
  }

  console.log("\n客户作用域不可改选");
  {
    const prev = process.env.MAIL_READ_ENABLED;
    process.env.MAIL_READ_ENABLED = "true";
    const r = await registry.execute("mail_search", ctx({ customerId: "c_theirs" }, { scopeGuard: { orgId: ORG, principalUserId: "u_a", customerId: "c_mine" } }));
    ok(r.success === false && codeOf(r) === "SCOPE_CUSTOMER_OVERRIDE", "作用域为客户 X、参数传客户 Y：被执行前守卫拒绝", r);
    if (prev === undefined) delete process.env.MAIL_READ_ENABLED;
    else process.env.MAIL_READ_ENABLED = prev;
    const h = harness();
    await h.search.execute(ctx({ query: "x" }, { scopeGuard: { orgId: ORG, principalUserId: "u_a", customerId: "c_mine" } }));
    ok(h.customerLookups[0]?.customerId === "c_mine" && String(h.gmail.calls.find((c) => c.api === "messages.list")!.args.q).includes("client@example.com"), "带客户作用域的运行：不传 customerId 也只搜该客户");
    const h2 = harness();
    const r2 = await h2.search.execute(ctx({ customerId: "c_theirs" }, { userId: "u_b", scopeGuard: { orgId: ORG, principalUserId: "u_b", customerId: "c_mine" } }));
    ok(h2.customerLookups[0]?.customerId === "c_mine" && codeOf(r2) === "MAIL_CUSTOMER_NOT_FOUND" && h2.gmail.calls.length === 0, "工具内再兜底：永远采用作用域里的客户，不采用参数");
  }

  console.log("\n读取线程");
  {
    const h = harness();
    const r = await h.readThread.execute(ctx({ threadId: THREAD_ID }));
    const d = r.data as { messages: Array<{ bodyText: string; attachments: unknown[]; from: string; subject: string; truncated: boolean }>; truncated: boolean; messageCount: number };
    ok(r.success && d.messageCount === 2 && d.messages[0].bodyText === BODY_1 && d.messages[1].bodyText === BODY_2 && d.truncated === false, "返回每封的纯文本正文");
    ok(d.messages[1].from === SENDER && d.messages[1].subject === SUBJECT, "带发件人与主题");
    ok(JSON.stringify(d.messages[0].attachments) === '[{"filename":"quote.pdf","mimeType":"application/pdf","size":34567}]', "带 PDF 附件的线程：只有文件名与大小");
    ok(h.gmail.calls.filter((c) => c.api === "attachments.get").length === 0, "附件下载接口调用次数为 0");

    const h404 = harness();
    const notMine = await h404.readThread.execute(ctx({ threadId: "ffffffffffffffff" }));
    const badId = await h404.readThread.execute(ctx({ threadId: "../../etc/passwd" }));
    const empty = await h404.readThread.execute(ctx({}));
    ok(codeOf(notMine) === "MAIL_THREAD_NOT_FOUND" && (notMine.data as { message: string }).message === "线程不存在", "Gmail 返回 404 的线程：MAIL_THREAD_NOT_FOUND");
    ok(JSON.stringify(notMine) === JSON.stringify(badId) && JSON.stringify(badId) === JSON.stringify(empty), "与 id 格式不合法、没传 id 的返回相同");
    ok(h404.gmail.calls.length === 1 && h404.audits.length === 0, "格式不合法的 id 不发请求；都不写读信审计", h404.gmail.calls.length);
  }

  console.log("\n只调用读接口");
  {
    const h = harness();
    await h.search.execute(ctx({ query: "报价" }));
    await h.readThread.execute(ctx({ threadId: THREAD_ID }));
    const apis = [...new Set(h.gmail.calls.map((c) => c.api))].sort();
    ok(JSON.stringify(apis) === '["messages.get","messages.list","threads.get"]', "一次搜索 + 一次读线程：只有列表与读取接口被调用", apis);
  }

  console.log("\n未绑定 / 缺读信权限 / 授权失效 / 服务出错");
  {
    const scopeMissing = harness({ provider: { ...PROVIDER, grantedScopes: GMAIL_COMPOSE_SCOPE } });
    const r1 = await scopeMissing.search.execute(ctx({ query: "x" }));
    const r1b = await scopeMissing.readThread.execute(ctx({ threadId: THREAD_ID }));
    ok(codeOf(r1) === "MAIL_READ_SCOPE_MISSING" && codeOf(r1b) === "MAIL_READ_SCOPE_MISSING" && (r1.data as { settingsHref?: string }).settingsHref === "/settings/email", "只有撰写权限的旧授权：MAIL_READ_SCOPE_MISSING + /settings/email");
    ok(scopeMissing.gmail.calls.length === 0, "Gmail 没有被调用");

    const notConnected = harness({ provider: null });
    const r2 = await notConnected.search.execute(ctx({ query: "x" }));
    ok(codeOf(r2) === "MAIL_NOT_CONNECTED" && (r2.data as { settingsHref?: string }).settingsHref === "/settings/email" && notConnected.gmail.calls.length === 0, "没绑 Gmail（含只绑 SMTP）：MAIL_NOT_CONNECTED + /settings/email");

    const expired = harness({ gmail: { listError: new Error("invalid_grant") } });
    const r3 = await expired.search.execute(ctx({ query: "x" }));
    ok(codeOf(r3) === "MAIL_REAUTH_REQUIRED" && (r3.data as { settingsHref?: string }).settingsHref === "/settings/email", "授权失效（invalid_grant）：MAIL_REAUTH_REQUIRED + /settings/email");

    const down = harness({ gmail: { listError: { code: 503 }, threadError: { code: 503 } } });
    let threw = false;
    const r4 = await down.search.execute(ctx({ query: "x" })).catch(() => ((threw = true), null));
    const r5 = await down.readThread.execute(ctx({ threadId: THREAD_ID })).catch(() => ((threw = true), null));
    ok(!threw && !!r4 && !!r5 && codeOf(r4) === "MAIL_PROVIDER_ERROR" && codeOf(r5) === "MAIL_PROVIDER_ERROR", "Gmail 503：MAIL_PROVIDER_ERROR，工具调用本身不抛异常");
    ok(down.gmail.calls.length === 2 && (r4!.data as { settingsHref?: string }).settingsHref === undefined, "各只调用一次（不重试），不带设置页链接", down.gmail.calls.length);
    ok([r1, r2, r3, r4!].every((r) => r.success === false && down.audits.length === 0 && scopeMissing.audits.length === 0), "失败的调用不写读信审计");
  }

  console.log("\n返回带不可信标记");
  {
    const h = harness();
    const s = (await h.search.execute(ctx({ query: "x" }))).data as Record<string, unknown>;
    const t = (await h.readThread.execute(ctx({ threadId: THREAD_ID }))).data as Record<string, unknown>;
    ok(s.untrusted === true && s.source === "gmail" && t.untrusted === true && t.source === "gmail", "两个成功返回的顶层都有 untrusted: true 与 source: \"gmail\"");
    ok(s.mailbox === "self" && t.mailbox === "self", "返回里写明读的是本人邮箱");
    const err = (await harness({ provider: null }).search.execute(ctx({}))).data as Record<string, unknown>;
    ok(!("untrusted" in err) && !("messages" in err), "错误返回不带邮件字段");
  }

  console.log("\n审计：只记元数据");
  {
    const h = harness();
    await h.search.execute(ctx({ query: "百叶窗 报价", customerId: "c_mine", newerThanDays: 14, unreadOnly: true }));
    await h.readThread.execute(ctx({ threadId: THREAD_ID }));
    ok(h.audits.length === 2 && h.audits[0].action === "mail.read.search" && h.audits[1].action === "mail.read.thread", "mail.read.search 与 mail.read.thread 各一条");
    const a0 = h.audits[0];
    const a1 = h.audits[1];
    ok(a0.userId === "u_a" && a0.orgId === ORG && a0.targetId === null && a0.data.resultCount === 2 && typeof a0.data.returnedChars === "number" && (a0.data.returnedChars as number) > 0, "搜索审计：调用者、组织、命中封数、返回字数", a0);
    ok(JSON.stringify(a0.data.keywords) === '["百叶窗","报价"]' && a0.data.customerId === "c_mine" && a0.data.newerThanDays === 14 && a0.data.unreadOnly === true, "搜索审计：查询条件");
    ok(a1.targetId === THREAD_ID && a1.data.threadId === THREAD_ID && a1.data.messageCount === 2 && a1.data.returnedChars === BODY_1.length + BODY_2.length, "读线程审计：线程 id、封数、返回字数", a1);
    const dump = JSON.stringify(h.audits);
    const secrets = [BODY_1, BODY_2, BODY_2.slice(0, 12), SUBJECT, SENDER, "client@example.com", "quote.pdf", "lynn@sunny.example"];
    ok(secrets.every((s) => !dump.includes(s)), "正文、摘要、主题、发件人、客户地址、附件名都不在审计里", secrets.filter((s) => dump.includes(s)));
    ok(JSON.stringify(Object.keys(a0.data).sort()) === '["customerId","hasMore","keywords","newerThanDays","resultCount","returnedChars","unreadOnly"]' && JSON.stringify(Object.keys(a1.data).sort()) === '["messageCount","returnedChars","threadId","truncated"]', "审计字段是固定的元数据清单");
  }

  console.log("\n审计失败不给内容");
  {
    const h = harness({ auditThrows: true });
    const r = await h.search.execute(ctx({ query: "x" }));
    const r2 = await h.readThread.execute(ctx({ threadId: THREAD_ID }));
    ok(codeOf(r) === "MAIL_AUDIT_FAILED" && codeOf(r2) === "MAIL_AUDIT_FAILED" && r.success === false, "审计写入抛错：MAIL_AUDIT_FAILED");
    const dump = JSON.stringify([r, r2]);
    ok(![BODY_1, BODY_2, SUBJECT, "client@example.com", "messages"].some((s) => dump.includes(s)), "返回里没有任何邮件字段", dump);
  }

  console.log("\n读信模块没有其它写入（源码断言）");
  {
    const mail = code("src/lib/agent-core/tools/mail.ts");
    const pure = code("src/lib/mail-read/pure.ts");
    const writes = mail.match(/\bdb\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g) ?? [];
    ok(writes.length === 0 && (mail.match(/writeAuditLog\(/g) ?? []).length === 1, "数据库写入只有审计一处（writeAuditLog）", writes);
    ok((mail.match(/\bdb\.\w+\.\w+\(/g) ?? []).join() === "db.salesCustomer.findFirst(", "唯一的数据库读取是按 id + 组织取客户", mail.match(/\bdb\.\w+\.\w+\(/g));
    ok(!/console\.|logger\./.test(mail) && !/console\.|logger\.|\bdb\b/.test(pure), "没有日志语句；纯函数模块不碰数据库");
    ok(!/runSimple|runAgent|openai|createChat|getClient|embedding/i.test(mail + pure), "没有模型调用");
    ok(!/notification|sendWechat|pushTo|sendGmail|createGmailDraft/i.test(mail + pure), "不发通知、不推送、不发信、不建草稿");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
