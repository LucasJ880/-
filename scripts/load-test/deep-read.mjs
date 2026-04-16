/**
 * 读接口深度压测 — 分析瓶颈在哪
 *
 * 1. 串行 baseline（排除并发因素）
 * 2. 递增并发（5→10→20→30）找拐点
 * 3. 单独测最慢接口
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) { console.error("❌ 需要 SESSION_TOKEN"); process.exit(1); }

const headers = { Cookie: `qy_session=${TOKEN}` };

async function timedFetch(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers });
  const elapsed = Date.now() - t0;
  return { status: res.status, elapsed };
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
  return { min: sorted[0], avg: Math.round(sum / sorted.length), p95, max: sorted[sorted.length - 1] };
}

async function serialBaseline() {
  console.log("\n━━━ 串行基线（无并发，纯接口延迟）━━━\n");
  const endpoints = [
    { path: "/api/auth/me", name: "auth/me" },
    { path: "/api/sales/customers?page=1&pageSize=5", name: "customers" },
    { path: "/api/sales/opportunities", name: "opportunities" },
    { path: "/api/sales/quotes/list", name: "quotes/list" },
  ];

  for (const ep of endpoints) {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const r = await timedFetch(`${BASE}${ep.path}`);
      times.push(r.elapsed);
    }
    const s = stats(times);
    const bar = "█".repeat(Math.min(Math.round(s.avg / 20), 50));
    console.log(`  ${ep.name.padEnd(16)} avg=${String(s.avg).padStart(4)}ms  p95=${String(s.p95).padStart(4)}ms  ${bar}`);
  }
}

async function concurrencyRamp() {
  console.log("\n━━━ 并发递增测试（找拐点）━━━\n");
  const url = `${BASE}/api/sales/customers?page=1&pageSize=5`;

  for (const n of [1, 5, 10, 20, 30]) {
    const promises = Array.from({ length: n }, () => timedFetch(url));
    const results = await Promise.all(promises);
    const times = results.map(r => r.elapsed);
    const errors = results.filter(r => r.status >= 500).length;
    const s = stats(times);

    const bar = "█".repeat(Math.min(Math.round(s.avg / 20), 50));
    const errTag = errors > 0 ? ` ⚠️ ${errors} errors` : "";
    console.log(`  ${String(n).padStart(2)} 并发:  avg=${String(s.avg).padStart(5)}ms  p95=${String(s.p95).padStart(5)}ms  max=${String(s.max).padStart(5)}ms${errTag}  ${bar}`);
  }
}

async function quotesDeep() {
  console.log("\n━━━ quotes/list 单独分析（最慢接口）━━━\n");
  const url = `${BASE}/api/sales/quotes/list`;

  // 串行 5 次
  const serial = [];
  for (let i = 0; i < 5; i++) {
    const r = await timedFetch(url);
    serial.push(r.elapsed);
  }
  const s1 = stats(serial);
  console.log(`  串行 5次: avg=${s1.avg}ms p95=${s1.p95}ms`);

  // 并发 10 次
  const par = await Promise.all(Array.from({ length: 10 }, () => timedFetch(url)));
  const s2 = stats(par.map(r => r.elapsed));
  console.log(`  并发10次: avg=${s2.avg}ms p95=${s2.p95}ms max=${s2.max}ms`);

  const ratio = (s2.avg / s1.avg).toFixed(1);
  console.log(`  并发退化倍数: ${ratio}x ${Number(ratio) > 3 ? "⚠️ 退化严重" : "✅ 可接受"}`);
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     读接口深度压测                   ║");
  console.log("╚══════════════════════════════════════╝");

  await serialBaseline();
  await concurrencyRamp();
  await quotesDeep();

  console.log("\n✅ 深度测试完成\n");
}

main().catch(e => { console.error(e); process.exit(1); });
