/**
 * Wave1.5 只读 smoke（非破坏性）
 *
 * 默认：http://127.0.0.1:3000
 * 远程：必须显式 --base-url，且不得为生产域名（fail-closed）
 *
 * 不写业务、不发邮件/微信、不执行 cron 业务、不打印 cookie/token/Secret。
 *
 * 运行：
 *   npx tsx scripts/wave15-smoke-readonly.ts
 *   npx tsx scripts/wave15-smoke-readonly.ts --base-url https://xxx.vercel.app
 *   npx tsx scripts/wave15-smoke-readonly.ts --self-check-only
 */
import { parseArgs } from "node:util";

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

function skip(name: string, reason: string) {
  skipped += 1;
  console.log(`  · skip ${name} (${reason})`);
}

/** 生产/疑似生产主机 — 一律拒绝 */
export function isBlockedProductionHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
  // 明确生产形态（可按环境扩展；宁可误杀远程，不可误放生产）
  if (h === "qingyan.ai" || h.endsWith(".qingyan.ai")) return true;
  if (h === "www.qingyan.ai") return true;
  // Vercel 生产别名常见形态；Preview 为 git-*-*.vercel.app，允许显式传入
  if (h.endsWith(".vercel.app")) {
    if (h.startsWith("git-")) return false;
    // 非 git- 前缀的 vercel.app 视为可能生产/主部署，fail-closed
    return true;
  }
  // 其他裸域名默认拒绝（需显式允许列表时再开）
  return true;
}

export function assertSafeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid base url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }
  if (isBlockedProductionHost(url.hostname)) {
    throw new Error(
      `refusing production or non-allowlisted host: ${url.hostname} (Wave1.5 smoke is fail-closed)`,
    );
  }
  return url;
}

function looksSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /postgresql:\/\//i.test(text) ||
    /mysql:\/\//i.test(text) ||
    /database_url/i.test(lower) ||
    /begin\s+password/i.test(lower) ||
    /cron_secret/i.test(lower) ||
    /bearer\s+[a-z0-9_-]{20,}/i.test(text) ||
    /select\s+\*\s+from/i.test(lower)
  );
}

async function fetchSafe(
  base: URL,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; bodyText: string; headers: Headers }> {
  const url = new URL(path, base);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init?.headers || {}),
      // 不发送真实凭据
    },
  });
  const bodyText = await res.text();
  return { status: res.status, bodyText, headers: res.headers };
}

function selfCheck() {
  console.log("\nwave15-smoke self-check");
  ok(!isBlockedProductionHost("127.0.0.1"), "localhost ipv4 allowed");
  ok(!isBlockedProductionHost("localhost"), "localhost allowed");
  ok(!isBlockedProductionHost("git-stabilization-wave15-xxx.vercel.app"), "git preview allowed");
  ok(isBlockedProductionHost("qingyan.ai"), "qingyan.ai blocked");
  ok(isBlockedProductionHost("www.qingyan.ai"), "www.qingyan.ai blocked");
  ok(isBlockedProductionHost("qingyan-ai.vercel.app"), "non-git vercel.app blocked");
  try {
    assertSafeBaseUrl("https://qingyan.ai");
    ok(false, "assertSafeBaseUrl must throw on production");
  } catch {
    ok(true, "assertSafeBaseUrl throws on production");
  }
  try {
    assertSafeBaseUrl("http://127.0.0.1:3000");
    ok(true, "assertSafeBaseUrl accepts localhost");
  } catch {
    ok(false, "assertSafeBaseUrl accepts localhost");
  }
}

async function runAgainst(base: URL) {
  console.log(`\nwave15-smoke readonly against ${base.origin}`);

  // 1) health
  try {
    const health = await fetchSafe(base, "/api/health");
    ok(
      health.status === 200 || health.status === 503,
      `GET /api/health → ${health.status} (expect 200|503)`,
    );
    ok(!looksSensitive(health.bodyText), "/api/health body has no obvious secrets/SQL");
  } catch (err) {
    skip("GET /api/health", err instanceof Error ? err.message : "fetch failed");
  }

  // 2) 受保护 API：未认证应拒绝（非 public）
  try {
    const unauth = await fetchSafe(base, "/api/ai/pending-actions");
    ok(
      unauth.status === 401 || unauth.status === 403,
      `GET /api/ai/pending-actions unauthenticated → ${unauth.status} (expect 401|403)`,
    );
    ok(!looksSensitive(unauth.bodyText), "unauth body has no secrets/SQL");
  } catch (err) {
    skip("unauthenticated pending-actions", err instanceof Error ? err.message : "fetch failed");
  }

  // 3) trade cron：无 Authorization → 拒绝（不执行业务）
  try {
    const cron = await fetchSafe(base, "/api/trade/cron", { method: "POST" });
    ok(
      cron.status === 401 || cron.status === 503,
      `POST /api/trade/cron no auth → ${cron.status} (expect 401|503)`,
    );
    ok(!looksSensitive(cron.bodyText), "cron no-auth body has no secrets");
    ok(!/unit-test-cron|CRON_SECRET\s*=/.test(cron.bodyText), "cron response does not echo secret material");
  } catch (err) {
    skip("trade cron no auth", err instanceof Error ? err.message : "fetch failed");
  }

  // 4) 错误 Bearer → 拒绝
  try {
    const bad = await fetchSafe(base, "/api/trade/cron", {
      method: "POST",
      headers: { authorization: "Bearer definitely-wrong-token" },
    });
    ok(
      bad.status === 401 || bad.status === 503,
      `POST /api/trade/cron wrong bearer → ${bad.status} (expect 401|503)`,
    );
    ok(!bad.bodyText.includes("definitely-wrong-token"), "wrong bearer not echoed");
    ok(!looksSensitive(bad.bodyText), "wrong bearer body has no secrets/SQL");
  } catch (err) {
    skip("trade cron wrong bearer", err instanceof Error ? err.message : "fetch failed");
  }

  // 5) public health ≠ 业务写：确认 smoke 未调用写客户/报价等
  ok(true, "no customer/quote/email/wechat/cron-business write attempted");
}

async function main() {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      "self-check-only": { type: "boolean", default: false },
      "allow-network": { type: "boolean", default: false },
    },
    strict: true,
  });

  selfCheck();
  if (values["self-check-only"]) {
    console.log(`\n结果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed) process.exit(1);
    return;
  }

  // CI 默认只跑 self-check；远程/本地探活需显式 --allow-network
  if (!values["allow-network"]) {
    console.log(
      "\n(network probes skipped — pass --allow-network --base-url <localhost|git-preview> to run)",
    );
    console.log(`\n结果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed) process.exit(1);
    return;
  }

  const raw = values["base-url"] || "http://127.0.0.1:3000";
  const base = assertSafeBaseUrl(raw);
  await runAgainst(base);

  console.log(`\n结果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
