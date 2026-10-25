/**
 * WhatsApp 来信 → Revenue Spine（PRD F2.2–F2.4）纯函数 / 编排 / 静态契约测试，无 DB：
 *   - 媒体与交互消息映射（类型标签 + 说明文字）；表情回应 / 贴纸不进询盘
 *   - 批次拆分：未知 / 缺失 phone_number_id 只跳过该条目，其余照常处理；资料名按 wa_id 取
 *   - 询盘载荷：电话 "+<wa_id>"、eventId = wamid、无邮箱
 *   - 编排：同一 wamid 再次投递交给收据幂等（replay 计数，不当新事件）；失败 / busy 计数让路由返回 500
 *   - 路由：段配置静态字面量；不再走 processInboundMessage / TradeInquiryAnalysis；deferred FDE；微信按 MsgId 认领
 * 运行：npx tsx src/lib/trade/__tests__/whatsapp-inbound.test.ts
 *
 * 公开仓库：只用虚构企业与 555 测试号段。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractWhatsAppInbound,
  processWhatsAppWebhook,
  toWhatsAppInquiry,
  whatsAppMessageText,
  type WhatsAppWebhookDeps,
} from "../whatsapp-inbound";
import type { IngestResult, NormalizedInquiry } from "../website-inquiry";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const PNID = "100000000000001";
const OTHER_PNID = "100000000000999";
const WA = "16475550142";

function payload(changes: Array<{ phoneNumberId?: string; messages: Array<Record<string, unknown>>; contacts?: Array<Record<string, unknown>> }>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: changes.map((c) => ({
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: c.phoneNumberId ? { phone_number_id: c.phoneNumberId, display_phone_number: "15555550100" } : {},
            contacts: c.contacts ?? [{ profile: { name: "Maple Home Goods" }, wa_id: WA }],
            messages: c.messages,
          },
        })),
      },
    ],
  };
}

const textMsg = (id: string, body: string, from = WA) => ({ id, from, timestamp: "1790000000", type: "text", text: { body } });

function fakeIngestResult(v: NormalizedInquiry, flags: Partial<IngestResult>): IngestResult {
  return {
    prospectId: "pros_1",
    messageId: "msg_1",
    duplicate: false,
    notified: 1,
    replay: false,
    spine: { ok: false, code: "INCOMPLETE", error: "fake" },
    fde: null,
    fdeScheduled: true,
    recovered: false,
    recoveredSteps: [],
    fdeState: null,
    eventId: v.eventId,
    receiptId: `rcpt_${v.eventId}`,
    busy: false,
    conflict: false,
    contentDuplicateOf: null,
    complete: false,
    ...flags,
  };
}

/** 假依赖：按 eventId 记收据（同 wamid 第二次 = replay），可指定某些 wamid 抛错 / busy */
function fakeDeps(opts: { orgs?: Record<string, string>; throwOn?: string[]; busyOn?: string[]; spineFailOn?: string[] } = {}) {
  const seen = new Set<string>();
  const calls: Array<{ orgId: string; inquiry: NormalizedInquiry }> = [];
  const locks: string[] = [];
  const orgs = opts.orgs ?? { [PNID]: "org_example_textiles" };
  const deps: WhatsAppWebhookDeps = {
    resolveOrg: async (pnid) => (orgs[pnid] ? { ok: true, orgId: orgs[pnid] } : { ok: false, reason: "channel_not_found" }),
    ingest: async (orgId, inquiry) => {
      calls.push({ orgId, inquiry });
      if (opts.throwOn?.includes(inquiry.eventId)) throw new Error("db unavailable");
      if (opts.busyOn?.includes(inquiry.eventId)) return fakeIngestResult(inquiry, { busy: true, replay: true });
      if (opts.spineFailOn?.includes(inquiry.eventId)) return fakeIngestResult(inquiry, { spine: { ok: false, code: "SPINE_FAILED", error: "connection reset" } });
      const replay = seen.has(`${orgId}:${inquiry.eventId}`);
      seen.add(`${orgId}:${inquiry.eventId}`);
      return fakeIngestResult(inquiry, { replay });
    },
    withSenderLock: async (orgId, waId, fn) => {
      locks.push(`${orgId}:${waId}`);
      return fn();
    },
  };
  return { deps, calls, locks };
}

async function main() {
  console.log("whatsapp inbound → revenue spine");

  await ok("媒体 / 交互消息映射：类型标签 + 说明文字", () => {
    assert.equal(whatsAppMessageText({ type: "text", text: { body: "  Do you make\n waffle bathrobes? " } }), "Do you make waffle bathrobes?");
    assert.equal(whatsAppMessageText({ type: "image", image: { caption: "Need this in navy, 500 pcs" } }), "[图片] Need this in navy, 500 pcs");
    assert.equal(whatsAppMessageText({ type: "image", image: {} }), "[图片]");
    assert.equal(whatsAppMessageText({ type: "document", document: { filename: "spec-sheet.pdf", caption: "Our spec" } }), "[文件：spec-sheet.pdf] Our spec");
    assert.equal(whatsAppMessageText({ type: "document", document: {} }), "[文件]");
    assert.equal(whatsAppMessageText({ type: "video", video: { caption: "factory tour?" } }), "[视频] factory tour?");
    assert.equal(whatsAppMessageText({ type: "audio", audio: { voice: true } }), "[语音消息]");
    assert.equal(whatsAppMessageText({ type: "audio", audio: {} }), "[音频]");
    assert.equal(whatsAppMessageText({ type: "button", button: { text: "Send catalog", payload: "CATALOG" } }), "[按钮] Send catalog");
    assert.equal(whatsAppMessageText({ type: "button", button: { payload: "CATALOG" } }), "[按钮] CATALOG");
    assert.equal(
      whatsAppMessageText({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "q", title: "Request a quote" } } }),
      "[选项] Request a quote",
    );
    assert.equal(
      whatsAppMessageText({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "b", title: "Bath towels", description: "70x140cm" } } }),
      "[选项] Bath towels — 70x140cm",
    );
    assert.equal(whatsAppMessageText({ type: "location", location: { name: "Example Warehouse", latitude: 43.6, longitude: -79.3 } }), "[位置] Example Warehouse (43.6, -79.3)");
    assert.equal(whatsAppMessageText({ type: "contacts", contacts: [{ name: { formatted_name: "Jane Buyer" }, phones: [{ phone: "+1 647 555 0199" }] }] }), "[名片] Jane Buyer +1 647 555 0199");
    assert.equal(whatsAppMessageText({ type: "order", order: { product_items: [{ quantity: 2 }, { quantity: 1 }] } }), "[订单] 2 个商品");
  });

  await ok("不进询盘：表情回应 / 贴纸 / 系统通知 / 不支持 / 空文字", () => {
    for (const type of ["reaction", "sticker", "system", "unsupported", "unknown"]) assert.equal(whatsAppMessageText({ type }), null, type);
    assert.equal(whatsAppMessageText({ type: "text", text: { body: "   " } }), null);
    assert.equal(whatsAppMessageText({ type: "brand_new_type" }), null);
  });

  await ok("批次拆分：缺 phone_number_id / 缺 id / 缺发信人 / 不进询盘的类型逐条跳过，其余照常；资料名按 wa_id 取", () => {
    const body = payload([
      { phoneNumberId: PNID, messages: [textMsg("wamid.A1", "Hello"), { id: "wamid.R1", from: WA, type: "reaction" }, { id: "wamid.E1", from: "", type: "text", text: { body: "x" } }] },
      { messages: [textMsg("wamid.N1", "no metadata")] },
      {
        phoneNumberId: PNID,
        contacts: [
          { profile: { name: "Example Textiles Buyer" }, wa_id: "447700900123" },
          { profile: { name: "Maple Home Goods" }, wa_id: WA },
        ],
        messages: [{ from: WA, type: "text", text: { body: "no id" } }, { ...textMsg("wamid.B1", "second change"), from: "447700900123" }],
      },
    ]);
    const { items, skipped } = extractWhatsAppInbound(body);
    assert.deepEqual(items.map((i) => [i.wamid, i.waId, i.profileName, i.text]), [
      ["wamid.A1", WA, "Maple Home Goods", "Hello"],
      ["wamid.B1", "447700900123", "Example Textiles Buyer", "second change"],
    ]);
    assert.deepEqual(skipped.map((s) => [s.reason, s.wamid ?? null]), [
      ["ignored_type", "wamid.R1"],
      ["missing_from", "wamid.E1"],
      ["missing_phone_number_id", "wamid.N1"],
      ["missing_id", null],
    ]);
    assert.deepEqual(extractWhatsAppInbound({ entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.S" }] } }] }] }), { items: [], skipped: [] }, "状态回执不是来信");
    assert.deepEqual(extractWhatsAppInbound(null), { items: [], skipped: [] });
    assert.deepEqual(extractWhatsAppInbound({ entry: [{ changes: [{ field: "account_update", value: {} }] }] }), { items: [], skipped: [] });
  });

  await ok("询盘载荷：电话 +<wa_id>（E.164）、资料名、eventId = wamid、无邮箱 / 归因字段", () => {
    const [item] = extractWhatsAppInbound(payload([{ phoneNumberId: PNID, messages: [{ id: "wamid.IMG", from: WA, type: "image", image: { caption: "Quote for 300 pcs?" } }] }])).items;
    const v = toWhatsAppInquiry(item);
    assert.equal(v.phone, "+16475550142");
    assert.equal(v.name, "Maple Home Goods");
    assert.equal(v.email, "");
    assert.equal(v.eventId, "wamid.IMG");
    assert.equal(v.message, "[图片] Quote for 300 pcs?");
    assert.deepEqual(v.utm, { source: "", medium: "", campaign: "", content: "", term: "" });
    assert.equal(v.honeypotTripped, false);
  });

  await ok("未知 phone_number_id：只跳过该条目，已知条目照常处理（不再整批 403）", async () => {
    const { deps, calls } = fakeDeps();
    const out = await processWhatsAppWebhook(
      payload([
        { phoneNumberId: OTHER_PNID, messages: [textMsg("wamid.U1", "to an unknown number")] },
        { phoneNumberId: PNID, messages: [textMsg("wamid.K1", "Need 1,000 bath towels")] },
      ]),
      deps,
    );
    assert.equal(out.processed, 1);
    assert.equal(out.failed, 0);
    assert.deepEqual(out.skipped.map((s) => [s.reason, s.phoneNumberId, s.wamid]), [["unknown_channel", OTHER_PNID, "wamid.U1"]]);
    assert.deepEqual(calls.map((c) => [c.orgId, c.inquiry.eventId]), [["org_example_textiles", "wamid.K1"]]);
  });

  await ok("同一 wamid 再次投递：交给收据幂等（replay），不当新事件；每条都在发信人锁内处理", async () => {
    const { deps, calls, locks } = fakeDeps();
    const body = payload([{ phoneNumberId: PNID, messages: [textMsg("wamid.D1", "Hi"), textMsg("wamid.D2", "Bath towels please")] }]);
    const first = await processWhatsAppWebhook(body, deps);
    const again = await processWhatsAppWebhook(body, deps);
    assert.deepEqual([first.processed, first.replays], [2, 0]);
    assert.deepEqual([again.processed, again.replays], [0, 2]);
    assert.equal(calls.length, 4);
    assert.deepEqual([...new Set(locks)], [`org_example_textiles:${WA}`]);
  });

  await ok("失败与 busy 计数（路由据此返回 500 让 Meta 重投）；一条失败不影响同批其它条目", async () => {
    const { deps, calls } = fakeDeps({ throwOn: ["wamid.F1"], busyOn: ["wamid.B9"], spineFailOn: ["wamid.S1"] });
    const out = await processWhatsAppWebhook(
      payload([
        {
          phoneNumberId: PNID,
          messages: [textMsg("wamid.F1", "boom"), textMsg("wamid.B9", "busy"), textMsg("wamid.S1", "spine down"), textMsg("wamid.OK", "fine"), null as unknown as Record<string, unknown>],
        },
      ]),
      deps,
    );
    assert.deepEqual([out.failed, out.busy, out.processed, out.messages], [2, 1, 1, 4], "抛错 + SPINE_FAILED 都算失败（要重投）");
    assert.equal(calls.length, 4);
    assert.deepEqual(out.skipped.map((s) => s.reason), ["missing_id"], "畸形条目只跳过");
  });

  await ok("org 解析抛错算失败（不是跳过），同批其它组织照常", async () => {
    const { deps } = fakeDeps({ orgs: { [PNID]: "org_example_textiles" } });
    const out = await processWhatsAppWebhook(
      payload([
        { phoneNumberId: "boom", messages: [textMsg("wamid.X1", "x")] },
        { phoneNumberId: PNID, messages: [textMsg("wamid.X2", "y")] },
      ]),
      {
        ...deps,
        resolveOrg: async (pnid) => {
          if (pnid === "boom") throw new Error("db down");
          return deps.resolveOrg(pnid);
        },
      },
    );
    assert.deepEqual([out.failed, out.processed], [1, 1]);
  });

  await ok("WhatsApp 路由：段配置静态字面量；走 processWhatsAppWebhook；不再走 Trade 旧通道 / 不再整批 403", () => {
    const route = src("src/app/api/trade/webhook/whatsapp/route.ts");
    assert.match(route, /^export const runtime = "nodejs";$/m);
    assert.match(route, /^export const maxDuration = 300;$/m);
    assert.doesNotMatch(route, /^export const (?!runtime|maxDuration)\w+/m);
    assert.match(route, /verifyWhatsAppSignature\(rawBody, sig, APP_SECRET\)/);
    assert.match(route, /processWhatsAppWebhook\(body\)/);
    assert.match(route, /outcome\.failed > 0 \|\| outcome\.busy > 0/);
    assert.doesNotMatch(route, /processInboundMessage|resolveInboundTradeOrgId/);
    assert.doesNotMatch(route, /unknown_whatsapp_channel|missing_phone_number_id/);
  });

  await ok("单管线：WhatsApp 走 deferred FDE、不跑 TradeInquiryAnalysis；收据来源常量独立", () => {
    const lib = src("src/lib/trade/whatsapp-inbound.ts");
    assert.match(lib, /origin: \{ kind: "whatsapp" \}, fdeMode: "deferred"/);
    assert.doesNotMatch(lib, /scheduleInquiryAnalysis|analyzeInquiry|processInboundMessage/);
    const ingest = src("src/lib/trade/website-inquiry.ts");
    const whatsappOrigin = ingest.slice(ingest.indexOf("  whatsapp: {"), ingest.indexOf("} as const;"));
    assert.match(whatsappOrigin, /receiptSource: WHATSAPP_INBOUND_SOURCE/);
    assert.match(whatsappOrigin, /intakeSource: "whatsapp"/);
    assert.match(whatsappOrigin, /inquiryAnalysis: false/);
    assert.match(ingest, /if \(o\.inquiryAnalysis\) await scheduleInquiryAnalysis\(\{/);
    const receipts = src("src/lib/trade/website-inquiry-receipts.ts");
    assert.match(receipts, /export const WHATSAPP_INBOUND_SOURCE = "whatsapp";/);
    assert.match(receipts, /export const WECHAT_INBOUND_SOURCE = "wechat";/);
    // 业务指纹仍不含来源页 / UTM / eventId
    assert.match(receipts, /const parts = \[v\.name, v\.email, v\.phone, v\.company, v\.country, v\.product, v\.website, v\.message\];/);
  });

  await ok("微信路由：按 MsgId 认领收据后才写消息；仍只走 Trade 通道", () => {
    const route = src("src/app/api/trade/webhook/wechat/route.ts");
    assert.match(route, /getTag\("MsgId"\) \|\| `\$\{fromUser\}:\$\{createTime\}`/);
    assert.match(route, /claimChannelEventReceipt\(resolved\.orgId, WECHAT_INBOUND_SOURCE, eventId/);
    assert.ok(route.indexOf("claimChannelEventReceipt(") < route.indexOf("processInboundMessage(resolved.orgId"), "认领在写入之前");
    assert.match(route, /releaseReceipt\(claim\.receiptId, "received"\)/);
    assert.doesNotMatch(route, /ingestWebsiteInquiry|intakeInquiry/);
  });

  console.log(`\nwhatsapp inbound → revenue spine: ${pass} 通过`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
