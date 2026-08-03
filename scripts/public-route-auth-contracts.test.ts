/**
 * 公开路由鉴权契约（静态 + 最小动态）
 * - 不访问生产 DB
 * - 不扩大权限：断言 middleware public ≠ 匿名开放；密钥/Token 须路由内强制校验
 *
 * npx tsx scripts/public-route-auth-contracts.test.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { requireCronSecret } from "../src/lib/cron/auth";
import { requireTradeCronSecret } from "../src/lib/trade/access";
import { middleware } from "../src/middleware";

const root = process.cwd();
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

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function listRoutes(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listRoutes(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function extractPublicPathsArray(mwSrc: string): string[] {
  const m = mwSrc.match(/const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

async function main() {
  console.log("\nmiddleware public paths（bypass session，≠ 匿名开放）");
  const mw = read("src/middleware.ts");
  const publicPaths = extractPublicPathsArray(mw);
  for (const p of [
    "/api/cron",
    "/api/v1",
    "/api/trade/webhook",
    "/api/webhooks/firecrawl",
    "/api/messaging/wecom/callback",
    "/api/operations/worker",
    "/api/sales/quotes/share",
    "/api/visualizer/share",
    "/api/health",
    "/api/trade/cron",
  ]) {
    ok(publicPaths.includes(p), `PUBLIC_PATHS includes ${p}`);
  }
  ok(
    /function isPublicPath[\s\S]*PUBLIC_PATHS\.some/.test(mw),
    "isPublicPath uses PUBLIC_PATHS prefix match",
  );
  ok(
    /qy_session/.test(mw) && /未登录/.test(mw),
    "non-public API still requires session cookie",
  );

  console.log("\n/api/cron/* — 统一 requireCronSecret（常量时间 + 隔离 fail-closed），不依赖 session");
  const cronRoutes = listRoutes(join(root, "src/app/api/cron"));
  ok(cronRoutes.length >= 10, `cron route count >= 10 (got ${cronRoutes.length})`);
  for (const abs of cronRoutes) {
    const rel = abs.slice(root.length + 1);
    const body = readFileSync(abs, "utf8");
    ok(
      /import \{ requireCronSecret \} from "@\/lib\/cron\/auth";/.test(body),
      `${rel} imports shared requireCronSecret`,
    );
    ok(
      /const denied = requireCronSecret\(request\);\s*\n\s*if \(denied\) return denied;/.test(body),
      `${rel} fail-closed gate before business logic`,
    );
    ok(
      !/process\.env\.CRON_SECRET/.test(body) && !/!==\s*`Bearer/.test(body),
      `${rel} no inline plaintext secret compare`,
    );
    ok(!/getCurrentUser|qy_session|requireAuth/.test(body), `${rel} no browser session gate`);
  }

  console.log("\n/api/trade/cron — helper 强制 + 无旁路成功路径");
  const tradeCron = read("src/app/api/trade/cron/route.ts");
  const tradeAccess = read("src/lib/trade/access.ts");
  ok(/requireTradeCronSecret/.test(tradeCron), "trade/cron imports/calls requireTradeCronSecret");
  ok(
    /export async function POST[\s\S]*requireTradeCronSecret\(request\)[\s\S]*if \(denied\) return denied/.test(
      tradeCron,
    ),
    "POST calls helper then fail-closed return",
  );
  ok(
    /export async function GET[\s\S]*return POST\(request\)/.test(tradeCron),
    "GET delegates to POST (same gate)",
  );
  {
    const gateIdx = tradeCron.indexOf("if (denied) return denied");
    const businessIdx = tradeCron.indexOf("runDailyCron()");
    ok(
      gateIdx >= 0 && businessIdx > gateIdx,
      "runDailyCron() call only after secret gate (no bypass success path)",
    );
  }
  ok(
    /export function requireTradeCronSecret/.test(tradeAccess),
    "requireTradeCronSecret defined in trade/access",
  );
  ok(
    /return requireCronSecret\(request\);/.test(tradeAccess),
    "requireTradeCronSecret delegates to shared requireCronSecret",
  );
  const cronAuth = read("src/lib/cron/auth.ts");
  ok(
    /assertNonProdSideEffectsAllowed\(\s*["']cron["']\s*\)/.test(cronAuth),
    "shared helper enforces non-prod isolation gate first",
  );
  ok(
    /process\.env\.CRON_SECRET/.test(cronAuth) &&
      /authorization/i.test(cronAuth) &&
      /status:\s*503/.test(cronAuth) &&
      /status:\s*401/.test(cronAuth),
    "shared helper: env secret + Authorization + 503/401 fail-closed",
  );
  ok(
    /timingSafeEqual/.test(cronAuth) && /createHash\(\s*["']sha256["']\s*\)/.test(cronAuth),
    "shared helper uses sha256 digest + timingSafeEqual",
  );
  ok(
    !/authHeader\s*!==\s*`Bearer \$\{secret\}`/.test(cronAuth) &&
      !/authorization["']\s*\)\s*!==\s*`Bearer/.test(cronAuth),
    "shared helper no plaintext !== Bearer compare",
  );
  ok(
    !/searchParams\.get\(["'](?:secret|cron)/i.test(cronAuth) && !/cookie/i.test(cronAuth),
    "shared helper does not take cron secret from query/cookie",
  );
  ok(
    !/request\.(?:json|text|formData)\(/.test(cronAuth),
    "shared helper does not take cron secret from body",
  );

  console.log("\n/api/v1/* — API Token + 权限/组织，非匿名");
  const v1 = read("src/app/api/v1/projects/route.ts");
  ok(/verifyApiToken/.test(v1), "v1/projects verifyApiToken");
  ok(/hasPermission/.test(v1), "v1/projects hasPermission");
  ok(/PERMISSION_DENIED|权限不足/.test(v1), "v1/projects denies missing permission");

  console.log("\nworker / webhook / callback — 各自凭据");
  for (const rel of [
    "src/app/api/operations/worker/claim/route.ts",
    "src/app/api/operations/worker/report/route.ts",
  ]) {
    const body = read(rel);
    ok(/POSTFLOW_WORKER_TOKEN/.test(body), `${rel} uses POSTFLOW_WORKER_TOKEN`);
    ok(/status:\s*401/.test(body), `${rel} returns 401`);
  }
  ok(
    /invalid_signature|verifyWhatsAppSignature|wechatPlainSignatureOk|verifyCallback|msg_signature|FIRECRAWL|signature/.test(
      read("src/app/api/webhooks/firecrawl/market-intelligence/route.ts") +
        read("src/app/api/trade/webhook/whatsapp/route.ts") +
        read("src/app/api/trade/webhook/wechat/route.ts") +
        read("src/app/api/messaging/wecom/callback/route.ts"),
    ),
    "webhook/callback signature or token verification present",
  );

  console.log("\nshare routes — token 凭据，错误/缺失 → 404，无跨 org 枚举文案");
  for (const rel of [
    "src/app/api/sales/quotes/share/[token]/route.ts",
    "src/app/api/sales/quotes/share/[token]/sign/route.ts",
    "src/app/api/sales/quotes/share/[token]/pdf/route.ts",
  ]) {
    const body = read(rel);
    ok(/shareToken/.test(body), `${rel} resolves shareToken`);
    ok(/status:\s*404/.test(body), `${rel} returns 404 on miss`);
    ok(
      !/不属于|其他组织|orgId.*不存在/.test(body),
      `${rel} no cross-org enumeration message`,
    );
  }

  console.log("\n动态：requireTradeCronSecret / requireCronSecret（无生产 DB，环境固定为 test）");
  {
    // 固定 runtime=test 并清除影响隔离评估的变量，保证本地直跑与 CI（NODE_ENV=test）结果一致；
    // 否则非 prod 默认禁 cron，所有断言会被 503 淹没。结束后恢复原值。
    const pinnedKeys = [
      "QINGYAN_RUNTIME_ENV",
      "VERCEL_ENV",
      "DATABASE_URL",
      "DIRECT_URL",
      "QINGYAN_EXPECTED_DB_PLANE",
      "QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES",
      "QINGYAN_ALLOWED_DB_ENDPOINT_FINGERPRINTS",
      "QINGYAN_PRODUCTION_CRON_SECRET_SHA256",
      "QINGYAN_ALLOW_CRON_NON_PROD",
    ];
    const pinnedPrev = new Map<string, string | undefined>();
    for (const key of pinnedKeys) {
      pinnedPrev.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.QINGYAN_RUNTIME_ENV = "test";
    const prev = process.env.CRON_SECRET;
    const secret = "unit-test-cron-secret-do-not-leak";
    const sameLenWrong = "x".repeat(secret.length);
    try {
      delete process.env.CRON_SECRET;
      const unset = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      ok(unset instanceof Response && unset.status === 503, "unset CRON_SECRET → 503");
      if (unset) {
        const body = await readJson(unset);
        const text = JSON.stringify(body);
        ok(!text.includes(secret), "unset response does not echo secret");
      }

      process.env.CRON_SECRET = secret;
      const noAuth = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron"),
      );
      ok(noAuth instanceof Response && noAuth.status === 401, "no Authorization → 401");

      const wrongSameLen = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `Bearer ${sameLenWrong}` },
        }),
      );
      ok(
        wrongSameLen instanceof Response && wrongSameLen.status === 401,
        "wrong same-length token → 401",
      );

      const wrongDiffLen = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: "Bearer short" },
        }),
      );
      ok(
        wrongDiffLen instanceof Response && wrongDiffLen.status === 401,
        "wrong different-length token → 401",
      );
      if (wrongDiffLen) {
        const text = JSON.stringify(await readJson(wrongDiffLen));
        ok(!text.includes(secret), "wrong-auth response does not contain secret");
        ok(!text.includes("short"), "wrong-auth response does not echo wrong secret");
      }

      const emptyBearer = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: "Bearer " },
        }),
      );
      ok(emptyBearer instanceof Response && emptyBearer.status === 401, "empty Bearer token → 401");

      const lowerBearer = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `bearer ${secret}` },
        }),
      );
      ok(
        lowerBearer instanceof Response && lowerBearer.status === 401,
        "lowercase bearer scheme → 401 (strict)",
      );

      // Headers API 会剥离 header 值首尾 OWS；helper 仍要求与 `Bearer ${secret}` 精确匹配。
      const extraSpace = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `Bearer  ${secret}` },
        }),
      );
      ok(
        extraSpace instanceof Response && extraSpace.status === 401,
        "extra space after Bearer → 401",
      );
      const trailing = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `Bearer ${secret} trailing` },
        }),
      );
      ok(
        trailing instanceof Response && trailing.status === 401,
        "trailing content after token → 401",
      );

      const queryAttempt = requireTradeCronSecret(
        new NextRequest(
          `http://localhost/api/trade/cron?secret=${encodeURIComponent(secret)}&CRON_SECRET=${encodeURIComponent(secret)}`,
        ),
      );
      ok(
        queryAttempt instanceof Response && queryAttempt.status === 401,
        "query-string secret alone → 401",
      );

      const okAuth = requireTradeCronSecret(
        new NextRequest("http://localhost/api/trade/cron", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      ok(okAuth === null, "correct Bearer → auth pass (null = proceed)");

      const genericWrong = requireCronSecret(
        new NextRequest("http://localhost/api/cron/daily-brief", {
          headers: { authorization: `Bearer ${sameLenWrong}` },
        }),
      );
      ok(
        genericWrong instanceof Response && genericWrong.status === 401,
        "generic requireCronSecret wrong token → 401",
      );
      const genericOk = requireCronSecret(
        new NextRequest("http://localhost/api/cron/daily-brief", {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      ok(genericOk === null, "generic requireCronSecret correct Bearer → pass");
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
      for (const key of pinnedKeys) {
        const value = pinnedPrev.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  console.log("\n动态：middleware 对 /api/trade/cron 不要求网页 Session");
  {
    const req = new NextRequest("http://localhost/api/trade/cron", {
      method: "POST",
    });
    const res = await middleware(req);
    // public bypass → next()；非 public 未登录 API → 401 + x-auth-reason=session
    const authReason = res.headers.get("x-auth-reason");
    ok(res.status !== 401, "middleware does not 401 trade/cron without session");
    ok(authReason !== "session", "middleware does not set session auth-reason");
  }

  console.log("\n覆盖说明");
  console.log(
    "  · 已覆盖：helper 常量时间鉴权（含同长/异长错误 token）+ middleware session bypass + 静态契约",
  );
  console.log(
    "  · 未覆盖：完整 Next route handler + runDailyCron 集成（需 stub 业务与 DB，本 PR 不做）",
  );
  console.log(
    "  · 已还技术债：全部 /api/cron/* 与 /api/trade/cron 统一 requireCronSecret（常量时间 + 隔离 fail-closed）",
  );

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
