/**
 * MAIL-1 助手只读读信 —— 纯函数与读接口（spec mail/assistant-read；change mail-read-tools）
 * 无真实 Google、无数据库：Gmail 用注入的假实现。
 * 运行：npx tsx src/lib/mail-read/__tests__/mail-read-pure.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_MESSAGE_CHAR_LIMIT,
  MAIL_THREAD_CHAR_LIMIT,
  MAIL_VERBATIM_OMITTED,
  applyThreadBudget,
  buildMailSearchQuery,
  clampNewerThanDays,
  classifyGmailError,
  clipText,
  customerEmailAddresses,
  isValidGmailId,
  literalKeywords,
  mailBodiesFromToolData,
  mailIntentForcesTools,
  mailReadError,
  mailReadPanelState,
  mentionsMailbox,
  redactVerbatimMail,
  withMailReadStatus,
} from "../pure";
import {
  EMAIL_SCOPES,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  MailboxReadError,
  getThreadText,
  isMailReadEnabled,
  searchMailbox,
  type GmailReadApi,
  type GmailReadDeps,
} from "@/lib/google-email";

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
const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

// ── 假 Gmail ────────────────────────────────────────────────

type Call = { api: string; args: Record<string, unknown> };
function fakeGmail(opts: {
  listIds?: string[];
  nextPageToken?: string;
  threads?: Record<string, unknown>;
  threadError?: { code: number };
}): { api: GmailReadApi; calls: Call[] } {
  const calls: Call[] = [];
  const forbidden = (api: string) => async (args: Record<string, unknown>) => {
    calls.push({ api, args });
    throw new Error(`不应调用 ${api}`);
  };
  const api = {
    users: {
      getProfile: forbidden("getProfile"),
      history: { list: forbidden("history.list") },
      threads: {
        get: async (args: { id: string; format?: string }) => {
          calls.push({ api: "threads.get", args });
          if (opts.threadError) throw opts.threadError;
          const t = opts.threads?.[args.id];
          if (!t) throw { code: 404 };
          return { data: t };
        },
      },
      messages: {
        list: async (args: Record<string, unknown>) => {
          calls.push({ api: "messages.list", args });
          return {
            data: {
              messages: (opts.listIds ?? []).map((id) => ({ id, threadId: `t${id}` })),
              nextPageToken: opts.nextPageToken ?? null,
            },
          };
        },
        get: async (args: { id: string; format?: string }) => {
          calls.push({ api: "messages.get", args });
          return {
            data: {
              id: args.id,
              threadId: `t${args.id}`,
              labelIds: ["INBOX", "UNREAD"],
              internalDate: String(Date.UTC(2026, 10, 10, 15, 0, 0)),
              snippet: `摘要-${args.id}`,
              payload: {
                headers: [
                  { name: "From", value: "王总 <client@example.com>" },
                  { name: "To", value: "lynn@sunny.example" },
                  { name: "Subject", value: `主题-${args.id}` },
                ],
              },
            },
          };
        },
        attachments: { get: forbidden("attachments.get") },
      },
    },
  } as unknown as GmailReadApi;
  return { api, calls };
}

const READ_OK = `${GMAIL_COMPOSE_SCOPE} ${GMAIL_READONLY_SCOPE}`;
function deps(api: GmailReadApi, provider: Record<string, unknown> | null): GmailReadDeps {
  return {
    getProvider: (async () => provider) as unknown as GmailReadDeps["getProvider"],
    getGmail: async () => api,
  };
}
const PROVIDER = { id: "p1", accessToken: "enc", refreshToken: null, tokenExpiry: null, grantedScopes: READ_OK };

async function main() {
  console.log("mail-read-pure（查询拼装 / 截断 / 开关 / 原文省略 / 读接口）");

  console.log("\n天数缺省与上限");
  ok(clampNewerThanDays(undefined) === 30, "不传：30 天");
  ok(clampNewerThanDays(9999) === 365, "9999：按 365");
  ok(clampNewerThanDays(0) === 1 && clampNewerThanDays(-5) === 1, "0 与负数：按 1");
  ok(clampNewerThanDays("14") === 14 && clampNewerThanDays("abc") === 30, "字符串数字可用；非数字按缺省");
  ok(buildMailSearchQuery({}) === "newer_than:30d", "空条件只有时间范围", buildMailSearchQuery({}));
  ok(buildMailSearchQuery({ newerThanDays: 9999 }).startsWith("newer_than:365d"), "条件里的时间范围随上限");
  ok(buildMailSearchQuery({ newerThanDays: 0 }).startsWith("newer_than:1d"), "条件里的时间范围随下限");

  console.log("\n关键词不当作运算符");
  {
    const q = buildMailSearchQuery({ query: 'in:spam from:boss@example.com "报价"' });
    ok(q === 'newer_than:30d "in spam" "from boss@example.com" "报价"', "每个词加引号、冒号换空格", q);
    ok(!/(^|[\s(])(in|from|to|label|is|has|category):/.test(q.replace("newer_than:30d", "")), "没有由 query 带入的运算符", q);
    ok(JSON.stringify(literalKeywords("a  b\tc")) === '["a","b","c"]', "按空白切词");
    ok(literalKeywords('x") OR (in:anywhere').every((w) => !/["()]/.test(w)), "引号与括号被去掉", literalKeywords('x") OR (in:anywhere'));
    ok(literalKeywords("一 二 三 四 五 六 七 八 九 十 十一 十二").length === 10, "最多 10 个词");
    ok(literalKeywords("x".repeat(500)).join("").length === 200, "关键词原文截 200 字");
    ok(literalKeywords(undefined).length === 0 && literalKeywords(42).length === 0, "非字符串：无关键词");
  }

  console.log("\n客户地址条件与未读");
  {
    const q = buildMailSearchQuery({ customerEmails: ["client@example.com"], unreadOnly: true, query: "报价", newerThanDays: 7 });
    ok(q === 'newer_than:7d (from:client@example.com OR to:client@example.com) is:unread "报价"', "地址条件由服务端生成", q);
    ok(!buildMailSearchQuery({ unreadOnly: "true" }).includes("is:unread"), "unreadOnly 只认布尔 true");
    ok(!buildMailSearchQuery({ customerEmails: ["x) OR in:spam"] }).includes("in:spam"), "不合法的地址被丢弃");
    ok(JSON.stringify(customerEmailAddresses(" Client@Example.com ; b@y.co ")) === '["client@example.com","b@y.co"]', "客户邮箱字段：小写、可多个");
    ok(customerEmailAddresses("没有邮箱").length === 0 && customerEmailAddresses(null).length === 0, "不是地址：空");
    ok(customerEmailAddresses("a@x.co b@x.co c@x.co d@x.co").length === 3, "最多 3 个地址");
  }

  console.log("\n线程 id 格式");
  ok(isValidGmailId("18c2f0a9b7d1e234") && !isValidGmailId("../etc") && !isValidGmailId("") && !isValidGmailId(123), "只接受十六进制 id");

  console.log("\n单封与整线程截断");
  {
    const one = applyThreadBudget([{ bodyText: "字".repeat(9000) }]);
    ok(one.messages[0].bodyText.length === MAIL_MESSAGE_CHAR_LIMIT && one.messages[0].truncated && one.truncated, "9,000 字的单封：6,000 字且标 truncated");
    const short = applyThreadBudget([{ bodyText: "短信" }]);
    ok(short.messages[0].bodyText === "短信" && !short.messages[0].truncated && !short.truncated && short.returnedChars === 2, "短邮件：原样、不标");
    const thread = applyThreadBudget(Array.from({ length: 10 }, (_, i) => ({ id: i, bodyText: String(i).repeat(5000) })));
    const total = thread.messages.reduce((n, m) => n + m.bodyText.length, 0);
    ok(total <= MAIL_THREAD_CHAR_LIMIT && total === thread.returnedChars, "50,000 字的线程：合计不超过 20,000 字", total);
    ok(thread.messages[9].bodyText.length === 5000 && !thread.messages[9].bodyOmitted, "最新一封保留正文");
    ok(thread.messages[0].bodyOmitted && thread.messages[0].bodyText === "" && thread.messages[0].id === 0, "最旧的只留元数据（顺序不变）");
    ok(thread.truncated, "线程一级标 truncated");
    ok(clipText("a😀", 2) === "a", "不把代理对切成两半");
  }

  console.log("\n错误码");
  {
    ok(JSON.stringify(mailReadError("MAIL_NOT_CONNECTED").settingsHref) === '"/settings/email"', "未绑定：带 /settings/email");
    ok(mailReadError("MAIL_READ_SCOPE_MISSING").settingsHref === "/settings/email" && mailReadError("MAIL_REAUTH_REQUIRED").settingsHref === "/settings/email", "缺权限 / 失效：带 /settings/email");
    ok(mailReadError("MAIL_THREAD_NOT_FOUND").message === "线程不存在" && mailReadError("MAIL_THREAD_NOT_FOUND").settingsHref === undefined, "线程不存在：统一文案、不带链接");
    ok(mailReadError("MAIL_CUSTOMER_NOT_FOUND").message === "客户不存在或无权限", "客户：统一文案");
    ok(classifyGmailError({ code: 503 }) === "MAIL_PROVIDER_ERROR", "503 → MAIL_PROVIDER_ERROR");
    ok(classifyGmailError(new Error("invalid_grant")) === "MAIL_REAUTH_REQUIRED" && classifyGmailError({ code: 401 }) === "MAIL_REAUTH_REQUIRED", "invalid_grant / 401 → MAIL_REAUTH_REQUIRED");
    ok(classifyGmailError({ code: 403, message: "Request had insufficient authentication scopes." }) === "MAIL_READ_SCOPE_MISSING", "403 scope 不足 → MAIL_READ_SCOPE_MISSING");
    ok(classifyGmailError({ code: 403, message: "rate limit" }) === "MAIL_PROVIDER_ERROR" && classifyGmailError(null) === "MAIL_PROVIDER_ERROR", "其它 → MAIL_PROVIDER_ERROR");
  }

  console.log("\n开关解析（MAIL_READ_ENABLED，默认关）");
  {
    const base = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const off = [undefined, "", "false", "0"].map((v) => isMailReadEnabled({ ...base, ...(v === undefined ? {} : { MAIL_READ_ENABLED: v }) }));
    ok(off.every((x) => x === false), "未设置 / 空串 / false / 0：关", off);
    ok(isMailReadEnabled({ ...base, MAIL_READ_ENABLED: "true" }) && isMailReadEnabled({ ...base, MAIL_READ_ENABLED: "1" }), "true / 1：开");
    ok(!isMailReadEnabled({ ...base, MAIL_READ_ENABLED: "true", QINGYAN_RUNTIME_ENV: "test", VERCEL_ENV: "production" }), "运行环境隔离评估不通过：关");
    ok(/export function isMailReadAllowed[\s\S]{0,260}assessRuntimeIsolation\(env\)[\s\S]{0,120}envFlag\("MAIL_READ_ENABLED", env\)/.test(read("src/lib/env/runtime-isolation.ts")), "与 Gmail Draft 同一处解析（runtime-isolation）");
  }

  console.log("\n读信意图");
  {
    ok(mentionsMailbox("帮我找上周供应商那封信") && mentionsMailbox("王总回邮件了吗") && mentionsMailbox("check my Inbox"), "那封信 / 邮件 / inbox 命中");
    ok(!mentionsMailbox("发个微信给他") && !mentionsMailbox("我相信这个信息"), "「微信」「相信」「信息」不命中");
    ok(mailIntentForcesTools(true, "帮我找上周供应商那封信") && mailIntentForcesTools(true, "王总回邮件了吗") && mailIntentForcesTools(true, "看看收件箱"), "读信可用 + 提到邮箱：带工具");
    ok(!mailIntentForcesTools(false, "帮我润色这封邮件") && !mailIntentForcesTools(undefined, "帮我润色这封邮件"), "读信不可用：这些词不改变路由");
    ok(!mailIntentForcesTools(true, "今天天气怎么样"), "读信可用但没提邮箱：不强制");
  }

  console.log("\n助手回复落库前省略长段邮件原文");
  {
    const body = Array.from({ length: 30 }, (_, i) => `第${i}段：我们确认周五上午十点上门测量，请提前把窗台清空。`).join("\n");
    const verbatim = body.slice(0, 300);
    const reply = `王总的原话如下：\n\n${verbatim}\n\n总结：他确认了周五上门。`;
    const r = redactVerbatimMail(reply, [body]);
    ok(r.redactedSegments === 1 && r.text.includes(MAIL_VERBATIM_OMITTED), "300 字原文：被替换为省略标记", r.text.slice(0, 80));
    ok(r.text.startsWith("王总的原话如下：") && r.text.endsWith("总结：他确认了周五上门。"), "前后的转述原样保留", r.text);
    ok(!r.text.includes("请提前把窗台清空。\n第1段"), "落库版本里没有那段原文");
    const quoted = `> ${verbatim.split("\n").join("\n> ")}`;
    ok(redactVerbatimMail(quoted, [body]).redactedSegments === 1, "逐行加引用符、换了换行：仍识别为原文");
    const shortQuote = `他说：「${body.slice(0, 60)}」`;
    ok(redactVerbatimMail(shortQuote, [body]).text === shortQuote, "60 字的短引用：原样保留");
    ok(redactVerbatimMail("完全是转述，没有照抄。".repeat(30), [body]).redactedSegments === 0, "转述：不动");
    ok(redactVerbatimMail(reply, []).text === reply && redactVerbatimMail("", [body]).text === "", "没读过邮件 / 空回复：原样");
    const two = `${body.slice(0, 200)}\n中间是转述。\n${body.slice(400, 620)}`;
    ok(redactVerbatimMail(two, [body]).redactedSegments === 2 && redactVerbatimMail(two, [body]).text.includes("中间是转述。"), "两段原文：各自省略，中间保留");
    ok(JSON.stringify(mailBodiesFromToolData({ untrusted: true, source: "gmail", messages: [{ bodyText: "a" }, { bodyText: "" }, { subject: "x" }] })) === '["a"]', "从读信返回里取正文");
    ok(mailBodiesFromToolData({ messages: [{ bodyText: "a" }] }).length === 0 && mailBodiesFromToolData(null).length === 0, "不是读信返回：不取");
  }

  console.log("\n读接口：搜索（注入假 Gmail）");
  {
    const g = fakeGmail({ listIds: ["a1", "a2", "a3"] });
    const res = await searchMailbox("u1", { query: "newer_than:30d" }, deps(g.api, PROVIDER));
    ok(res.messages.length === 3 && res.hasMore === false, "返回 3 封，没有更多");
    const m = res.messages[0];
    ok(m.messageId === "a1" && m.threadId === "ta1" && m.from.includes("client@example.com") && m.subject === "主题-a1" && m.snippet === "摘要-a1" && m.labelIds.includes("UNREAD") && m.date === "2026-11-10T15:00:00.000Z", "每封：id / 线程 / 发件人 / 主题 / 摘要 / 标签 / 日期", m);
    const list = g.calls.find((c) => c.api === "messages.list")!;
    ok(list.args.q === "newer_than:30d" && list.args.maxResults === 10 && !("includeSpamTrash" in list.args), "messages.list：带查询串、上限 10、不含垃圾邮件与已删除");
    ok(g.calls.filter((c) => c.api === "messages.get").every((c) => c.args.format === "metadata"), "逐封只取元数据（format=metadata）");
    ok(g.calls.every((c) => c.api === "messages.list" || c.api === "messages.get"), "只调用列表与读取接口", g.calls.map((c) => c.api));

    const many = fakeGmail({ listIds: Array.from({ length: 10 }, (_, i) => `b${i}`), nextPageToken: "next" });
    const r2 = await searchMailbox("u1", { query: "x", maxResults: 99 }, deps(many.api, PROVIDER));
    ok(r2.messages.length === 10 && r2.hasMore === true, "25 封匹配：返回 10 封并标明还有更多");
    ok(many.calls.find((c) => c.api === "messages.list")!.args.maxResults === 10, "maxResults 传 99 也按 10");
  }

  console.log("\n读接口：线程（注入假 Gmail）");
  {
    const thread = {
      messages: [
        {
          id: "c1",
          labelIds: ["SENT"],
          internalDate: String(Date.UTC(2026, 10, 9, 15, 0, 0)),
          payload: {
            mimeType: "multipart/mixed",
            headers: [{ name: "From", value: "lynn@sunny.example" }, { name: "To", value: "client@example.com" }, { name: "Subject", value: "报价" }],
            parts: [
              { mimeType: "text/plain", body: { data: b64("您好，报价见附件。") } },
              { mimeType: "application/pdf", filename: "quote.pdf", body: { attachmentId: "att1", size: 34567 } },
            ],
          },
        },
        {
          id: "c2",
          labelIds: ["INBOX"],
          internalDate: String(Date.UTC(2026, 10, 10, 15, 0, 0)),
          payload: {
            mimeType: "text/html",
            headers: [{ name: "From", value: "client@example.com" }, { name: "Subject", value: "Re: 报价" }],
            body: { data: b64("<p>周五<b>上门</b>可以</p><script>x()</script>") },
          },
        },
      ],
    };
    const g = fakeGmail({ threads: { "18c2f0a9b7d1e234": thread } });
    const res = await getThreadText("u1", "18c2f0a9b7d1e234", deps(g.api, PROVIDER));
    ok(!!res && res.messages.length === 2 && res.truncated === false, "两封都返回");
    ok(res!.messages[0].bodyText === "您好，报价见附件。" && res!.messages[1].bodyText === "周五上门可以", "纯文本优先；只有 HTML 时去标签", res!.messages.map((m) => m.bodyText));
    ok(JSON.stringify(res!.messages[0].attachments) === '[{"filename":"quote.pdf","mimeType":"application/pdf","size":34567}]', "附件只列文件名与大小", res!.messages[0].attachments);
    ok(g.calls.length === 1 && g.calls[0].api === "threads.get" && g.calls[0].args.format === "full", "一次 threads.get(format=full)，附件下载接口调用 0 次", g.calls.map((c) => c.api));
    ok(res!.returnedChars === "您好，报价见附件。".length + "周五上门可以".length, "returnedChars 为正文合计字数");

    const missing = await getThreadText("u1", "ffffffffffffffff", deps(g.api, PROVIDER));
    ok(missing === null, "Gmail 返回 404：null（按线程不存在处理）");
    const boom = fakeGmail({ threadError: { code: 503 } });
    let thrown: unknown = null;
    await getThreadText("u1", "18c2f0a9b7d1e234", deps(boom.api, PROVIDER)).catch((e) => (thrown = e));
    ok((thrown as { code?: number } | null)?.code === 503 && boom.calls.length === 1, "503：原样抛出，只调用一次（不重试）");

    const long = { messages: [{ id: "d1", payload: { mimeType: "text/plain", headers: [], body: { data: b64("x".repeat(9000)) } } }] };
    const lg = fakeGmail({ threads: { "aaaaaaaaaaaaaaaa": long } });
    const lr = await getThreadText("u1", "aaaaaaaaaaaaaaaa", deps(lg.api, PROVIDER));
    ok(lr!.messages[0].bodyText.length === 6000 && lr!.messages[0].truncated && lr!.truncated, "9,000 字的邮件：读接口返回 6,000 字并标 truncated");
  }

  console.log("\n读接口：未绑定 / 缺读信权限（在调用 Gmail 之前失败）");
  {
    const g = fakeGmail({ listIds: ["a1"] });
    const expectCode = async (provider: Record<string, unknown> | null, code: string, label: string) => {
      let err: unknown = null;
      await searchMailbox("u1", { query: "x" }, deps(g.api, provider)).catch((e) => (err = e));
      let err2: unknown = null;
      await getThreadText("u1", "18c2f0a9b7d1e234", deps(g.api, provider)).catch((e) => (err2 = e));
      ok(err instanceof MailboxReadError && err.code === code && err2 instanceof MailboxReadError && err2.code === code, label, [String(err), String(err2)]);
    };
    await expectCode(null, "MAIL_NOT_CONNECTED", "没有 Gmail 绑定：MAIL_NOT_CONNECTED");
    await expectCode({ ...PROVIDER, grantedScopes: GMAIL_COMPOSE_SCOPE }, "MAIL_READ_SCOPE_MISSING", "只有撰写权限：MAIL_READ_SCOPE_MISSING");
    await expectCode({ ...PROVIDER, grantedScopes: null }, "MAIL_READ_SCOPE_MISSING", "没有 scope 记录：MAIL_READ_SCOPE_MISSING");
    ok(g.calls.length === 0, "以上都没有调用 Gmail", g.calls.length);
  }

  console.log("\n授权范围没有变宽（源码断言）");
  {
    ok(JSON.stringify(EMAIL_SCOPES) === JSON.stringify([GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE, "https://www.googleapis.com/auth/userinfo.email"]), "申请的范围仍是撰写、只读与账号邮箱三项");
    const src = read("src/lib/google-email.ts");
    const section = src.slice(src.indexOf("// ── 助手只读读信"), src.indexOf("// ── MIME 构建"));
    ok(section.length > 500, "读信段落存在");
    ok(!/attachments\.get|messages\.(send|modify|trash|delete|batchModify)|drafts\.|labels\.|threads\.(modify|trash|delete)/.test(section), "读信段落只调用列表与读取接口");
    ok(!/console\.|logger\./.test(section) && !/\bdb\./.test(section), "读信段落不打日志、不直接写库");
    ok(!/mailboxEmail/.test(section) && !/mailboxEmail/.test(read("src/lib/mail-read/pure.ts")), "不碰组织授权邮箱 mailboxEmail");
  }

  console.log("\n邮件绑定状态里的读信字段");
  {
    const before = { gmail: { connected: true as const, email: "l@x.co", hasComposeScope: true }, smtp: { configured: false as const }, activeChannel: "gmail" as const };
    const off = withMailReadStatus(before, { enabled: false, hasReadScope: true });
    ok(off === before && !("mailRead" in off) && !("hasReadScope" in off.gmail), "开关关：响应与上线前逐字段相同");
    const on = withMailReadStatus(before, { enabled: true, hasReadScope: false }) as { gmail: { hasReadScope?: boolean }; mailRead?: { enabled: boolean } };
    ok(on.gmail.hasReadScope === false && on.mailRead?.enabled === true, "开关开 + 只有撰写权限：hasReadScope=false、mailRead.enabled=true");
    const on2 = withMailReadStatus(before, { enabled: true, hasReadScope: true }) as { gmail: { hasReadScope?: boolean } };
    ok(on2.gmail.hasReadScope === true, "开关开 + 含只读权限：hasReadScope=true");
    const disconnected = { gmail: { connected: false as const }, smtp: { configured: true as const }, activeChannel: "smtp" as const };
    const d = withMailReadStatus(disconnected, { enabled: true, hasReadScope: false }) as { gmail: Record<string, unknown>; mailRead?: { enabled: boolean } };
    ok(!("hasReadScope" in d.gmail) && d.mailRead?.enabled === true, "未连接 Gmail：不加 hasReadScope，只有 mailRead.enabled");
    ok(mailReadPanelState(off) === "hidden" && mailReadPanelState(null) === "hidden", "页面：开关关不显示");
    ok(mailReadPanelState(on) === "needs_reauth" && mailReadPanelState(on2) === "enabled" && mailReadPanelState(d) === "needs_google", "页面：未开启+重新授权 / 已开启 / 读信需要 Google 授权");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
