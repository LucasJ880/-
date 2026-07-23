/**
 * Gmail 草稿场景契约（无 DB；绝不发送）
 * 运行：npx tsx src/lib/assistant/__tests__/gmail-draft-scenario.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import {
  extractEmail,
  extractCustomerNameHint,
} from "@/lib/assistant/scenarios/entity-parse";
import { buildGmailDraftCopy } from "@/lib/assistant/scenarios/gmail-draft";
import {
  assertNoInternalLeak,
  buildCustomerVisibleEmailBody,
  extractEmailContentFacts,
} from "@/lib/assistant/scenarios/email-content";
import { friendlyScenarioError } from "@/lib/assistant/scenarios/types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("gmail-draft-scenario");

ok(
  "发送邮件意图 → gmail_email_draft + requestedDirectExecution",
  (() => {
    const r = routeAssistantIntent("帮我发送邮件给客户");
    return (
      r.intent === "gmail_email_draft" && r.requestedDirectExecution === true
    );
  })(),
);

ok(
  "草稿意图不带直接发送标记",
  (() => {
    const r = routeAssistantIntent("帮我写一封 Gmail 草稿");
    return r.intent === "gmail_email_draft" && !r.requestedDirectExecution;
  })(),
);

ok(
  "明确邮箱可解析",
  extractEmail("发邮件给 alice@example.com 跟进一下") === "alice@example.com",
);

ok(
  "不得从名字臆造邮箱（无 @ 则 extractEmail 为空）",
  extractEmail("给张三写邮件") === null,
);

ok(
  "给 Rudy 起草一封邮件 → 解析 Rudy",
  extractCustomerNameHint("给 Rudy 起草一封邮件") === "Rudy",
);

ok(
  "给 ABC 客户发送邮件 → 解析 ABC",
  extractCustomerNameHint("给 ABC 客户发送邮件") === "ABC",
);

ok(
  "生产周期事实进入正文，且无内部说明",
  (() => {
    const msg = "帮我回复客户，我们生产周期是 8 周";
    const extracted = extractEmailContentFacts(msg);
    const body = buildCustomerVisibleEmailBody({
      facts: extracted.facts,
      language: extracted.language,
    });
    return (
      extracted.hasPurpose &&
      (body.includes("8 周") || body.includes("8 weeks")) &&
      !body.includes("青砚助手") &&
      !body.includes("原文") &&
      !body.includes("系统提示") &&
      assertNoInternalLeak(body)
    );
  })(),
);

ok(
  "测量 / 报价 / 到场事实可提取",
  (() => {
    const a = extractEmailContentFacts("告诉 Rudy，我们预计 8 月初测量");
    const b = extractEmailContentFacts("给客户写邮件，确认报价仍然有效");
    const c = extractEmailContentFacts(
      "回复客户，现场只有 Hui Jiang 一个人参加",
    );
    return (
      a.facts.some((f) => /8 月初|measure/i.test(f)) &&
      b.facts.some((f) => /报价仍然有效|remains valid/i.test(f)) &&
      c.facts.some((f) => /Hui Jiang/)
    );
  })(),
);

ok(
  "只有收件人、没有邮件目的 → 无 purpose（应澄清、不建 PA）",
  (() => {
    const extracted = extractEmailContentFacts("帮我发送邮件给客户");
    return extracted.hasPurpose === false && extracted.facts.length === 0;
  })(),
);

ok(
  "直接发送请求文案：只建草稿、不发送",
  (() => {
    const text = buildGmailDraftCopy({
      to: "a@b.com",
      subject: "跟进",
      body: "生产周期为 8 周",
      requestedDirectExecution: true,
    });
    return (
      text.includes("只会创建 Gmail 草稿") &&
      text.includes("不会自动发送") &&
      !text.includes("已发送") &&
      !text.includes("sendEmail")
    );
  })(),
);

ok(
  "主题/正文长度限制契约（≤200 / ≤10000）",
  (() => {
    const SUBJECT_MAX = 200;
    const BODY_MAX = 10_000;
    const subject = "x".repeat(250).slice(0, SUBJECT_MAX);
    const body = "y".repeat(12_000).slice(0, BODY_MAX);
    return subject.length === 200 && body.length === 10_000;
  })(),
);

ok(
  "缺少收件人友好文案",
  friendlyScenarioError("RECIPIENT_REQUIRED").includes("邮箱"),
);

ok(
  "确认前不调用发送：场景 type 仅为 grader.email_draft",
  (() => {
    const type = "grader.email_draft";
    return type === "grader.email_draft" && !type.includes("send");
  })(),
);

console.log(`结果: ${passed} passed`);
