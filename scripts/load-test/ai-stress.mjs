/**
 * AI 接口压力测试 — Node.js 版
 *
 * 测试目标：
 *   1. 验证 30s 单轮超时 + 90s 总超时是否生效
 *   2. AI 接口真实延迟分布
 *   3. 并发 AI 请求时系统表现
 *   4. 超时/错误时是否返回友好消息
 *
 * ⚠️ 会消耗真实 OpenAI token，控制在 ~15 次请求
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) { console.error("❌ 需要 SESSION_TOKEN"); process.exit(1); }

const headers = {
  Cookie: `qy_session=${TOKEN}`,
  "Content-Type": "application/json",
};

const prompts = [
  "帮我整理一下本周的工作重点",
  "我有一个新客户需要跟进，你有什么建议？",
  "帮我写一封简短的报价跟进邮件",
  "下周二下午三点和供应商开会，帮我记一下",
  "分析一下最近的销售数据趋势",
];

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
  return { min: sorted[0], avg: Math.round(sum / sorted.length), p95, max: sorted[sorted.length - 1] };
}

async function aiCall(prompt, timeoutMs = 95000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/agent-core/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        mode: "fast",
      }),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    clearTimeout(timer);

    let body = null;
    try { body = await res.json(); } catch {}

    return {
      status: res.status,
      elapsed,
      hasContent: body?.content?.length > 0,
      contentPreview: body?.content?.substring(0, 80) || body?.error || "(empty)",
      model: body?.model || "unknown",
      rounds: body?.rounds ?? 0,
      toolCalls: body?.toolCalls?.length ?? 0,
      error: body?.error || null,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      status: 0,
      elapsed: Date.now() - t0,
      hasContent: false,
      contentPreview: e.name === "AbortError" ? "CLIENT_TIMEOUT" : e.message,
      model: "N/A",
      rounds: 0,
      toolCalls: 0,
      error: e.message,
    };
  }
}

async function phase1_serial() {
  console.log("\n━━━ Phase 1: 串行基线（3 次请求）━━━\n");
  const results = [];

  for (let i = 0; i < 3; i++) {
    const prompt = prompts[i];
    console.log(`  [${i + 1}/3] "${prompt.substring(0, 20)}..."`);
    const r = await aiCall(prompt);
    results.push(r);
    console.log(`    → ${r.status} | ${r.elapsed}ms | model=${r.model} rounds=${r.rounds} tools=${r.toolCalls}`);
    console.log(`    → ${r.contentPreview}`);
  }

  const times = results.filter(r => r.status === 200).map(r => r.elapsed);
  if (times.length > 0) {
    const s = stats(times);
    console.log(`\n  串行统计: avg=${s.avg}ms p95=${s.p95}ms max=${s.max}ms`);
  }
  const ok = results.filter(r => r.status === 200).length;
  const fail = results.filter(r => r.status >= 400 || r.status === 0).length;
  console.log(`  成功=${ok} 失败=${fail}`);
  return results;
}

async function phase2_concurrent() {
  console.log("\n━━━ Phase 2: 并发测试（3 个同时请求）━━━\n");

  const tasks = prompts.slice(0, 3).map((p, i) => {
    console.log(`  启动 [${i + 1}] "${p.substring(0, 20)}..."`);
    return aiCall(p);
  });

  const results = await Promise.all(tasks);
  console.log("");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  [${i + 1}] ${r.status} | ${r.elapsed}ms | model=${r.model}`);
    console.log(`      → ${r.contentPreview}`);
  }

  const times = results.map(r => r.elapsed);
  const s = stats(times);
  console.log(`\n  并发统计: avg=${s.avg}ms p95=${s.p95}ms max=${s.max}ms`);

  const hangCount = results.filter(r => r.elapsed > 30000).length;
  const errorCount = results.filter(r => r.status >= 500 || r.status === 0).length;
  console.log(`  超过30s=${hangCount} 服务器错误=${errorCount}`);

  return results;
}

async function phase3_timeout_verify() {
  console.log("\n━━━ Phase 3: 超时机制验证 ━━━\n");

  console.log("  发送一个可能触发长时间思考的请求...");
  const longPrompt = "请详细分析中美贸易战对窗帘出口行业的影响，包括关税变化、供应链调整、替代市场开拓，以及给出具体的应对策略和时间表，每个策略至少包含3个具体行动步骤";

  const r = await aiCall(longPrompt, 100000);
  console.log(`  状态: ${r.status}`);
  console.log(`  耗时: ${r.elapsed}ms`);
  console.log(`  内容: ${r.contentPreview}`);

  if (r.elapsed > 90000) {
    console.log("  ⚠️ 超过 90s 总超时，超时机制可能未生效");
  } else if (r.elapsed > 30000) {
    console.log("  ℹ️ 超过 30s 但在 90s 内，AI 多轮调用中");
  } else {
    console.log("  ✅ 在 30s 内完成");
  }

  return r;
}

async function phase4_error_handling() {
  console.log("\n━━━ Phase 4: 错误处理验证 ━━━\n");

  console.log("  测试空消息...");
  const r1 = await aiCall("");
  console.log(`    → ${r1.status} | ${r1.contentPreview}`);
  console.log(`    ${r1.status === 200 || r1.status === 400 ? "✅" : "⚠️"} ${r1.status === 400 ? "正确返回400" : "返回了内容"}`);

  console.log("  测试超长输入...");
  const longInput = "测试".repeat(5000);
  const r2 = await aiCall(longInput);
  console.log(`    → ${r2.status} | ${r2.elapsed}ms | ${r2.error || "无错误"}`);

  return [r1, r2];
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     AI 接口压力测试                   ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  目标: ${BASE}/api/agent-core/chat`);
  console.log(`  ⚠️ 将消耗真实 OpenAI token（约 15 次请求）`);

  const serial = await phase1_serial();
  const concurrent = await phase2_concurrent();
  const timeout = await phase3_timeout_verify();
  const errors = await phase4_error_handling();

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║     测试总结                         ║");
  console.log("╚══════════════════════════════════════╝\n");

  const allResults = [...serial, ...concurrent, timeout, ...errors];
  const total = allResults.length;
  const ok = allResults.filter(r => r.status === 200).length;
  const clientTimeout = allResults.filter(r => r.elapsed > 95000).length;
  const serverError = allResults.filter(r => r.status >= 500).length;
  const validTimes = allResults.filter(r => r.status === 200).map(r => r.elapsed);
  const s = validTimes.length > 0 ? stats(validTimes) : null;

  console.log(`  总请求: ${total}`);
  console.log(`  成功: ${ok}`);
  console.log(`  服务器错误(5xx): ${serverError}`);
  console.log(`  客户端超时(>95s): ${clientTimeout}`);
  if (s) {
    console.log(`  延迟: avg=${s.avg}ms p95=${s.p95}ms max=${s.max}ms`);
    console.log(`  ${s.p95 < 30000 ? "✅ p95 < 30s" : "⚠️ p95 >= 30s"}`);
  }
  console.log(`  ${serverError === 0 ? "✅ 无服务器错误" : "⚠️ 存在服务器错误"}`);
  console.log(`  ${clientTimeout === 0 ? "✅ 无请求挂死" : "⚠️ 存在请求挂死"}`);

  console.log("\n✅ AI 压测完成\n");
}

main().catch(e => { console.error(e); process.exit(1); });
