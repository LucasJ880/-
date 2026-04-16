/**
 * 写接口压测 — 验证并发创建的数据一致性
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) { console.error("❌ 需要 SESSION_TOKEN"); process.exit(1); }

const headers = { Cookie: `qy_session=${TOKEN}`, "Content-Type": "application/json" };

async function timedPost(url, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const elapsed = Date.now() - t0;
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, elapsed, data };
  } catch (err) {
    return { status: 0, elapsed: Date.now() - t0, error: err.message };
  }
}

function stats(times) {
  if (!times.length) return { min: 0, avg: 0, p95: 0, max: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0],
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
    max: sorted[sorted.length - 1],
  };
}

async function testConcurrentCustomerCreate() {
  console.log("\n━━━ 测试 1：并发创建客户 (10 并发) ━━━\n");

  const promises = Array.from({ length: 10 }, (_, i) =>
    timedPost(`${BASE}/api/sales/customers`, {
      name: `压测客户_${Date.now()}_${i}`,
      phone: `138${String(Date.now()).slice(-8)}`,
      source: "load_test",
    })
  );

  const results = await Promise.all(promises);
  const ok = results.filter(r => r.status === 201);
  const fail = results.filter(r => r.status >= 400);
  const times = ok.map(r => r.elapsed);
  const s = stats(times);

  console.log(`  成功: ${ok.length}/10  失败: ${fail.length}/10`);
  console.log(`  延迟: avg=${s.avg}ms  p95=${s.p95}ms  max=${s.max}ms`);
  if (fail.length) {
    console.log(`  失败详情: ${fail.map(r => `${r.status}: ${r.data?.error || r.error}`).join("; ")}`);
  }

  const icon = fail.length === 0 ? "✅" : "❌";
  console.log(`  ${icon} 客户创建 ${fail.length === 0 ? "全部成功" : "有失败"}`);

  return ok.map(r => r.data?.id).filter(Boolean);
}

async function testConcurrentOpportunityCreate(customerIds) {
  console.log("\n━━━ 测试 2：为同一客户并发创建商机 (5 并发) ━━━\n");

  if (!customerIds.length) {
    console.log("  ⚠️  无可用客户ID，跳过");
    return;
  }

  const customerId = customerIds[0];
  const promises = Array.from({ length: 5 }, (_, i) =>
    timedPost(`${BASE}/api/sales/opportunities`, {
      customerId,
      title: `压测商机_${Date.now()}_${i}`,
      stage: "new_lead",
      priority: "warm",
    })
  );

  const results = await Promise.all(promises);
  const ok = results.filter(r => r.status === 201);
  const fail = results.filter(r => r.status >= 400);
  const times = ok.map(r => r.elapsed);
  const s = stats(times);

  console.log(`  成功: ${ok.length}/5  失败: ${fail.length}/5`);
  console.log(`  延迟: avg=${s.avg}ms  p95=${s.p95}ms`);
  if (fail.length) {
    console.log(`  失败: ${fail.map(r => `${r.status}: ${r.data?.error}`).join("; ")}`);
  }

  const icon = fail.length === 0 ? "✅" : "❌";
  console.log(`  ${icon} 商机创建 ${fail.length === 0 ? "全部成功" : "有失败"}`);
}

async function testDoubleSubmit() {
  console.log("\n━━━ 测试 3：双重提交检测 (同一请求快速发两次) ━━━\n");

  const body = {
    name: `双重提交测试_${Date.now()}`,
    phone: "13800000000",
    source: "load_test",
  };

  const [r1, r2] = await Promise.all([
    timedPost(`${BASE}/api/sales/customers`, body),
    timedPost(`${BASE}/api/sales/customers`, body),
  ]);

  console.log(`  请求1: ${r1.status} (${r1.elapsed}ms) id=${r1.data?.id || "N/A"}`);
  console.log(`  请求2: ${r2.status} (${r2.elapsed}ms) id=${r2.data?.id || "N/A"}`);

  const bothCreated = r1.status === 201 && r2.status === 201;
  const sameId = r1.data?.id === r2.data?.id;

  if (bothCreated && !sameId) {
    console.log("  ⚠️  两个请求都成功创建了不同的记录（无幂等保护，当前可接受）");
  } else if (bothCreated && sameId) {
    console.log("  ✅ 幂等保护生效");
  } else {
    console.log(`  ℹ️  结果: ${r1.status}, ${r2.status}`);
  }
}

async function cleanup() {
  console.log("\n━━━ 清理压测数据 ━━━\n");

  // 通过 API 无法批量删除，打印 SQL 让用户手动清理
  console.log("  压测完成。如需清理，请在数据库执行：");
  console.log('  DELETE FROM "SalesOpportunity" WHERE title LIKE \'压测商机_%\';');
  console.log('  DELETE FROM "SalesCustomer" WHERE source = \'load_test\';');
  console.log('  DELETE FROM "SalesCustomer" WHERE name LIKE \'双重提交测试_%\';');
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     写接口压测验证                   ║");
  console.log("╚══════════════════════════════════════╝");

  const customerIds = await testConcurrentCustomerCreate();
  await testConcurrentOpportunityCreate(customerIds);
  await testDoubleSubmit();
  await cleanup();

  console.log("\n✅ 写接口测试完成\n");
}

main().catch(e => { console.error(e); process.exit(1); });
