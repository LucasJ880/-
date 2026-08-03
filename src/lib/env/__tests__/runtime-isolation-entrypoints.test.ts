/**
 * Wave1.5 — 真实写入口 / worker / webhook / messaging / Gmail no-write 测试
 * 运行：npx tsx src/lib/env/__tests__/runtime-isolation-entrypoints.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { NON_PROD_SIDE_EFFECT_DISABLED } from "../runtime-isolation";

function errCode(e: unknown): string | undefined {
  return e && typeof e === "object" && "code" in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

const PROD_DB =
  "postgresql://u:p@ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech/neondb";
const STAGING_DB =
  "postgresql://u:p@ep-floral-sea-au07ycff.c-10.us-east-1.aws.neon.tech/neondb";

type Counts = Record<string, number>;

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    const v = patch[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function withEnvAsync(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    const v = patch[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function installCounter<T extends object>(
  target: T,
  method: keyof T & string,
  counts: Counts,
  key: string,
): () => void {
  const original = (target as Record<string, unknown>)[method];
  if (typeof original !== "function") {
    throw new Error(`missing method ${key}`);
  }
  (target as Record<string, unknown>)[method] = async (..._args: unknown[]) => {
    counts[key] = (counts[key] || 0) + 1;
    throw new Error(`UNEXPECTED_DB_CALL:${key}`);
  };
  return () => {
    (target as Record<string, unknown>)[method] = original;
  };
}

async function main() {
  // ── Pending Action route：Preview + Prod DB → 503，DB 0 次 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      const { POST } = await import(
        "@/app/api/ai/pending-actions/[id]/route"
      );
      const counts: Counts = {};
      const restores = [
        installCounter(db.pendingAction, "findUnique", counts, "pa.findUnique"),
        installCounter(db.pendingAction, "update", counts, "pa.update"),
        installCounter(db.task, "create", counts, "task.create"),
      ];
      try {
        for (const decision of ["approve", "reject"] as const) {
          const req = new NextRequest(
            "http://localhost/api/ai/pending-actions/pa_test",
            {
              method: "POST",
              body: JSON.stringify({ decision }),
              headers: { "content-type": "application/json" },
            },
          );
          const res = await POST(req, {
            params: Promise.resolve({ id: "pa_test" }),
          });
          assert.equal(res.status, 503);
          const body = (await res.json()) as { code?: string };
          assert.equal(body.code, "PROD_DB_ON_NON_PROD_RUNTIME");
        }
        assert.equal(counts["pa.findUnique"] || 0, 0);
        assert.equal(counts["pa.update"] || 0, 0);
        assert.equal(counts["task.create"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Executor：隔离失败，pendingAction/update/task/note 0 次 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      const { executePendingAction, rejectPendingAction } = await import(
        "@/lib/pending-actions/executor"
      );
      const counts: Counts = {};
      const restores = [
        installCounter(db.pendingAction, "findUnique", counts, "pa.findUnique"),
        installCounter(db.pendingAction, "update", counts, "pa.update"),
        installCounter(db.task, "create", counts, "task.create"),
      ];
      try {
        const exec = await executePendingAction("pa_x", {
          userId: "u1",
          role: "admin",
          orgId: "o1",
        });
        assert.equal(exec.ok, false);
        assert.equal(exec.errorCode, "PROD_DB_ON_NON_PROD_RUNTIME");

        const rej = await rejectPendingAction(
          "pa_x",
          { userId: "u1", role: "admin", orgId: "o1" },
          "no",
        );
        assert.equal(rej.ok, false);
        assert.equal(rej.errorCode, "PROD_DB_ON_NON_PROD_RUNTIME");

        assert.equal(counts["pa.findUnique"] || 0, 0);
        assert.equal(counts["pa.update"] || 0, 0);
        assert.equal(counts["task.create"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Project PATCH ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      const { PATCH } = await import("@/app/api/projects/[id]/route");
      const counts: Counts = {};
      const restores = [
        installCounter(db.project, "findUnique", counts, "project.findUnique"),
        installCounter(db.project, "update", counts, "project.update"),
      ];
      try {
        const req = new NextRequest("http://localhost/api/projects/p1", {
          method: "PATCH",
          body: JSON.stringify({ name: "x" }),
          headers: { "content-type": "application/json" },
        });
        const res = await PATCH(req, {
          params: Promise.resolve({ id: "p1" }),
        });
        assert.equal(res.status, 503);
        assert.equal(counts["project.findUnique"] || 0, 0);
        assert.equal(counts["project.update"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Task POST ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "preview",
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_DB,
    },
    async () => {
      const { POST } = await import("@/app/api/tasks/route");
      const counts: Counts = {};
      const restores = [
        installCounter(db.task, "create", counts, "task.create"),
      ];
      try {
        const req = new NextRequest("http://localhost/api/tasks", {
          method: "POST",
          body: JSON.stringify({ title: "t" }),
          headers: { "content-type": "application/json" },
        });
        const res = await POST(req, { params: Promise.resolve({}) });
        assert.equal(res.status, 503);
        assert.equal(counts["task.create"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Worker claim/report ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      POSTFLOW_WORKER_TOKEN: "staging-test-worker-token",
    },
    async () => {
      const claim = await import("@/app/api/operations/worker/claim/route");
      const report = await import("@/app/api/operations/worker/report/route");
      const counts: Counts = {};
      const restores = [
        installCounter(db.publishJob, "updateMany", counts, "pj.updateMany"),
        installCounter(db.publishJob, "findMany", counts, "pj.findMany"),
        installCounter(db.publishJob, "findFirst", counts, "pj.findFirst"),
      ];
      try {
        const claimReq = new NextRequest(
          "http://localhost/api/operations/worker/claim",
          {
            method: "POST",
            body: JSON.stringify({ limit: 1 }),
            headers: {
              "content-type": "application/json",
              authorization: "Bearer staging-test-worker-token",
            },
          },
        );
        const claimRes = await claim.POST(claimReq);
        assert.equal(claimRes.status, 503);
        const claimBody = (await claimRes.json()) as { code?: string };
        assert.equal(claimBody.code, "WORKER_DISABLED_NON_PROD");

        const reportReq = new NextRequest(
          "http://localhost/api/operations/worker/report",
          {
            method: "POST",
            body: JSON.stringify({
              jobId: "j1",
              leaseToken: "t1",
              ok: true,
            }),
            headers: {
              "content-type": "application/json",
              authorization: "Bearer staging-test-worker-token",
            },
          },
        );
        const reportRes = await report.POST(reportReq);
        assert.equal(reportRes.status, 503);
        const reportBody = (await reportRes.json()) as { code?: string };
        assert.equal(reportBody.code, "WORKER_DISABLED_NON_PROD");

        assert.equal(counts["pj.updateMany"] || 0, 0);
        assert.equal(counts["pj.findMany"] || 0, 0);
        assert.equal(counts["pj.findFirst"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Webhook publisher：fetch 0 次 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      POSTIZ_API_URL: "https://postiz.example.invalid",
      POSTIZ_API_KEY: "test-key",
    },
    async () => {
      let fetchCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (..._args: unknown[]) => {
        fetchCalls++;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      try {
        const { dispatchPublishJob } = await import(
          "@/lib/operations/publishers"
        );
        const result = await dispatchPublishJob(
          {
            id: "job1",
            channel: "postiz",
            status: "queued",
            externalJobId: null,
            scheduledAt: null,
            captionText: "hi",
            hashtags: [],
            idempotencyKey: "k1",
            providerStatus: null,
            externalPostUrl: null,
          } as never,
          { videoUrl: "https://example.com/v.mp4" } as never,
          {
            handle: "h",
            platform: "tiktok",
            externalChannelId: "ch1",
          } as never,
        );
        assert.equal(result.ok, false);
        assert.equal(fetchCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  // ── 微信 pushMessage / pushToBindings ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      const { pushMessage } = await import("@/lib/messaging/gateway");
      const pushService = await import("@/lib/messaging/push-service");
      const counts: Counts = {};
      const restores = [
        installCounter(
          db.weChatBinding,
          "findMany",
          counts,
          "binding.findMany",
        ),
      ];
      try {
        await assert.rejects(
          () => pushMessage("u1", "hello"),
          (e: unknown) => errCode(e) === NON_PROD_SIDE_EFFECT_DISABLED,
        );
        assert.equal(counts["binding.findMany"] || 0, 0);

        // pushNotification → pushMessage（同防线；adapter 不会加载）
        await assert.rejects(
          () => pushService.pushNotification("u1", "t", "b"),
          (e: unknown) => errCode(e) === NON_PROD_SIDE_EFFECT_DISABLED,
        );
        assert.equal(counts["binding.findMany"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Gmail Draft：API 0 次 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: "true",
    },
    async () => {
      const { createGmailDraft } = await import("@/lib/google-email");
      let gmailApiCalls = 0;
      await assert.rejects(
        () =>
          createGmailDraft(
            "u1",
            {
              to: "a@b.com",
              from: "me@b.com",
              subject: "s",
              body: "b",
            },
            {
              getProvider: async () =>
                ({
                  accessToken: "tok",
                  grantedScopes:
                    "https://www.googleapis.com/auth/gmail.compose",
                  accountEmail: "me@b.com",
                }) as never,
              getGmail: async () => {
                gmailApiCalls++;
                return {
                  users: {
                    drafts: {
                      create: async () => {
                        gmailApiCalls++;
                        return { data: { id: "d1" } };
                      },
                    },
                  },
                } as never;
              },
            },
          ),
        (e: unknown) => errCode(e) === "GMAIL_DRAFT_DISABLED",
      );
      assert.equal(gmailApiCalls, 0);
    },
  );

  // ── Gmail Draft：Vercel test mismatch → API 0 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "test",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      GMAIL_DRAFT_ENABLED: "true",
      QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD: "true",
    },
    async () => {
      const { isGmailDraftAllowed } = await import(
        "@/lib/env/runtime-isolation"
      );
      const { createGmailDraft } = await import("@/lib/google-email");
      assert.equal(isGmailDraftAllowed(), false);
      let gmailApiCalls = 0;
      await assert.rejects(
        () =>
          createGmailDraft(
            "u1",
            {
              to: "a@b.com",
              from: "me@b.com",
              subject: "s",
              body: "b",
            },
            {
              getProvider: async () =>
                ({
                  accessToken: "tok",
                  grantedScopes:
                    "https://www.googleapis.com/auth/gmail.compose",
                  accountEmail: "me@b.com",
                }) as never,
              getGmail: async () => {
                gmailApiCalls++;
                return {
                  users: {
                    drafts: {
                      create: async () => {
                        gmailApiCalls++;
                        return { data: { id: "d1" } };
                      },
                    },
                  },
                } as never;
              },
            },
          ),
        (e: unknown) => errCode(e) === "GMAIL_DRAFT_DISABLED",
      );
      assert.equal(gmailApiCalls, 0);
      const { assertSideEffectOrThrow } = await import(
        "@/lib/env/runtime-isolation"
      );
      assert.throws(
        () => assertSideEffectOrThrow("gmail_draft"),
        (e: unknown) => errCode(e) === "RUNTIME_ENV_MISMATCH",
      );
    },
  );

  // ── 真实邮件 sendGmail：Staging 默认 messages.send = 0 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
    },
    async () => {
      const { sendGmail } = await import("@/lib/google-email");
      const { sendSalesEmail } = await import("@/lib/email/sender");
      let sendApiCalls = 0;
      let oauthProviderCalls = 0;
      const counts: Counts = {};
      const restores = [
        installCounter(db.emailBinding, "update", counts, "emailBinding.update"),
      ];
      try {
        await assert.rejects(
          () =>
            sendGmail(
              "u1",
              {
                to: "real@example.com",
                from: "me@b.com",
                subject: "s",
                body: "b",
              },
              {
                getProvider: async () => {
                  oauthProviderCalls++;
                  return {
                    id: "p1",
                    accessToken: "tok",
                    refreshToken: "r",
                    tokenExpiry: null,
                    accountEmail: "me@b.com",
                  } as never;
                },
                getGmail: async () => {
                  sendApiCalls++;
                  return {
                    users: {
                      messages: {
                        send: async () => {
                          sendApiCalls++;
                          return { data: { id: "m1" } };
                        },
                      },
                    },
                  };
                },
              },
            ),
          (e: unknown) => errCode(e) === "SIDE_EFFECT_DISABLED",
        );
        assert.equal(sendApiCalls, 0);
        assert.equal(oauthProviderCalls, 0);

        const sales = await sendSalesEmail("u1", {
          to: "real@example.com",
          subject: "s",
          html: "<p>x</p>",
        });
        assert.equal(sales.success, false);
        assert.equal(sendApiCalls, 0);
        assert.equal(counts["emailBinding.update"] || 0, 0);
      } finally {
        for (const r of restores) r();
      }
    },
  );

  // ── Vercel test mismatch：真实邮件 API 0 ──
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "test",
      VERCEL_ENV: "preview",
      DATABASE_URL: STAGING_DB,
      QINGYAN_ALLOW_REAL_EMAIL_NON_PROD: "true",
    },
    async () => {
      const { sendGmail } = await import("@/lib/google-email");
      let sendApiCalls = 0;
      await assert.rejects(
        () =>
          sendGmail(
            "u1",
            {
              to: "a@b.com",
              from: "me@b.com",
              subject: "s",
              body: "b",
            },
            {
              getProvider: async () =>
                ({
                  id: "p1",
                  accessToken: "tok",
                  refreshToken: null,
                  tokenExpiry: null,
                }) as never,
              getGmail: async () => {
                sendApiCalls++;
                return {
                  users: {
                    messages: {
                      send: async () => {
                        sendApiCalls++;
                        return { data: { id: "m1" } };
                      },
                    },
                  },
                };
              },
            },
          ),
        (e: unknown) => errCode(e) === "RUNTIME_ENV_MISMATCH",
      );
      assert.equal(sendApiCalls, 0);
    },
  );

  // assertSideEffectOrThrow 保留真实平面错误码
  await withEnvAsync(
    {
      QINGYAN_RUNTIME_ENV: "staging",
      VERCEL_ENV: "preview",
      DATABASE_URL: OTHER_DB_PLACEHOLDER(),
    },
    async () => {
      const { assertSideEffectOrThrow } = await import(
        "@/lib/env/runtime-isolation"
      );
      assert.throws(
        () => assertSideEffectOrThrow("write"),
        (e: unknown) => errCode(e) === "DB_PLANE_MISMATCH",
      );
    },
  );

  console.log("runtime-isolation-entrypoints.test.ts OK");
}

function OTHER_DB_PLACEHOLDER() {
  return "postgresql://u:p@ep-random-other-abc123.c-1.us-east-1.aws.neon.tech/neondb";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
