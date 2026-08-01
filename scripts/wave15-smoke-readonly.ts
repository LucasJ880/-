/**
 * Wave1.5 只读 smoke（非破坏性）
 *
 * 模式：
 *   # CI / 本地安全自检（不发网络请求）
 *   npx tsx scripts/wave15-smoke-readonly.ts --self-check-only
 *
 *   # 本地网络 smoke（严格：不可达/超时/TLS/DNS 均 FAIL）
 *   npx tsx scripts/wave15-smoke-readonly.ts \
 *     --allow-network \
 *     --base-url http://127.0.0.1:3000
 *
 *   # Preview 网络 smoke（仅 git-*.vercel.app + HTTPS）
 *   npx tsx scripts/wave15-smoke-readonly.ts \
 *     --allow-network \
 *     --base-url https://git-xxx.vercel.app
 *
 * 不写业务、不发邮件/微信、不执行 cron 业务、不打印 cookie/token/Secret。
 * 不用正确 CRON_SECRET，不读生产 token。
 */
import { parseArgs } from "node:util";

const FETCH_TIMEOUT_MS = 12_000;

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

function fail(name: string, detail: string) {
  failed += 1;
  console.log(`  ✗ ${name}: ${detail}`);
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/wave15-smoke-readonly.ts --self-check-only",
    "  npx tsx scripts/wave15-smoke-readonly.ts --allow-network --base-url http://127.0.0.1:3000",
    "  npx tsx scripts/wave15-smoke-readonly.ts --allow-network --base-url https://git-<preview>.vercel.app",
    "",
    "Rules:",
    "  --base-url requires --allow-network",
    "  --self-check-only cannot combine with --allow-network",
    "  remote hosts must be https://git-*.vercel.app",
    "  production / non-allowlisted hosts are refused",
  ].join("\n");
}

/** 本地或 git Preview 以外一律视为阻断主机 */
export function isBlockedProductionHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
  if (h === "qingyan.ai" || h.endsWith(".qingyan.ai")) return true;
  if (h === "qingyan.ca" || h.endsWith(".qingyan.ca")) return true;
  if (h.endsWith(".vercel.app")) {
    // 仅 git- 前缀 Preview 允许；其余 vercel.app fail-closed
    return !h.startsWith("git-");
  }
  // 任意其他外部裸域名
  return true;
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function isGitVercelPreview(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.endsWith(".vercel.app") && h.startsWith("git-");
}

export function assertSafeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid base url: ${raw}`);
  }
  if (url.username || url.password) {
    throw new Error("refusing URL with embedded username/password");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }
  if (isBlockedProductionHost(url.hostname)) {
    throw new Error(
      `refusing production or non-allowlisted host: ${url.hostname} (Wave1.5 smoke is fail-closed)`,
    );
  }
  if (isGitVercelPreview(url.hostname) && url.protocol !== "https:") {
    throw new Error("remote Preview must use HTTPS (http://git-*.vercel.app refused)");
  }
  if (!isLocalHost(url.hostname) && !isGitVercelPreview(url.hostname)) {
    throw new Error(`host not in allowlist: ${url.hostname}`);
  }
  if (!isLocalHost(url.hostname) && url.protocol !== "https:") {
    throw new Error("non-local base-url must use HTTPS");
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
): Promise<{ status: number; bodyText: string }> {
  const url = new URL(path, base);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      ...(init?.headers || {}),
    },
  });
  const bodyText = await res.text();
  return { status: res.status, bodyText };
}

function selfCheck() {
  console.log("\nwave15-smoke self-check");
  ok(!isBlockedProductionHost("127.0.0.1"), "localhost ipv4 allowed");
  ok(!isBlockedProductionHost("localhost"), "localhost allowed");
  ok(!isBlockedProductionHost("::1"), "::1 allowed");
  ok(
    !isBlockedProductionHost("git-stabilization-wave15-xxx.vercel.app"),
    "git preview allowed",
  );

  ok(isBlockedProductionHost("qingyan.ai"), "qingyan.ai blocked");
  ok(isBlockedProductionHost("www.qingyan.ai"), "www.qingyan.ai blocked");
  ok(isBlockedProductionHost("qingyan.ca"), "qingyan.ca blocked");
  ok(isBlockedProductionHost("www.qingyan.ca"), "www.qingyan.ca blocked");
  ok(isBlockedProductionHost("app.qingyan.ca"), "app.qingyan.ca blocked");
  ok(isBlockedProductionHost("qingyan-ai.vercel.app"), "non-git vercel.app blocked");
  ok(isBlockedProductionHost("example.com"), "arbitrary external host blocked");

  const mustThrow = (raw: string, label: string) => {
    try {
      assertSafeBaseUrl(raw);
      ok(false, label);
    } catch {
      ok(true, label);
    }
  };
  const mustAccept = (raw: string, label: string) => {
    try {
      assertSafeBaseUrl(raw);
      ok(true, label);
    } catch {
      ok(false, label);
    }
  };

  mustThrow("https://qingyan.ai", "assertSafeBaseUrl rejects qingyan.ai");
  mustThrow("https://qingyan.ca", "assertSafeBaseUrl rejects qingyan.ca");
  mustThrow("https://www.qingyan.ca", "assertSafeBaseUrl rejects www.qingyan.ca");
  mustThrow("https://app.qingyan.ca", "assertSafeBaseUrl rejects app.qingyan.ca");
  mustThrow("https://qingyan-ai.vercel.app", "assertSafeBaseUrl rejects non-git vercel.app");
  mustThrow("https://example.com", "assertSafeBaseUrl rejects arbitrary external host");
  mustThrow(
    "http://git-stabilization-wave15-xxx.vercel.app",
    "assertSafeBaseUrl rejects HTTP remote Preview",
  );
  mustThrow(
    "https://user:pass@git-stabilization-wave15-xxx.vercel.app",
    "assertSafeBaseUrl rejects URL username/password",
  );
  mustAccept("http://127.0.0.1:3000", "assertSafeBaseUrl accepts localhost http");
  mustAccept(
    "https://git-stabilization-wave15-xxx.vercel.app",
    "assertSafeBaseUrl accepts HTTPS git Preview",
  );
}

async function probe(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 不打印可能含敏感信息的完整 URL/头；仅短错误类型
    const short =
      /abort|timeout/i.test(msg)
        ? "timeout"
        : /ENOTFOUND|getaddrinfo/i.test(msg)
          ? "dns_error"
          : /ECONNREFUSED|connect/i.test(msg)
            ? "connection_refused"
            : /certificate|TLS|SSL/i.test(msg)
              ? "tls_error"
              : "fetch_failed";
    fail(name, short);
  }
}

async function runAgainst(base: URL) {
  console.log(`\nwave15-smoke readonly against ${base.origin}`);
  console.log(`  (timeout=${FETCH_TIMEOUT_MS}ms; network errors are FAIL)`);

  await probe("GET /api/health", async () => {
    const health = await fetchSafe(base, "/api/health");
    ok(
      health.status === 200 || health.status === 503,
      `GET /api/health → ${health.status} (expect 200|503)`,
    );
    ok(!looksSensitive(health.bodyText), "/api/health body has no obvious secrets/SQL");
  });

  await probe("GET /api/ai/pending-actions unauthenticated", async () => {
    const unauth = await fetchSafe(base, "/api/ai/pending-actions");
    ok(
      unauth.status === 401 || unauth.status === 403,
      `GET /api/ai/pending-actions unauthenticated → ${unauth.status} (expect 401|403)`,
    );
    ok(!looksSensitive(unauth.bodyText), "unauth body has no secrets/SQL");
  });

  await probe("POST /api/trade/cron no auth", async () => {
    const cron = await fetchSafe(base, "/api/trade/cron", { method: "POST" });
    ok(
      cron.status === 401 || cron.status === 503,
      `POST /api/trade/cron no auth → ${cron.status} (expect 401|503)`,
    );
    ok(!looksSensitive(cron.bodyText), "cron no-auth body has no secrets");
  });

  await probe("POST /api/trade/cron wrong bearer", async () => {
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
  });

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

  const selfOnly = Boolean(values["self-check-only"]);
  const allowNetwork = Boolean(values["allow-network"]);
  const baseUrl = values["base-url"];

  if (selfOnly && allowNetwork) {
    console.error("error: --self-check-only cannot be combined with --allow-network\n");
    console.error(usage());
    process.exit(1);
  }

  if (baseUrl && !allowNetwork) {
    console.error("error: --base-url requires --allow-network\n");
    console.error(usage());
    process.exit(1);
  }

  if (selfOnly) {
    selfCheck();
    console.log(`\n结果: ${passed} passed, ${failed} failed`);
    console.log("(network probes not requested — CI/self-check mode)");
    if (failed) process.exit(1);
    return;
  }

  if (!allowNetwork) {
    // 未请求网络：仅自检；skip 语义仅表示“未请求”，不是探测失败
    selfCheck();
    console.log("\n(network probes not requested — pass --allow-network --base-url … to run)");
    console.log(`\n结果: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
    return;
  }

  // 严格网络模式
  selfCheck();
  if (failed) {
    console.log(`\n结果: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  const raw = baseUrl || "http://127.0.0.1:3000";
  let base: URL;
  try {
    base = assertSafeBaseUrl(raw);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    console.error(usage());
    process.exit(1);
  }

  await runAgainst(base);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
