/**
 * P1-7 催单执行器 — 注入假 Gmail，验证线程回复头（任务书 §4-9、§4-10；邮箱拆分：用 mailboxEmail 查授权账号）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/chase-execute.test.ts
 */
import assert from "node:assert/strict";
import { buildRawEmail, sendGmail, type GmailSendApi } from "@/lib/google-email";
import { execTenderSendChase, type ChaseExecuteIo } from "../chase-execute";
import { formatChaseNote, hashChaseBody, parseChaseNotes } from "../chase-pure";
import { formatRfqContactNotes } from "../inbound-contract";
import type { TenderSendChasePayload } from "../types";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-25T12:00:00Z");
const ORIGINAL_MSGID = "<CAF=rfq-original@mail.gmail.com>";
const RFQ_NOTES = formatRfqContactNotes("gm-rfq-1", "th-1", new Date("2026-10-21T09:00:00Z"));
const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function payload(o: Partial<TenderSendChasePayload> = {}): TenderSendChasePayload {
  const base = {
    projectId: "p1",
    inquiryId: "inq-1",
    inquiryItemId: "i-A",
    supplierName: "A 工厂",
    to: "sales@a.example",
    kind: "no_reply" as const,
    chaseIndex: 1 as const,
    threadId: "th-1",
    originalSubject: "询价：RCMP 战术背包",
    subject: "Re: 询价：RCMP 战术背包",
    body: "A 工厂 您好：\n\n我们 10 月 21 日的询价还没收到贵司报价，回复截止 2026-11-07，请问是否能报？\n\nQyan-Sunny Purchasing",
    fromName: "Qyan-Sunny Purchasing",
    fromEmail: "project@sunnyshutter.ca",
    ...o,
  };
  return { ...base, bodyHash: o.bodyHash ?? hashChaseBody(base) };
}

type World = { notes: string | null; status: string; sends: Array<{ userId: string; requestBody: { raw: string; threadId?: string } }>; lookups: string[] };

/** 执行器 io：真实 sendGmail + 注入的假 Gmail 客户端（验证 threadId 真的传到了 messages.send） */
function makeIo(w: World, opts: { messageIdHeader?: string | null; mailboxEmail?: string } = {}): Partial<ChaseExecuteIo> {
  const gmail: GmailSendApi = {
    users: {
      messages: {
        send: async (args) => {
          w.sends.push(args as World["sends"][number]);
          return { data: { id: `gm-chase-${w.sends.length}`, threadId: args.requestBody.threadId ?? "new-thread" } };
        },
      },
    },
  };
  return {
    now: () => NOW,
    loadProject: async () => ({
      orgId: "org_1",
      settingsJson: { tenderRfq: { fromEmail: "project@sunnyshutter.ca", ...(opts.mailboxEmail ? { mailboxEmail: opts.mailboxEmail } : {}) } },
    }),
    loadItem: async () => ({ status: w.status, contactNotes: w.notes, inquiryId: "inq-1" }),
    findProviders: async (email) => {
      w.lookups.push(email);
      return [
        { userId: "u-lucas", accountEmail: "lucas@sunnyshutter.ca", grantedScopes: "gmail.compose gmail.readonly" },
        { userId: "u-project", accountEmail: "project@sunnyshutter.ca", grantedScopes: "gmail.compose gmail.readonly" },
      ].filter((p) => p.accountEmail === email);
    },
    hasComposeScope: (s) => !!s && s.includes("gmail.compose"),
    getMessageIdHeader: async (_u, id) => (id === "gm-rfq-1" ? opts.messageIdHeader ?? null : null),
    send: (userId, params) =>
      sendGmail(userId, params, {
        getProvider: async () => ({ id: "prov", accessToken: "x", refreshToken: null, tokenExpiry: null }) as never,
        getGmail: async () => gmail,
      }),
    saveContactNotes: async (_id, notes) => {
      w.notes = notes;
    },
  };
}
const world = (o: Partial<World> = {}): World => ({ notes: RFQ_NOTES, status: "sent", sends: [], lookups: [], ...o });

async function main() {
  // sendGmail 有 assertSideEffectOrThrow("email")：本测试只打假 Gmail，显式放行
  const prevAllow = process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD;
  process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD = "1";
  try {
    console.log("tender-rfq chase execute");

    /* buildRawEmail：线程回复头 */
    {
      const raw = decodeRaw(buildRawEmail({ to: "a@x.com", from: "p@x.com", subject: "Re: s", body: "b", inReplyTo: ORIGINAL_MSGID }));
      ok("buildRawEmail 输出含 In-Reply-To", raw.includes(`In-Reply-To: ${ORIGINAL_MSGID}\r\n`));
      ok("buildRawEmail 输出含 References（缺省同 In-Reply-To）", raw.includes(`References: ${ORIGINAL_MSGID}\r\n`));
      const plain = decodeRaw(buildRawEmail({ to: "a@x.com", from: "p@x.com", subject: "s", body: "b" }));
      ok("不是线程回复时不加这两个头", !plain.includes("In-Reply-To") && !plain.includes("References"));
      const inj = decodeRaw(buildRawEmail({ to: "a@x.com", from: "p@x.com", subject: "s", body: "b", inReplyTo: "<a@b>\r\nBcc: evil@x.com" }));
      ok("头值里的换行被去掉（防头注入）", !/\r\nBcc:/.test(inj));
    }

    /* §4-9 */
    {
      const w = world();
      const r = await execTenderSendChase(payload(), { userId: "u-approver", role: "org_admin", orgId: "org_1" }, makeIo(w, { messageIdHeader: ORIGINAL_MSGID }));
      ok("§4-9 执行成功", r.ok, r);
      ok("§4-9 messages.send 收到 threadId", w.sends.length === 1 && w.sends[0].requestBody.threadId === "th-1");
      const raw = decodeRaw(w.sends[0].requestBody.raw);
      ok("§4-9 原始 Message-ID 存在时头里有 In-Reply-To / References", raw.includes(`In-Reply-To: ${ORIGINAL_MSGID}`) && raw.includes(`References: ${ORIGINAL_MSGID}`));
      ok("§4-9 From 仍是显示地址 project@，Reply-To 也是", raw.includes('From: "Qyan-Sunny Purchasing" <project@sunnyshutter.ca>') && raw.includes("Reply-To: project@sunnyshutter.ca"));
      const notes = parseChaseNotes(w.notes);
      ok("§4-9 contactNotes 追加 chase#1 messageId=…", notes.length === 1 && notes[0].index === 1 && notes[0].messageId === "gm-chase-1" && w.notes!.startsWith(RFQ_NOTES));

      const w2 = world();
      const r2 = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_1" }, makeIo(w2, { messageIdHeader: null }));
      const raw2 = decodeRaw(w2.sends[0].requestBody.raw);
      ok("§4-9 取不到原 Message-ID → 仍发出，只带 threadId", r2.ok && w2.sends[0].requestBody.threadId === "th-1" && !raw2.includes("In-Reply-To"));
      ok("§4-9 取不到原 Message-ID → notes 注明", w2.notes!.includes("未取到原 Message-ID") && (r2.message ?? "").includes("仅按 threadId 归线程"));
    }

    /* §4-10 */
    {
      const w = world();
      const tampered = { ...payload(), body: "改过的正文" };
      const r = await execTenderSendChase(tampered, { userId: "u", role: null, orgId: "org_1" }, makeIo(w));
      ok("§4-10 bodyHash 不一致 → 拒绝，且没有发信", !r.ok && r.errorCode === "CHASE_PAYLOAD_TAMPERED" && w.sends.length === 0);
    }

    /* 邮箱拆分：用组织配置的 mailboxEmail 查授权账号（不信 payload.fromEmail） */
    {
      const w = world();
      const r = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_1" }, makeIo(w, { mailboxEmail: "lucas@sunnyshutter.ca" }));
      ok("邮箱拆分：按 mailboxEmail（lucas@）查授权账号", r.ok && w.lookups.join() === "lucas@sunnyshutter.ca");
      ok("邮箱拆分：From 仍显示 project@", decodeRaw(w.sends[0].requestBody.raw).includes("<project@sunnyshutter.ca>"));
    }

    /* 重放 / 过时保护 */
    {
      const replied = world({ status: "replied" });
      const r = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_1" }, makeIo(replied));
      ok("批准时对方已回复 → 不发催单", r.ok && replied.sends.length === 0 && (r.message ?? "").includes("已回复"));
      const again = world({ notes: `${RFQ_NOTES}\n${formatChaseNote({ index: 1, kind: "no_reply", messageId: "gm-old", at: NOW })}` });
      const r2 = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_1" }, makeIo(again));
      ok("同一次催单已发过 → 不重复发", r2.ok && again.sends.length === 0);
      const noThread = world();
      const r3 = await execTenderSendChase(payload({ threadId: "" }), { userId: "u", role: null, orgId: "org_1" }, makeIo(noThread));
      ok("没有 threadId → 拒绝发信", !r3.ok && noThread.sends.length === 0);
      const otherThread = world({ notes: formatRfqContactNotes("gm-rfq-1", "th-OTHER", NOW) });
      const r4 = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_1" }, makeIo(otherThread));
      ok("线程与审批时不一致 → 拒绝", !r4.ok && r4.errorCode === "CHASE_THREAD_MISMATCH" && otherThread.sends.length === 0);
      const cross = await execTenderSendChase(payload(), { userId: "u", role: null, orgId: "org_OTHER" }, makeIo(world()));
      ok("跨组织 → 拒绝", !cross.ok && cross.errorCode === "CROSS_ORG");
      const mf = world({ status: "sent" });
      const r5 = await execTenderSendChase(payload({ kind: "missing_fields" }), { userId: "u", role: null, orgId: "org_1" }, makeIo(mf));
      ok("追问只对 replied / quoted 发", !r5.ok && mf.sends.length === 0);
    }
  } finally {
    if (prevAllow === undefined) delete process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD;
    else process.env.QINGYAN_ALLOW_REAL_EMAIL_NON_PROD = prevAllow;
  }

  console.log(`\ntender-rfq chase execute: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
