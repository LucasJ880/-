/**
 * 压测验证脚本 — 纯 Node.js，无外部依赖
 *
 * 验证四项：
 *   1. 登录限流是否在第 11 次触发 429
 *   2. 读接口并发响应时间
 *   3. 公开页面并发响应时间
 *   4. 未登录请求是否正确返回 401
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

// ── 工具函数 ──────────────────────────────────

async function timedFetch(url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, opts);
    const elapsed = Date.now() - t0;
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, elapsed, body, headers: Object.fromEntries(res.headers), ok: true };
  } catch (err) {
    return { status: 0, elapsed: Date.now() - t0, error: err.message, ok: false };
  }
}

function stats(times) {
  if (!times.length) return { min: 0, max: 0, avg: 0, p95: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95idx = Math.floor(sorted.length * 0.95);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p95: sorted[Math.min(p95idx, sorted.length - 1)],
    count: sorted.length,
  };
}

function printResult(name, passed, detail) {
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name}`);
  if (detail) console.log(`   ${detail}`);
}

// ── 测试 1：登录限流验证 ──────────────────────

async function testRateLimit() {
  console.log("\n━━━ 测试 1：登录限流验证 ━━━");
  console.log("   发送 15 次错误登录，验证第 11 次返回 429\n");

  const results = [];
  for (let i = 1; i <= 15; i++) {
    const r = await timedFetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "loadtest@example.com", password: "wrong" }),
    });
    results.push({ i, status: r.status, elapsed: r.elapsed });
    // 不加延迟，尽量快速连发
  }

  const first429 = results.find(r => r.status === 429);
  const allStatuses = results.map(r => `${r.i}:${r.status}`).join(" ");
  console.log(`   请求状态: ${allStatuses}`);

  if (first429) {
    printResult(
      `限流在第 ${first429.i} 次触发 (预期: 第 11 次)`,
      first429.i >= 10 && first429.i <= 12,
      `首次 429 在第 ${first429.i} 次请求`
    );
    const count429 = results.filter(r => r.status === 429).length;
    printResult(`后续请求持续被限流`, count429 >= 4, `共 ${count429} 次 429`);
  } else {
    printResult("限流触发", false, "15 次请求中没有出现 429！限流可能未生效");
  }

  return !!first429;
}

// ── 测试 2：未认证请求返回 401 ────────────────

async function testUnauth() {
  console.log("\n━━━ 测试 2：未认证请求验证 ━━━\n");

  const endpoints = [
    "/api/sales/customers",
    "/api/sales/opportunities",
    "/api/sales/quotes/list",
    "/api/auth/me",
  ];

  let allPassed = true;
  for (const ep of endpoints) {
    const r = await timedFetch(`${BASE}${ep}`);
    const passed = r.status === 401;
    printResult(`${ep} → ${r.status}`, passed, `${r.elapsed}ms`);
    if (!passed) allPassed = false;
  }

  return allPassed;
}

// ── 测试 3：公开页面并发 ──────────────────────

async function testPublicConcurrent() {
  console.log("\n━━━ 测试 3：公开页面并发 (20 并发) ━━━\n");

  // 用一个不存在的 token，验证 400/404 响应速度
  const concurrency = 20;
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(
      timedFetch(`${BASE}/api/sales/quotes/share/fake_token_${i}`)
    );
  }

  const results = await Promise.all(promises);
  const times = results.filter(r => r.ok).map(r => r.elapsed);
  const statuses = results.map(r => r.status);
  const s = stats(times);

  console.log(`   状态码分布: ${[...new Set(statuses)].map(s => `${s}(${statuses.filter(x => x === s).length})`).join(", ")}`);
  console.log(`   延迟: min=${s.min}ms avg=${s.avg}ms p95=${s.p95}ms max=${s.max}ms`);

  const allValid = results.every(r => r.status === 400 || r.status === 404);
  printResult("所有请求返回 400 或 404（非 500）", allValid);
  printResult("p95 < 500ms", s.p95 < 500, `实际 p95: ${s.p95}ms`);

  return allValid && s.p95 < 500;
}

// ── 测试 4：读接口并发（需要登录态）────────────

async function testAuthenticatedRead(sessionToken) {
  console.log("\n━━━ 测试 4：读接口并发 (10 并发 × 4 接口) ━━━\n");

  if (!sessionToken) {
    console.log("   ⚠️  未提供 SESSION_TOKEN，跳过此测试");
    return null;
  }

  const endpoints = [
    "/api/sales/customers?page=1&pageSize=5",
    "/api/sales/opportunities",
    "/api/sales/quotes/list",
    "/api/auth/me",
  ];

  const promises = [];
  for (const ep of endpoints) {
    for (let i = 0; i < 10; i++) {
      promises.push(
        timedFetch(`${BASE}${ep}`, {
          headers: { Cookie: `qy_session=${sessionToken}` },
        }).then(r => ({ ...r, endpoint: ep }))
      );
    }
  }

  const results = await Promise.all(promises);

  for (const ep of endpoints) {
    const epResults = results.filter(r => r.endpoint === ep);
    const times = epResults.filter(r => r.ok).map(r => r.elapsed);
    const errors = epResults.filter(r => r.status >= 400).length;
    const s = stats(times);

    const name = ep.split("?")[0].replace("/api/", "");
    printResult(
      `${name}: avg=${s.avg}ms p95=${s.p95}ms errors=${errors}`,
      s.p95 < 1000 && errors === 0,
    );
  }

  const allTimes = results.filter(r => r.ok).map(r => r.elapsed);
  const overall = stats(allTimes);
  console.log(`\n   总体: ${overall.count} 请求, avg=${overall.avg}ms, p95=${overall.p95}ms, max=${overall.max}ms`);

  const totalErrors = results.filter(r => r.status >= 500).length;
  printResult("零 500 错误", totalErrors === 0, `${totalErrors} 个 500 错误`);

  return totalErrors === 0;
}

// ── 主流程 ────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     青砚压测验证 — 快速自检          ║");
  console.log(`║     目标: ${BASE.padEnd(26)}║`);
  console.log("╚══════════════════════════════════════╝");

  const sessionToken = process.env.SESSION_TOKEN;

  const r1 = await testRateLimit();

  // 限流测试后等 61 秒让窗口过期，或者直接继续（不影响其他测试）
  const r2 = await testUnauth();
  const r3 = await testPublicConcurrent();
  const r4 = await testAuthenticatedRead(sessionToken);

  console.log("\n━━━ 总结 ━━━\n");
  printResult("登录限流", r1);
  printResult("未认证保护", r2);
  printResult("公开页面并发", r3);
  if (r4 !== null) printResult("读接口并发", r4);
  else console.log("⏭️  读接口并发（跳过，需 SESSION_TOKEN）");

  const allPassed = r1 && r2 && r3 && (r4 === null || r4);
  console.log(`\n${allPassed ? "✅ 全部通过" : "❌ 存在失败项，请检查上方详情"}\n`);
}

main().catch(err => {
  console.error("验证脚本出错:", err);
  process.exit(1);
});
