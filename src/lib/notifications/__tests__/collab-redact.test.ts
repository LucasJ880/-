/**
 * 协作通知 COLLAB-2：脱敏（design D10，spec notifications/activity-events「敏感内容的判定」）
 * 金额、电话、地址、内部财务词任一命中 → 整段换成「（含敏感信息，请在青砚查看）」
 * 运行：npx tsx src/lib/notifications/__tests__/collab-redact.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REDACTED_TEXT, isSensitiveText, redactText } from "../collab/redact";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const HITS: Record<string, string[]> = {
  金额: [
    "$1,200",
    "¥800",
    "CAD 500",
    "300 美元",
    "5万元",
    "尾款 3000",
    "￥1200",
    "C$350",
    "500 CAD",
    "总价：8000",
    "定金 500",
    "加 200 加元",
    "100元",
    "5块",
    "单价 12.5",
  ],
  电话: [
    "416-555-0199",
    "(416) 555 0199",
    "13812345678",
    "+86 138 1234 5678",
    "647.555.0123",
    "4165550199",
    "+1 416 555 0199",
    "客户电话 416 555 0199，下午联系",
  ],
  地址: [
    "12 King St W",
    "M5V 2T6",
    "中山路 88 号",
    "3 栋 2 单元 501 室",
    "88 Yonge Street",
    "m5v2t6",
    "人民大道 100 号",
    "5 号楼",
    "送到 1 Main Ave 门口",
  ],
  内部财务: [
    "毛利 35%",
    "项目估值待定",
    "我方最终报价",
    "最终报价已发",
    "中标价出来了",
    "成交价",
    "标的额",
    "利润率太低",
    "gross margin",
    "profit",
    "内部成本",
  ],
};

const MISSES = [
  "明天 10 点复尺",
  "共 12 扇窗",
  "工艺单 BO-2026-0012",
  "11-05 前完成",
  "请确认窗帘颜色",
  "思路 1：先量尺",
  "第 2 次复尺",
  "2026-11-05",
  "下午 3:30 安装",
  "3 Way 会议",
  "BO-2026-000123 已排期",
  "",
];

console.log("命中");
for (const [kind, samples] of Object.entries(HITS)) {
  for (const s of samples) ok(isSensitiveText(s), `${kind}：${s}`);
}

console.log("不误伤");
for (const s of MISSES) ok(!isSensitiveText(s), `不命中：${JSON.stringify(s)}`);

console.log("整段替换");
ok(REDACTED_TEXT === "（含敏感信息，请在青砚查看）", "替换文案");
ok(redactText("跟进 $12,000 的订单") === REDACTED_TEXT, "含金额 → 整段替换，不做局部遮盖");
ok(redactText("回电 416-555-0199") === REDACTED_TEXT, "含电话 → 整段替换");
ok(redactText("共 12 扇窗") === "共 12 扇窗", "不命中 → 原样保留");
ok(redactText(null) === "" && redactText(undefined) === "", "空值 → 空串");

console.log("内部财务词只导入、不另写");
const src = readFileSync(join(process.cwd(), "src/lib/notifications/collab/redact.ts"), "utf8");
ok(/import \{[^}]*containsOutboundSensitive[^}]*\} from "@\/lib\/muse-bridge\/contract"/.test(src), "导入 containsOutboundSensitive");
ok(/containsOutboundSensitive\([^)]*\{\s*strict:\s*true\s*\}\)/.test(src), "按 strict 模式调用");
ok(/import \{[^}]*COCKPIT_SENSITIVE_PATTERNS[^}]*\} from "@\/lib\/cockpit\/waiting"/.test(src), "导入 COCKPIT_SENSITIVE_PATTERNS");

console.log(`\ncollab-redact: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
