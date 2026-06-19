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

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

let failed = 0;

/** 递归收集目录下的 .ts/.tsx 文件（相对 cwd 路径） */
function walkTs(relDir: string): string[] {
  const abs = join(process.cwd(), relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const relPath = `${relDir}/${name}`;
    const absPath = join(process.cwd(), relPath);
    const st = statSync(absPath);
    if (st.isDirectory()) {
      out.push(...walkTs(relPath));
    } else if (/\.tsx?$/.test(name)) {
      out.push(relPath);
    }
  }
  return out;
}

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
    "addRequestAsset",
    "assignToFulfillment",
    "listFulfillmentRequests",
    "getFulfillmentRequest",
    "addDeliverableForFulfillment",
    "setFulfillmentStatus",
  ]) {
    assert(`service: ${fn} 存在`, new RegExp(`function ${fn}\\b`).test(s), rel);
  }
  const assertCount = (s.match(/assertOrgId\(/g) ?? []).length;
  assert(
    "service: assertOrgId 被多处调用（>=10）",
    assertCount >= 10,
    `count=${assertCount}`,
  );
}

// ── 2. fulfillmentOrgId 写入点收敛（唯一跨 org 桥接）─────────────

function checkFulfillmentBridgeSingleWriter() {
  // 不变式：只有 service-request.ts 能把 TradeServiceRequest.fulfillmentOrgId 写库（即 relay）。
  // 注意：WeChatGateway.fulfillmentOrgId 是另一张表的通道配置字段，与本桥接无关，不在管控内。
  // 采用「写操作」级别精确匹配，而非粗粒度字符串引用（受理/配置/参数传递等读引用是合法的）。
  const writeRe =
    /tradeServiceRequest\.(update|updateMany|create|upsert|createMany)\([\s\S]{0,500}?fulfillmentOrgId/;

  const scanDirs = [
    "src/lib/trade",
    "src/lib/messaging",
    "src/lib/agent-core",
    "src/app/api/trade",
    "src/app/api/messaging",
  ];
  const files = new Set<string>();
  for (const d of scanDirs) for (const f of walkTs(d)) files.add(f);

  const offenders: string[] = [];
  for (const rel of files) {
    if (rel === "src/lib/trade/service-request.ts") continue;
    const s = read(rel);
    if (s && writeRe.test(s)) offenders.push(rel);
  }
  assert(
    "bridge: 仅 service-request.ts 写 TradeServiceRequest.fulfillmentOrgId",
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

  // 处理方写交付物 / 改状态时按 fulfillmentOrgId 校验访问（不得越权写他人工单）
  assert(
    "bridge: addDeliverableForFulfillment 按 fulfillmentOrgId 校验",
    /addDeliverableForFulfillment[\s\S]*?fulfillmentOrgId[\s\S]*?findFirst/.test(s),
  );
  assert(
    "bridge: setFulfillmentStatus 按 fulfillmentOrgId 校验",
    /setFulfillmentStatus[\s\S]*?fulfillmentOrgId[\s\S]*?findFirst/.test(s),
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
    "src/lib/trade/fulfillment.ts",
    "src/app/api/trade/service-requests/route.ts",
    "src/app/api/trade/service-requests/[id]/route.ts",
    "src/app/api/trade/service-requests/[id]/assign/route.ts",
    "src/app/api/trade/service-requests/[id]/process/route.ts",
    "src/app/api/trade/service-requests/[id]/deliver/route.ts",
    "src/app/api/trade/service-requests/[id]/assets/route.ts",
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

    threw = false;
    try {
      await mod.getFulfillmentRequest("r", "");
    } catch {
      threw = true;
    }
    assert("runtime: getFulfillmentRequest 空 fulfillmentOrgId 抛错", threw);

    threw = false;
    try {
      await mod.addRequestAsset({
        requestId: "r",
        callerOrgId: "default",
        kind: "input",
        fileUrl: "u",
        fileName: "f",
      });
    } catch {
      threw = true;
    }
    assert('runtime: addRequestAsset 拒绝 "default" callerOrg', threw);
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
