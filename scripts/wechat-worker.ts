/**
 * 个人微信常驻 worker
 *
 * 背景：iLink 用长轮询（getupdates 挂起 35s）收消息，无法在 Vercel serverless 常驻。
 * 本脚本作为一个长期运行的 Node 进程（本地或常驻机器）：
 * - 周期扫描所有 active 的 personal_wechat 网关，按 mode（assistant / trade_intake）接线并启动长轮询。
 * - 新登录的网关自动接管，断开/会话过期的自动停止。
 * - 受理回复用同一 adapter 实例（内存含 context_token）。交付回传由 Vercel 控制台经 DB context_token 完成。
 *
 * 运行：DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... npm run wechat:worker
 *      （或把变量放在 .env / .env.local，本脚本会自动加载）
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ── 轻量 .env 加载（tsx 独立进程，无 Next 注入）─────────────────
function loadEnvFile(rel: string) {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

import { db } from "@/lib/db";
import { PersonalWeChatAdapter } from "@/lib/messaging/adapters/personal-wechat";
import { attachAdapterInbound } from "@/lib/messaging/gateway";

const RESYNC_MS = Number(process.env.WECHAT_WORKER_RESYNC_MS) || 30_000;

interface ActiveEntry {
  adapter: PersonalWeChatAdapter;
  mode: string;
  fulfillmentOrgId: string | null;
}

const active = new Map<string, ActiveEntry>();
let stopping = false;

function log(event: string, meta?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), event, ...meta };
  console.log(JSON.stringify(line));
}

async function startGateway(g: {
  orgId: string;
  mode: string | null;
  fulfillmentOrgId: string | null;
}): Promise<void> {
  const adapter = new PersonalWeChatAdapter(g.orgId);
  // 先接线（设置 onMessage），再 start()（loadCredentials + startPolling），避免漏消息。
  await attachAdapterInbound(adapter, {
    orgId: g.orgId,
    mode: g.mode,
    fulfillmentOrgId: g.fulfillmentOrgId,
  });
  await adapter.start();

  if (adapter.getStatus() === "connected") {
    active.set(g.orgId, {
      adapter,
      mode: g.mode ?? "assistant",
      fulfillmentOrgId: g.fulfillmentOrgId,
    });
    log("gateway.started", {
      orgId: g.orgId,
      mode: g.mode ?? "assistant",
      fulfillmentOrgId: g.fulfillmentOrgId,
    });
  } else {
    log("gateway.start_skipped", { orgId: g.orgId, status: adapter.getStatus() });
  }
}

async function sync(): Promise<void> {
  if (stopping) return;
  let gateways: Array<{
    orgId: string;
    mode: string | null;
    fulfillmentOrgId: string | null;
    botToken: string | null;
  }>;
  try {
    gateways = await db.weChatGateway.findMany({
      where: { channel: "personal_wechat", status: "active" },
      select: { orgId: true, mode: true, fulfillmentOrgId: true, botToken: true },
    });
  } catch (e) {
    log("sync.db_error", { error: e instanceof Error ? e.message : String(e) });
    return;
  }

  const wanted = new Map(gateways.filter((g) => g.botToken).map((g) => [g.orgId, g]));

  // 停止：已不在 wanted，或 mode/fulfillmentOrgId 变了（需重接线）
  for (const [orgId, entry] of [...active.entries()]) {
    const g = wanted.get(orgId);
    const changed =
      !g ||
      (g.mode ?? "assistant") !== entry.mode ||
      (g.fulfillmentOrgId ?? null) !== entry.fulfillmentOrgId;
    if (changed) {
      entry.adapter.stopPolling();
      active.delete(orgId);
      log("gateway.stopped", { orgId, reason: g ? "config_changed" : "no_longer_active" });
    }
  }

  // 启动：在 wanted 但不在 active
  for (const [orgId, g] of wanted) {
    if (active.has(orgId)) continue;
    try {
      await startGateway(g);
    } catch (e) {
      log("gateway.start_error", { orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("worker.shutdown", { signal, active: active.size });
  for (const [orgId, entry] of active) {
    entry.adapter.stopPolling();
    log("gateway.stopped", { orgId, reason: "shutdown" });
  }
  active.clear();
  try {
    await db.$disconnect();
  } catch {
    // ignore
  }
  process.exit(0);
}

/** 启动自检：缺失关键环境变量时明确告警（不直接退出，便于纯文本链路先测） */
function preflight() {
  if (!process.env.DATABASE_URL) {
    log("worker.fatal", { error: "DATABASE_URL 未设置（请放入 .env / .env.local 或导出环境变量）" });
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    log("worker.warn", {
      missing: "BLOB_READ_WRITE_TOKEN",
      impact: "入站图片无法暂存到 Blob，客户发图会收到「图片暂存失败」；纯文字受理不受影响。",
      fix: "从 Vercel 项目 Storage → Blob 复制读写令牌写入 .env.local 后重启 worker。",
    });
  }
  if (!process.env.OPENAI_API_KEY) {
    log("worker.warn", {
      missing: "OPENAI_API_KEY",
      impact: "文本需求的 AI 分类/提取会失败，受理会走兜底回复。",
    });
  }
}

async function main() {
  log("worker.start", { resyncMs: RESYNC_MS });
  preflight();

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await sync();
  log("worker.ready", {
    active: active.size,
    hint: active.size === 0 ? "暂无已登录的个人微信网关，等待扫码登录后自动接管…" : undefined,
  });
  // 周期重扫，接管新登录 / 下线断开
  let lastActive = active.size;
  while (!stopping) {
    await sleep(RESYNC_MS);
    await sync();
    if (active.size !== lastActive) {
      log("worker.active_changed", { active: active.size });
      lastActive = active.size;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  log("worker.fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
