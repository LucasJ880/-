/**
 * Aivora 适配器纯逻辑测试（契约 docs/AIVORA_SYNC_CONTRACT.md）
 * 运行:npx tsx src/lib/operations/__tests__/aivora.test.ts
 */
import { strict as assert } from "node:assert";
import {
  AIVORA_PAGE_LIMIT,
  AivoraApiError,
  fetchAivoraPage,
  fetchAivoraPageWithRetry,
  getAivoraVideosEndpoint,
  mapAivoraItem,
  parseAivoraPage,
} from "../aivora";

let passed = 0;
function ok(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = () => {
    passed += 1;
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.then(done).catch((e) => {
      console.error(`✗ ${name}`);
      throw e;
    });
  }
  done();
}

// ── endpoint 构造:容忍带不带 /api 后缀与结尾斜杠 ──
ok("endpoint 构造", () => {
  assert.equal(
    getAivoraVideosEndpoint("https://reelforge-delta.vercel.app"),
    "https://reelforge-delta.vercel.app/api/videos",
  );
  assert.equal(
    getAivoraVideosEndpoint("https://reelforge-delta.vercel.app/"),
    "https://reelforge-delta.vercel.app/api/videos",
  );
  assert.equal(
    getAivoraVideosEndpoint("https://reelforge-delta.vercel.app/api"),
    "https://reelforge-delta.vercel.app/api/videos",
  );
});

// ── 字段映射:契约 §4 示例逐字段;枚举原文透传 ──
ok("字段映射(契约 §4 示例)", () => {
  const mapped = mapAivoraItem({
    id: "cmr123",
    video_url: "https://x.public.blob.vercel-storage.com/a.mp4",
    title: "示例",
    cover_url: "https://x/cover.jpg",
    duration: 15,
    topic: "curtains",
    language: "zh",
    completed_at: "2026-08-03T17:28:00.000Z",
    recipe_id: "r1",
    hook_type: "POV",
    template_id: "t1",
    aspect_ratio: "9:16",
    brand_placement: "corner_badge",
  });
  assert.ok(mapped);
  assert.equal(mapped.externalId, "cmr123");
  assert.equal(mapped.durationSec, 15);
  assert.equal(mapped.completedAt, "2026-08-03T17:28:00.000Z");
  assert.equal(mapped.hookType, "POV");
  assert.equal(mapped.brandPlacement, "corner_badge");
  assert.equal(mapped.aspectRatio, "9:16");
});

// ── null 语义:可空字段保持 null(= 未知),不是默认值 ──
ok("null 语义保持", () => {
  const mapped = mapAivoraItem({
    id: "cmr456",
    video_url: "https://x/b.mp4",
    title: "无配方历史成片",
    cover_url: null,
    duration: null,
    topic: null,
    language: null,
    completed_at: "2026-07-01T00:00:00.000Z",
    recipe_id: null,
    hook_type: null,
    template_id: null,
    aspect_ratio: null,
    brand_placement: null,
  });
  assert.ok(mapped);
  assert.equal(mapped.durationSec, null);
  assert.equal(mapped.hookType, null);
  assert.equal(mapped.recipeId, null);
  assert.equal(mapped.brandPlacement, null);
});

ok("缺 id / video_url 丢弃;duration 取整;空串归 null", () => {
  assert.equal(mapAivoraItem({ video_url: "https://x/a.mp4" }), null);
  assert.equal(mapAivoraItem({ id: "x" }), null);
  const f = mapAivoraItem({ id: "x", video_url: "https://x/a.mp4", duration: 14.6, topic: "  " });
  assert.ok(f);
  assert.equal(f.durationSec, 15);
  assert.equal(f.topic, null);
});

// ── 分页解析:meta 口径、满页判定、next_since ──
ok("页解析与满页判定", () => {
  const page = parseAivoraPage(
    {
      videos: [
        { id: "a", video_url: "https://x/a.mp4", completed_at: "2026-08-03T17:28:00.000Z" },
        { bad: true },
      ],
      meta: { count: 2, skipped_unbranded: 3, next_since: "2026-08-03T17:28:00.000Z" },
    },
    2,
  );
  assert.equal(page.videos.length, 1); // 非法条目丢弃
  assert.equal(page.count, 2); // 满页按服务端口径
  assert.equal(page.skippedUnbranded, 3);
  assert.equal(page.nextSince, "2026-08-03T17:28:00.000Z");
  assert.equal(page.isFull, true);

  const empty = parseAivoraPage({ videos: [], meta: { count: 0, next_since: null } }, AIVORA_PAGE_LIMIT);
  assert.equal(empty.isFull, false);
  assert.equal(empty.nextSince, null); // null → 下轮沿用上一次 since

  const noMeta = parseAivoraPage({ videos: [] }, AIVORA_PAGE_LIMIT);
  assert.equal(noMeta.count, 0);
  assert.equal(noMeta.skippedUnbranded, 0);
});

// ── fetch 层:URL/鉴权头/错误分类(§8)──
process.env.AIVORA_API_URL = "https://reelforge-delta.vercel.app";
process.env.AIVORA_API_KEY = "test-token-not-real";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function asyncCases() {
await ok("请求构造:status/limit/since 参数与 Bearer 头", async () => {
  let seenUrl = "";
  let seenAuth: string | null = null;
  const page = await fetchAivoraPage({
    since: "2026-08-03T17:28:00.000Z",
    limit: 200,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = new Headers(init?.headers).get("authorization");
      return jsonResponse(200, { videos: [], meta: { count: 0, skipped_unbranded: 0, next_since: null } });
    }) as typeof fetch,
  });
  const u = new URL(seenUrl);
  assert.equal(u.pathname, "/api/videos");
  assert.equal(u.searchParams.get("status"), "completed");
  assert.equal(u.searchParams.get("limit"), "200");
  assert.equal(u.searchParams.get("since"), "2026-08-03T17:28:00.000Z");
  assert.equal(seenAuth, "Bearer test-token-not-real");
  assert.equal(page.videos.length, 0);
});

await ok("401 → 不可重试错误(单次请求即抛)", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAivoraPageWithRetry({
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse(401, { error: "unauthorized" });
      }) as typeof fetch,
    }),
    (e: unknown) => e instanceof AivoraApiError && e.status === 401 && !e.retryable,
  );
  assert.equal(calls, 1); // 契约 §8:401 不自动重试
});

await ok("503 → 退避重试后成功", async () => {
  let calls = 0;
  const page = await fetchAivoraPageWithRetry({
    fetchImpl: (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(503, { error: "not configured" });
      return jsonResponse(200, { videos: [], meta: { count: 0, skipped_unbranded: 0, next_since: null } });
    }) as typeof fetch,
  });
  assert.equal(calls, 2);
  assert.equal(page.count, 0);
});

await ok("400 → 不可重试", async () => {
  let calls = 0;
  await assert.rejects(
    fetchAivoraPageWithRetry({
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse(400, { error: "bad query", details: { since: "invalid" } });
      }) as typeof fetch,
    }),
    (e: unknown) => e instanceof AivoraApiError && e.status === 400 && !e.retryable,
  );
  assert.equal(calls, 1);
});

}

asyncCases().then(() => {
  console.log(`aivora 契约适配器: ${passed}/9 passed`);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
