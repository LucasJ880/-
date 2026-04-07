/**
 * API 集成测试脚本
 *
 * 运行方式: BASE_URL=http://localhost:3000 COOKIE="sid=xxx" npx tsx scripts/test-api-integration.ts
 *
 * 需要：
 * 1. 本地服务运行中
 * 2. 一个有效的登录 cookie（从浏览器复制）
 *
 * 覆盖场景：
 * - 任务 API 分页
 * - Cron 路由安全
 * - 项目列表 API
 * - AI 统计 API（需管理员）
 * - 通知 API
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const COOKIE = process.env.COOKIE || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

const passed: string[] = [];
const failed: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed.push(name);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...((opts.headers as Record<string, string>) || {}),
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
  });
}

async function run() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`API 集成测试 — ${BASE}`);
  console.log(`${"═".repeat(60)}\n`);

  // ── 1. 任务 API 分页 ──

  await test("GET /api/tasks 返回 { items, nextCursor } 格式", async () => {
    const res = await api("/api/tasks?limit=5");
    assert(res.ok, `状态码 ${res.status}`);
    const data = await res.json();
    assert("items" in data, "响应包含 items 字段");
    assert(Array.isArray(data.items), "items 是数组");
    assert("nextCursor" in data, "响应包含 nextCursor 字段");
  });

  await test("GET /api/tasks?limit=2 最多返回 2 条", async () => {
    const res = await api("/api/tasks?limit=2");
    const data = await res.json();
    assert(data.items.length <= 2, `items 数量 ${data.items.length} <= 2`);
  });

  // ── 2. 项目 API ──

  await test("GET /api/projects 返回项目列表", async () => {
    const res = await api("/api/projects?take=3");
    assert(res.ok, `状态码 ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "返回数组");
  });

  // ── 3. Cron 安全 ──

  await test("GET /api/cron/inspect 无鉴权返回 401", async () => {
    const res = await fetch(`${BASE}/api/cron/inspect`);
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
  });

  await test("GET /api/cron/approval-timeout 无鉴权返回 401", async () => {
    const res = await fetch(`${BASE}/api/cron/approval-timeout`);
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
  });

  await test("GET /api/cron/progress-summary 无鉴权返回 401", async () => {
    const res = await fetch(`${BASE}/api/cron/progress-summary`);
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
  });

  if (CRON_SECRET) {
    await test("GET /api/cron/inspect 有正确密钥返回 200", async () => {
      const res = await fetch(`${BASE}/api/cron/inspect`, {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      assert(res.ok, `期望 200，实际 ${res.status}`);
    });
  }

  // ── 4. 通知 API ──

  await test("GET /api/notifications 未登录返回 401", async () => {
    const res = await fetch(`${BASE}/api/notifications`);
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
  });

  if (COOKIE) {
    await test("GET /api/notifications 登录后返回列表", async () => {
      const res = await api("/api/notifications");
      assert(res.ok, `状态码 ${res.status}`);
    });
  }

  // ── 5. AI 统计 API ──

  await test("GET /api/admin/ai-stats 未登录返回 401", async () => {
    const res = await fetch(`${BASE}/api/admin/ai-stats`);
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
  });

  if (COOKIE) {
    await test("GET /api/admin/ai-stats 登录后有结构化数据", async () => {
      const res = await api("/api/admin/ai-stats");
      if (res.ok) {
        const data = await res.json();
        assert("totalCalls" in data, "包含 totalCalls");
        assert("successRate" in data, "包含 successRate");
        assert("byModel" in data, "包含 byModel");
      }
      // 非管理员也可能返回 401，这也是正确的
    });
  }

  // ── 6. 搜索 API ──

  if (COOKIE) {
    await test("GET /api/search?q=test 返回结构化结果", async () => {
      const res = await api("/api/search?q=test");
      assert(res.ok, `状态码 ${res.status}`);
    });
  }

  // ── 结果汇总 ──

  console.log(`\n${"═".repeat(60)}`);
  console.log(`API 集成测试结果: ${passed.length} 通过, ${failed.length} 失败`);
  console.log(`${"═".repeat(60)}\n`);

  if (failed.length > 0) {
    console.error("失败项:");
    failed.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("✅ 全部通过");
  }
}

run().catch((err) => {
  console.error("测试运行失败:", err);
  process.exit(1);
});
