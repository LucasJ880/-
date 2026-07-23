/**
 * Gmail Draft OAuth / compose scope 契约测试（无真实 Google / DB）
 * 运行：npx tsx src/lib/__tests__/google-email-oauth.test.ts
 */

import assert from "node:assert/strict";
import {
  GMAIL_COMPOSE_SCOPE,
  GmailOAuthError,
  assertGmailDraftReady,
  createGmailDraft,
  handleEmailCallback,
  hasGmailComposeScope,
  isGmailDraftEnabled,
  validateEmailOAuthTokens,
} from "@/lib/google-email";
import { isTerminalPendingActionStatus } from "@/lib/pending-actions/terminal";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const SEND_ONLY =
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email";
const COMPOSE_OK = `${GMAIL_COMPOSE_SCOPE} https://www.googleapis.com/auth/userinfo.email`;

console.log("google-email-oauth");

// ── scope 解析 ──────────────────────────────────────────────
ok("send-only scope 不含 compose", !hasGmailComposeScope(SEND_ONLY));
ok("compose scope 可识别（完整 URL）", hasGmailComposeScope(COMPOSE_OK));
ok("compose 短名可识别", hasGmailComposeScope("gmail.compose userinfo.email"));
ok("空 scope 拒绝", !hasGmailComposeScope(""));
ok("不得把请求 scope 当 granted：validate 用 tokens.scope", (() => {
  const r = validateEmailOAuthTokens({
    scope: SEND_ONLY,
    refresh_token: "rt",
    access_token: "at",
  });
  return !r.ok && r.code === "GMAIL_COMPOSE_SCOPE_NOT_GRANTED";
})());

ok("compose token 校验通过", (() => {
  const r = validateEmailOAuthTokens({
    scope: COMPOSE_OK,
    refresh_token: "rt",
    access_token: "at",
  });
  return r.ok === true && r.grantedScopes === COMPOSE_OK;
})());

ok("缺少 refresh_token → GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE", (() => {
  const r = validateEmailOAuthTokens({
    scope: COMPOSE_OK,
    refresh_token: null,
    access_token: "at",
  });
  return !r.ok && r.code === "GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE";
})());

ok("tokens.scope 缺失不得伪造为请求 scope", (() => {
  const r = validateEmailOAuthTokens({
    scope: null,
    refresh_token: "rt",
    access_token: "at",
  });
  return !r.ok && r.code === "GMAIL_COMPOSE_SCOPE_NOT_GRANTED";
})());

// ── 功能开关 ────────────────────────────────────────────────
{
  const prev = process.env.GMAIL_DRAFT_ENABLED;
  delete process.env.GMAIL_DRAFT_ENABLED;
  ok("GMAIL_DRAFT_ENABLED 未设置 → 关闭", !isGmailDraftEnabled());
  process.env.GMAIL_DRAFT_ENABLED = "true";
  ok("GMAIL_DRAFT_ENABLED=true → 开启", isGmailDraftEnabled());
  if (prev === undefined) delete process.env.GMAIL_DRAFT_ENABLED;
  else process.env.GMAIL_DRAFT_ENABLED = prev;
}

ok("确认前预检：send-only → GMAIL_REAUTH_REQUIRED", (() => {
  process.env.GMAIL_DRAFT_ENABLED = "1";
  try {
    assertGmailDraftReady({
      accessToken: "enc",
      grantedScopes: SEND_ONLY,
    });
    return false;
  } catch (e) {
    return e instanceof GmailOAuthError && e.code === "GMAIL_REAUTH_REQUIRED";
  }
})());

ok("确认前预检：功能关闭 → GMAIL_DRAFT_DISABLED", (() => {
  process.env.GMAIL_DRAFT_ENABLED = "0";
  try {
    assertGmailDraftReady({
      accessToken: "enc",
      grantedScopes: COMPOSE_OK,
    });
    return false;
  } catch (e) {
    return e instanceof GmailOAuthError && e.code === "GMAIL_DRAFT_DISABLED";
  } finally {
    process.env.GMAIL_DRAFT_ENABLED = "1";
  }
})());

async function runAsync() {
  // handleEmailCallback 入口会检查 redirect URI
  process.env.GOOGLE_EMAIL_REDIRECT_URI =
    process.env.GOOGLE_EMAIL_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google-email/callback";

  // ── callback：send-only 拒绝且不覆盖 provider ─────────────
  {
    let touched = false;
    let code = "";
    try {
      await handleEmailCallback("code", "user-1", {
        getToken: async () => ({
          tokens: {
            scope: SEND_ONLY,
            access_token: "at",
            refresh_token: "rt",
          },
        }),
        getUserEmail: async () => "u@example.com",
        findProvider: async () => ({ id: "existing" }),
        updateProvider: async () => {
          touched = true;
        },
        createProvider: async () => {
          touched = true;
        },
      });
    } catch (e) {
      code = e instanceof GmailOAuthError ? e.code : "other";
    }
    ok("send-only token 被拒绝", code === "GMAIL_COMPOSE_SCOPE_NOT_GRANTED");
    ok("send-only 失败不覆盖 EmailProvider", touched === false);
  }

  // ── callback：缺 refresh_token 不覆盖 ─────────────────────
  {
    let touched = false;
    let code = "";
    try {
      await handleEmailCallback("code", "user-1", {
        getToken: async () => ({
          tokens: {
            scope: COMPOSE_OK,
            access_token: "at",
            refresh_token: null,
          },
        }),
        getUserEmail: async () => "u@example.com",
        findProvider: async () => ({ id: "existing" }),
        updateProvider: async () => {
          touched = true;
        },
        createProvider: async () => {
          touched = true;
        },
      });
    } catch (e) {
      code = e instanceof GmailOAuthError ? e.code : "other";
    }
    ok(
      "缺少 refresh token → GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE",
      code === "GMAIL_REFRESH_TOKEN_MISSING_REAUTHORIZE",
    );
    ok("缺少 refresh token 不覆盖现有 provider", touched === false);
  }

  // ── callback：compose + refresh 成功覆盖 ──────────────────
  {
    let updatedId = "";
    let savedScopes = "";
    await handleEmailCallback("code", "user-1", {
      getToken: async () => ({
        tokens: {
          scope: COMPOSE_OK,
          access_token: "at",
          refresh_token: "new-rt",
          expiry_date: Date.now() + 3600_000,
        },
      }),
      getUserEmail: async () => "u@example.com",
      findProvider: async () => ({ id: "existing" }),
      updateProvider: async (id, data) => {
        updatedId = id;
        savedScopes = String(data.grantedScopes ?? "");
      },
    });
    ok("compose token 可完成授权并覆盖旧 EmailProvider", updatedId === "existing");
    ok("grantedScopes 仅记录 tokens.scope（含 compose）", hasGmailComposeScope(savedScopes));
  }

  // ── drafts.create 成功；绝不 messages.send ────────────────
  {
    process.env.GMAIL_DRAFT_ENABLED = "1";
    let draftCalls = 0;
    let sendCalls = 0;
    const { draftId } = await createGmailDraft(
      "user-1",
      {
        to: "a@example.com",
        from: "me@example.com",
        subject: "hello",
        body: "<p>hi</p>",
      },
      {
        getProvider: async () =>
          ({
            id: "p1",
            userId: "user-1",
            type: "gmail",
            accessToken: "enc-at",
            refreshToken: "enc-rt",
            tokenExpiry: null,
            accountEmail: "me@example.com",
            grantedScopes: COMPOSE_OK,
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as Awaited<ReturnType<typeof import("@/lib/google-email").getEmailProvider>>,
        getGmail: async () => ({
          users: {
            drafts: {
              create: async () => {
                draftCalls += 1;
                return { data: { id: "draft-1" } };
              },
            },
            messages: {
              send: async () => {
                sendCalls += 1;
                return { data: { id: "msg-1" } };
              },
            },
          },
        }),
      },
    );
    ok("drafts.create 成功", draftId === "draft-1" && draftCalls === 1);
    ok("不调用 messages.send", sendCalls === 0);
  }

  // ── send-only provider：createGmailDraft 在调 API 前失败 ──
  {
    process.env.GMAIL_DRAFT_ENABLED = "1";
    let draftCalls = 0;
    let code = "";
    try {
      await createGmailDraft(
        "user-1",
        {
          to: "a@example.com",
          from: "me@example.com",
          subject: "hello",
          body: "<p>hi</p>",
        },
        {
          getProvider: async () =>
            ({
              id: "p1",
              accessToken: "enc-at",
              refreshToken: "enc-rt",
              tokenExpiry: null,
              accountEmail: "me@example.com",
              grantedScopes: SEND_ONLY,
            }) as Awaited<ReturnType<typeof import("@/lib/google-email").getEmailProvider>>,
          getGmail: async () => ({
            users: {
              drafts: {
                create: async () => {
                  draftCalls += 1;
                  return { data: { id: "draft-x" } };
                },
              },
            },
          }),
        },
      );
    } catch (e) {
      code = e instanceof GmailOAuthError ? e.code : "other";
    }
    ok("send-only 创建草稿前返回 GMAIL_REAUTH_REQUIRED", code === "GMAIL_REAUTH_REQUIRED");
    ok("send-only 不调用 Gmail drafts API", draftCalls === 0);
  }

  // ── 重复确认不创建第二份草稿（终态幂等） ───────────────────
  {
    process.env.GMAIL_DRAFT_ENABLED = "1";
    let draftCalls = 0;
    const createOnce = async () => {
      await createGmailDraft(
        "user-1",
        {
          to: "a@example.com",
          from: "me@example.com",
          subject: "hello",
          body: "<p>hi</p>",
        },
        {
          getProvider: async () =>
            ({
              id: "p1",
              accessToken: "enc-at",
              refreshToken: "enc-rt",
              tokenExpiry: null,
              accountEmail: "me@example.com",
              grantedScopes: COMPOSE_OK,
            }) as Awaited<ReturnType<typeof import("@/lib/google-email").getEmailProvider>>,
          getGmail: async () => ({
            users: {
              drafts: {
                create: async () => {
                  draftCalls += 1;
                  return { data: { id: `draft-${draftCalls}` } };
                },
              },
              messages: {
                send: async () => {
                  throw new Error("messages.send must not be called");
                },
              },
            },
          }),
        },
      );
    };

    let status = "pending";
    const confirm = async () => {
      if (isTerminalPendingActionStatus(status)) {
        return { ok: true as const, duplicate: true };
      }
      await createOnce();
      status = "executed";
      return { ok: true as const, duplicate: false };
    };

    const first = await confirm();
    const second = await confirm();
    ok("首次确认创建草稿", first.duplicate === false && draftCalls === 1);
    ok("重复确认不创建第二份草稿", second.duplicate === true && draftCalls === 1);
    ok("executed 为终态", isTerminalPendingActionStatus("executed"));
  }

  // ── EMAIL_SCOPES 不含 modify / mail.google.com / send ─────
  {
    const { EMAIL_SCOPES } = await import("@/lib/google-email");
    const joined = EMAIL_SCOPES.join(" ");
    ok("请求 scope 含 gmail.compose", joined.includes("gmail.compose"));
    ok("请求 scope 含 userinfo.email", joined.includes("userinfo.email"));
    ok("请求 scope 不含 gmail.send", !joined.includes("gmail.send"));
    ok("请求 scope 不含 gmail.modify", !joined.includes("gmail.modify"));
    ok("请求 scope 不含 mail.google.com", !joined.includes("mail.google.com"));
  }

  console.log(`\ngoogle-email-oauth: ${passed} passed`);
}

runAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
