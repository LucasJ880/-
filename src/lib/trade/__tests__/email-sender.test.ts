/**
 * 组织发件身份：校验 / 发送顺序 / 域名未验证时代发 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/email-sender.test.ts
 */

import assert from "node:assert/strict";
import {
  isSenderDomainError,
  parseOrgEmailSender,
  planOrgSend,
  platformFromAddress,
  sendAsOrg,
  type OrgEmailSender,
} from "../email-sender";
import type { SendEmailInput, SendEmailResult } from "../email";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const MX: OrgEmailSender = { fromName: "Cathy | Mengxin Home Textile", fromEmail: "cathy@hlmbedding.com", replyTo: "cathy@hlmbedding.com", bcc: ["cathy@hlmbedding.com"] };

function fakeTransport(reply: (m: SendEmailInput) => SendEmailResult) {
  const calls: SendEmailInput[] = [];
  const t = async (m: SendEmailInput) => {
    calls.push(m);
    return reply(m);
  };
  return { t, calls };
}

async function main() {
  console.log("email-sender");

  await ok("校验：名称必填、邮箱格式、发件和回复至少一个、密送最多 3 个；地址统一小写", () => {
    const good = parseOrgEmailSender({ fromName: "  Cathy |  Mengxin Home Textile ", fromEmail: "Cathy@HLMbedding.com", replyTo: "", bcc: "cathy@hlmbedding.com， boss@hlmbedding.com" });
    assert.deepEqual(good.errors, []);
    assert.deepEqual(good.sender, { fromName: "Cathy | Mengxin Home Textile", fromEmail: "cathy@hlmbedding.com", replyTo: null, bcc: ["cathy@hlmbedding.com", "boss@hlmbedding.com"] });
    assert.match(parseOrgEmailSender({ fromName: "", replyTo: "a@b.com" }).errors[0], /发件人名称/);
    assert.match(parseOrgEmailSender({ fromName: 'Cathy "MX"', replyTo: "a@b.com" }).errors[0], /引号/);
    assert.match(parseOrgEmailSender({ fromName: "Cathy" }).errors[0], /至少填一个/);
    assert.match(parseOrgEmailSender({ fromName: "Cathy", fromEmail: "cathy@" }).errors[0], /发件地址格式/);
    assert.match(parseOrgEmailSender({ fromName: "Cathy", replyTo: "a@b.com", bcc: ["a@b.com", "c@d.com", "e@f.com", "g@h.com"] }).errors[0], /最多 3 个/);
  });

  await ok("平台发件地址：RESEND_FROM_EMAIL 写成 Name <addr> 也只取地址；未设时 noreply@qingyan.ai", () => {
    assert.equal(platformFromAddress("Qingyan <hello@qingyan.ai>"), "hello@qingyan.ai");
    assert.equal(platformFromAddress("hello@qingyan.ai"), "hello@qingyan.ai");
    assert.equal(platformFromAddress(undefined), "noreply@qingyan.ai");
  });

  await ok("发送顺序：先组织地址，再平台地址代发；只填回复地址时只用平台地址；回复地址空 = 发件地址", () => {
    assert.deepEqual(
      planOrgSend(MX, "noreply@qingyan.ai").map((a) => [a.from, a.fallback]),
      [
        ['"Cathy | Mengxin Home Textile" <cathy@hlmbedding.com>', false],
        ['"Cathy | Mengxin Home Textile" <noreply@qingyan.ai>', true],
      ],
    );
    const replyOnly = planOrgSend({ ...MX, fromEmail: null }, "noreply@qingyan.ai");
    assert.deepEqual(replyOnly.map((a) => [a.from, a.fallback, a.replyTo]), [['"Cathy | Mengxin Home Textile" <noreply@qingyan.ai>', false, "cathy@hlmbedding.com"]]);
    assert.equal(planOrgSend({ ...MX, replyTo: null }, "noreply@qingyan.ai")[1].replyTo, "cathy@hlmbedding.com");
    assert.equal(planOrgSend({ ...MX, fromEmail: "sales@qingyan.ai" }, "noreply@qingyan.ai").length, 1);
  });

  await ok("只有发件域名被拒才代发：域名未验证 / invalid from；其它错误（限流、收件人无效）不重发", () => {
    assert.ok(isSenderDomainError({ errorName: "validation_error", error: "The hlmbedding.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" }));
    assert.ok(isSenderDomainError({ errorName: "invalid_from_address", error: "Invalid `from` field." }));
    assert.ok(!isSenderDomainError({ errorName: "rate_limit_exceeded", error: "Too many requests" }));
    assert.ok(!isSenderDomainError({ errorName: "validation_error", error: "Invalid `to` field." }));
  });

  await ok("域名已验证：一次发出，用组织地址，带回复地址和密送", async () => {
    const { t, calls } = fakeTransport(() => ({ success: true, messageId: "re_1" }));
    const r = await sendAsOrg(MX, { to: "buyer@example.com", subject: "S", body: "B" }, t, "noreply@qingyan.ai");
    assert.deepEqual(r, { messageId: "re_1", from: '"Cathy | Mengxin Home Textile" <cathy@hlmbedding.com>', fallback: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].replyTo, "cathy@hlmbedding.com");
    assert.deepEqual(calls[0].bcc, ["cathy@hlmbedding.com"]);
  });

  await ok("域名未验证：平台地址代发，显示名、回复地址、密送不变", async () => {
    const { t, calls } = fakeTransport((m) =>
      m.from?.includes("hlmbedding") ? { success: false, errorName: "validation_error", error: "The hlmbedding.com domain is not verified." } : { success: true, messageId: "re_2" },
    );
    const r = await sendAsOrg(MX, { to: "buyer@example.com", subject: "S", body: "B" }, t, "noreply@qingyan.ai");
    assert.equal(r.fallback, true);
    assert.equal(r.from, '"Cathy | Mengxin Home Textile" <noreply@qingyan.ai>');
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.replyTo === "cathy@hlmbedding.com" && c.bcc?.[0] === "cathy@hlmbedding.com"));
  });

  await ok("其它失败：不代发，直接报错（审批里显示失败原因）", async () => {
    const { t, calls } = fakeTransport(() => ({ success: false, errorName: "rate_limit_exceeded", error: "Too many requests" }));
    await assert.rejects(() => sendAsOrg(MX, { to: "buyer@example.com", subject: "S", body: "B" }, t, "noreply@qingyan.ai"), /Too many requests/);
    assert.equal(calls.length, 1);
  });

  console.log(`\n${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
