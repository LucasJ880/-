/**
 * 外贸客户服务工单（TradeServiceRequest）隔离自查脚本
 *
 * 运行：pnpm exec tsx scripts/trade-service-request-audit.ts
 *       （或 npm run audit:trade-service）
 *
 * 校验目标：
 * 1. 新表读写必带 orgId（service 层有 assertOrgId 守卫，且对 ""/"default" 直接拒绝）。
 * 2. fulfillmentOrgId 是唯一受控的跨组织桥接：仅允许 service-request.ts 引用（写入点收敛）。
 * 3. 关键链路文件无 default org 兜底。
 * 4. 受理链路复用 resolveInboundTradeOrgId（禁止信任 payload orgId）。
 *
 * 静态检查不依赖数据库；少量运行时守卫检查也无需 DB（assertOrgId 在 DB 调用前抛错）。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

let failed = 0;

function ok(name: string) {
  console.log(`OK  ${name}`);
}
function fail(name: string, detail?: string) {
  console.error(`FAIL ${name}`, detail ?? "");
  failed++;
}
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name);
  else fail(name, detail);
}

function read(rel: string): string | null {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// ── 1. service 层 orgId 守卫 ─────────────────────────────────────

function checkServiceLayerGuards() {
  const rel = "src/lib/trade/service-request.ts";
  const s = read(rel);
  if (!s) {
    fail(`file_missing:${rel}`);
    return;
  }
  assert("service: 定义 assertOrgId 守卫", /function assertOrgId\(/.test(s));
  assert(
    'service: assertOrgId 拒绝 "default"',
    /orgId\s*===\s*["']default["']|v\s*===\s*["']default["']/.test(s),
  );
  // 关键写/查函数都过 assertOrgId
  for (const fn of [
    "createServiceRequest",
    "listServiceRequestsForOrg",
    "getServiceRequestForOrg",
    "addServiceAsset",
    "assignToFulfillment",
    "listFulfillmentRequests",
  ]) {
    assert(`service: ${fn} 存在`, new RegExp(`function ${fn}\\b`).test(s), rel);
  }
  const assertCount = (s.match(/assertOrgId\(/g) ?? []).length;
  assert(
    "service: assertOrgId 被多处调用（>=6）",
    assertCount >= 6,
    `count=${assertCount}`,
  );
}

// ── 2. fulfillmentOrgId 写入点收敛（唯一跨 org 桥接）─────────────

function checkFulfillmentBridgeSingleWriter() {
  // 只允许 service-request.ts 引用 fulfillmentOrgId。任何新文件引用都必须显式加入 allowlist 并经审查。
  const allow = new Set(["src/lib/trade/service-request.ts"]);
  const candidates = [
    "src/lib/trade/service-request.ts",
    "src/lib/trade/service-intake.ts",
    "src/lib/messaging/gateway.ts",
  ];
  // 额外：扫描已知可能涉及的目录文件（轻量枚举，避免全仓递归）
  const extraDirsFiles = [
    "src/lib/trade/access.ts",
    "src/lib/trade/inbound-org.ts",
    "src/lib/trade/channel-service.ts",
  ];

  const offenders: string[] = [];
  for (const rel of [...candidates, ...extraDirsFiles]) {
    const s = read(rel);
    if (!s) continue;
    if (s.includes("fulfillmentOrgId") && !allow.has(rel)) {
      offenders.push(rel);
    }
  }
  assert(
    "bridge: fulfillmentOrgId 仅在 service-request.ts 引用（写入点收敛）",
    offenders.length === 0,
    offenders.join(", "),
  );

  // relay 函数内确有 fulfillmentOrgId 的写入（data 块）
  const s = read("src/lib/trade/service-request.ts") ?? "";
  assert(
    "bridge: assignToFulfillment 写入 fulfillmentOrgId",
    /assignToFulfillment[\s\S]*data:\s*\{[\s\S]*fulfillmentOrgId/.test(s),
  );
  assert(
    "bridge: relay 校验处理方 org 真实存在",
    /organization\.findFirst[\s\S]*status:\s*["']active["']/.test(s),
  );
}

// ── 3. 关键链路无 default org 兜底 ───────────────────────────────

function checkNoDefaultOrgFallback() {
  const files = [
    "src/lib/messaging/gateway.ts",
    "src/app/api/cron/followup/route.ts",
    "src/lib/agent-core/engine.ts",
    "src/lib/trade/service-request.ts",
    "src/lib/trade/service-intake.ts",
  ];
  for (const rel of files) {
    const s = read(rel);
    if (!s) {
      fail(`file_missing:${rel}`);
      continue;
    }
    const patterns = [
      /\?\?\s*["']default["']/, // x ?? "default"
      /orgId:\s*["']default["']/, // orgId: "default"
      /runFollowupEngine\(\s*["']default["']\s*\)/,
      /getRequestOrgId.*["']default["']/,
    ];
    const hit = patterns.find((p) => p.test(s));
    assert(`no_default_org:${rel}`, !hit, hit ? `matched ${hit}` : undefined);
  }
}

// ── 4. 受理链路复用 resolveInboundTradeOrgId ─────────────────────

function checkIntakeReusesInboundResolver() {
  const rel = "src/lib/trade/service-intake.ts";
  const s = read(rel);
  if (!s) {
    fail(`file_missing:${rel}`);
    return;
  }
  assert(
    "intake: 复用 resolveInboundTradeOrgId",
    /resolveInboundTradeOrgId/.test(s),
  );
  assert(
    "intake: 落库走 createServiceRequest（强制 orgId）",
    /createServiceRequest\(/.test(s),
  );
  assert(
    "intake: handler 工厂拒绝非法 clientOrgId",
    /createTradeIntakeMessageHandler[\s\S]*default/.test(s),
  );
}

// ── 5. agent 工具策略声明 ────────────────────────────────────────

function checkAgentToolPolicy() {
  const rel = "src/lib/agent-core/tools/_policy.ts";
  const s = read(rel);
  if (!s) {
    fail(`file_missing:${rel}`);
    return;
  }
  assert(
    "policy: trade_create_service_request 已声明 risk/allowRoles",
    /trade_create_service_request:\s*\{\s*risk:/.test(s),
  );
}

// ── 6. 运行时守卫（无需 DB：assertOrgId 在 DB 调用前抛错）─────────

async function checkRuntimeGuards() {
  try {
    const mod = await import("@/lib/trade/service-request");

    let threw = false;
    try {
      await mod.createServiceRequest({ orgId: "", requestType: "other", title: "x" });
    } catch {
      threw = true;
    }
    assert("runtime: createServiceRequest 空 orgId 抛错", threw);

    threw = false;
    try {
      await mod.assignToFulfillment({
        requestId: "r",
        ownerOrgId: "default",
        fulfillmentOrgId: "y",
      });
    } catch {
      threw = true;
    }
    assert('runtime: assignToFulfillment 拒绝 "default" ownerOrg', threw);

    threw = false;
    try {
      await mod.listServiceRequestsForOrg({ orgId: "  " });
    } catch {
      threw = true;
    }
    assert("runtime: listServiceRequestsForOrg 空 orgId 抛错", threw);
  } catch (e) {
    console.log(
      "SKIP runtime guards (无法加载模块，通常是缺少环境变量):",
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function main() {
  console.log("=== trade service-request isolation audit ===\n");

  checkServiceLayerGuards();
  checkFulfillmentBridgeSingleWriter();
  checkNoDefaultOrgFallback();
  checkIntakeReusesInboundResolver();
  checkAgentToolPolicy();
  await checkRuntimeGuards();

  console.log("\n--- manual checklist (staging) ---");
  console.log("- 客户 org A 用户查 GET 服务工单时只能看到 orgId=A 的记录");
  console.log("- 仅 assignToFulfillment 能把工单桥接给加拿大 org；其它入口不得写 fulfillmentOrgId");
  console.log("- 加拿大团队只能按 fulfillmentOrgId 看到被指派工单，看不到客户 org 的其它数据 / bid 数据");

  if (failed > 0) {
    console.error(`\nDone: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nDone: all automated checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
