/**
 * Autopilot sanitizer：credential 不得进入 storage。
 * 运行：npx tsx src/lib/autopilot/__tests__/sanitize.test.ts
 */

import { sanitizeAgentTrace, sanitizeAutopilotPayload } from "../sanitize";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("autopilot sanitize");

const dirty = {
  Authorization: "Bearer secret-token-value",
  Cookie: "qy_session=abc",
  "API Key": "sk-live-abcdefghijklmnopqrstuvwxyz",
  oauth_token: "ya29.a0AfH6SMB",
  password: "hunter2",
  secret: "super-secret",
  refresh_token: "rt_abc",
  headers: { authorization: "Bearer abc" },
  toolArgs: { customer: "Acme", note: "follow up" },
  nested: { access_token: "tok", ok: true },
};

const cleaned = sanitizeAgentTrace(dirty) as Record<string, unknown>;
ok(cleaned.Authorization === "[REDACTED]", "Authorization 过滤");
ok(cleaned.Cookie === "[REDACTED]", "Cookie 过滤");
ok(cleaned["API Key"] === "[REDACTED]", "API Key 过滤");
ok(cleaned.oauth_token === "[REDACTED]", "OAuth token 过滤");
ok(cleaned.password === "[REDACTED]", "password 过滤");
ok(cleaned.secret === "[REDACTED]", "secret 过滤");
ok(cleaned.refresh_token === "[REDACTED]", "refresh_token 过滤");

const json = JSON.stringify(cleaned);
ok(!json.includes("secret-token-value"), "Bearer 原文不出现");
ok(!json.includes("qy_session=abc"), "Cookie 原文不出现");
ok(!json.includes("hunter2"), "password 原文不出现");
ok(!json.includes("sk-live-abcdefghijklmnopqrstuvwxyz"), "API key 原文不出现");

ok(
  sanitizeAgentTrace("Bearer abcdefghijklmnop") === "[REDACTED]",
  "Bearer 字符串值过滤",
);
ok(
  (sanitizeAutopilotPayload({ tool: "gmail.send", name: "gmail.send" }) as Record<string, unknown>)
    .name === "gmail.send",
  "非敏感工具名保留",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
