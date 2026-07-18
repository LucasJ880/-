import {
  getActivepiecesReadiness,
  signActivepiecesPayload,
  verifyActivepiecesSignature,
} from "../activepieces";
import {
  scheduledMarketingFlows,
  scheduledMarketingRequestId,
} from "../automation-schedule";

let total = 0;
let failed = 0;
function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) console.log(`  ✅ ${message}`);
  else { failed += 1; console.error(`  ❌ ${message}`); }
}

const previousSecret = process.env.ACTIVEPIECES_WEBHOOK_SECRET;
const previousSyncUrl = process.env.ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL;
process.env.ACTIVEPIECES_WEBHOOK_SECRET = "test-secret-with-enough-entropy";
process.env.ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL = "https://automation.example.test/hooks/sync";

const rawBody = JSON.stringify({ eventId: "evt-1", orgId: "org-1" });
const signed = signActivepiecesPayload(rawBody, "1721304000000");
expect(
  verifyActivepiecesSignature({
    rawBody,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1721304000000,
  }).ok,
  "正确 HMAC 签名可通过",
);
expect(
  !verifyActivepiecesSignature({
    rawBody: `${rawBody}x`,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1721304000000,
  }).ok,
  "正文被篡改后拒绝回调",
);
expect(
  !verifyActivepiecesSignature({
    rawBody,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1721304000000 + 6 * 60 * 1000,
  }).ok,
  "超过五分钟的签名拒绝重放",
);
const readiness = getActivepiecesReadiness();
expect(readiness.configured, "密钥和至少一个流程地址存在时标记已配置");
expect(readiness.flows.find((flow) => flow.key === "sync-metrics")?.configured === true, "渠道同步流程状态正确");

const monday7amToronto = new Date("2026-07-20T11:00:00.000Z");
expect(
  scheduledMarketingFlows(monday7amToronto).join(",") === "sync-metrics,health-scan",
  "多伦多 07:00 会启动渠道同步和健康检查",
);
const monday9amToronto = new Date("2026-07-20T13:00:00.000Z");
expect(
  scheduledMarketingFlows(monday9amToronto).join(",") === "experiment-review",
  "周一 09:00 会启动实验复盘",
);
expect(
  scheduledMarketingRequestId({
    orgId: "org-1",
    flowKey: "daily-brief",
    now: new Date("2026-07-20T12:15:00.000Z"),
  }) === "schedule:daily-brief:org-1:2026-07-20:08",
  "定时请求使用组织、流程和当地小时生成幂等键",
);

if (previousSecret === undefined) delete process.env.ACTIVEPIECES_WEBHOOK_SECRET;
else process.env.ACTIVEPIECES_WEBHOOK_SECRET = previousSecret;
if (previousSyncUrl === undefined) delete process.env.ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL;
else process.env.ACTIVEPIECES_MARKETING_SYNC_WEBHOOK_URL = previousSyncUrl;

console.log(`\n${failed === 0 ? "✅" : "❌"} Activepieces: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
