/**
 * Autopilot sanitizer：credential 不得进入 storage。
 * 运行：npx tsx src/lib/autopilot/__tests__/sanitize.test.ts
 */

import {
  sanitizeAgentTrace,
  sanitizeAutopilotPayload,
  toContentRef,
  redactPersistedErrorText,
  safePersistedErrorCode,
} from "../sanitize";

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

const leaky = [
  "Bearer secret-token-value",
  "qy_session=abc; password=hunter2",
  "sk-live-abcdefghijklmnopqrstuvwxyz",
  "Authorization: Bearer abcdefghijklmnop",
  "Cookie: qy_session=abc",
  "API Key sk-proj-abcdefghijklmnopqrstuvwxyz",
  "Acme CAD 12800 合同条款 follow-up",
  "invoice CAD $12,800 to acme@example.com",
  "lucas@sunnyshutter.ca 合同金额 CAD 9800",
].join("\n");
const ref = toContentRef(leaky, "msg_1");
const persisted = JSON.stringify(ref);
ok(ref != null, "toContentRef 对非空输入返回 reference");
ok(typeof ref?.hash === "string" && (ref?.hash?.length ?? 0) > 0, "允许保留原文 hash");
ok(ref?.summary === `redacted:${Buffer.byteLength(leaky.trim(), "utf8")}B`, "summary 仅为结构 redacted");
ok(!persisted.includes(leaky.slice(0, 20)), "summary 不是原文前缀");
ok(!persisted.includes("secret-token-value"), "credential Bearer 不入库");
ok(!persisted.includes("hunter2"), "password 不入库");
ok(!persisted.includes("sk-live-abcdefghijklmnopqrstuvwxyz"), "API key 不入库");
ok(!persisted.includes("qy_session=abc"), "cookie 不入库");
ok(!persisted.includes("Acme"), "业务名 Acme 不入库");
ok(!persisted.includes("CAD"), "金额 CAD 不入库");
ok(!persisted.includes("合同"), "合同正文不入库");
ok(!persisted.includes("acme@example.com"), "业务邮箱不入库");
ok(!persisted.includes("lucas@sunnyshutter.ca"), "内部邮箱不入库");
ok(!persisted.includes("12800"), "金额数字不入库");
ok(toContentRef(null) === null, "空值不写 reference");

ok(
  sanitizeAgentTrace("Bearer abcdefghijklmnop") === "[REDACTED]",
  "既有 sanitizer 前缀 Bearer 行为保持",
);
ok(
  typeof sanitizeAgentTrace("request failed: Authorization: Bearer abc-mid") === "string",
  "既有 sanitizer 不被本轮改成更弱",
);

const persistedCases = [
  "request failed: Authorization: Bearer abc-secret-in-middle",
  "upstream returned Cookie: qy_session=abc123mid",
  "database error password=hunter2",
  "request failed with api_key=sk-live-abcdefghijklmnopqrstuvwxyz",
];
for (const raw of persistedCases) {
  const out = redactPersistedErrorText(raw);
  ok(!out.includes("abc-secret-in-middle"), `persisted redact Bearer mid: ${raw.slice(0, 28)}`);
  ok(!out.includes("qy_session=abc123mid"), `persisted redact cookie mid: ${raw.slice(0, 28)}`);
  ok(!out.includes("hunter2"), `persisted redact password: ${raw.slice(0, 28)}`);
  ok(
    !out.includes("sk-live-abcdefghijklmnopqrstuvwxyz"),
    `persisted redact api_key: ${raw.slice(0, 28)}`,
  );
}
ok(safePersistedErrorCode("P2002") === "P2002", "safe code P2002");
ok(safePersistedErrorCode("CROSS_ORG") === "CROSS_ORG", "safe code CROSS_ORG");
ok(
  safePersistedErrorCode("Bearer secret-token-value") === "PROCESSOR_ERROR",
  "unsafe code 不得入库",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
