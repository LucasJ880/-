/**
 * VIS-1c 发信文案按企业设置（spec settings/sender-copy；change vis-1c-notify-settings-search）
 * 运行：npx tsx src/lib/settings/__tests__/sender-copy.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLATFORM_RELAY_SUMMARY,
  SENDER_COPY_PLATFORM_RELAY,
  personalGmailNotice,
  platformRelayTitle,
  readSenderCopy,
  withSenderCopy,
} from "../sender-copy";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 去掉注释，避免注释里的字样干扰源码断言 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("sender-copy（发信文案按企业设置）");

console.log("\n读");
ok(readSenderCopy({ ui: { senderCopy: "platform_relay" } }) === SENDER_COPY_PLATFORM_RELAY, "代发企业：ui.senderCopy = platform_relay → 代发");
ok(readSenderCopy({}) === null, "未设置的企业 → 标准邮箱绑定");
ok(readSenderCopy({ ui: { senderCopy: "resend" } }) === null, "其他值 → 标准邮箱绑定");
ok(readSenderCopy(null) === null && readSenderCopy("x") === null && readSenderCopy([1]) === null, "settingsJson 不是对象 → 标准");
ok(readSenderCopy({ ui: "platform_relay" }) === null, "ui 不是对象 → 标准");

console.log("\n写（保留其他设置）");
{
  const before = { onboarding: { version: 2 }, ui: { theme: "x" }, timezone: "Asia/Shanghai" };
  const snapshot = JSON.stringify(before);
  const relay = withSenderCopy(before, "platform_relay");
  ok(
    JSON.stringify(relay) === JSON.stringify({ onboarding: { version: 2 }, ui: { theme: "x", senderCopy: "platform_relay" }, timezone: "Asia/Shanghai" }),
    "platform_relay：保留 onboarding、timezone 与 ui.theme，只新增 ui.senderCopy",
    relay,
  );
  ok(JSON.stringify(before) === snapshot, "不改入参");
  const cleared = withSenderCopy(relay, "clear");
  ok(JSON.stringify(cleared) === snapshot, "clear：只删 ui.senderCopy，其余还原", cleared);
  const onlyKey = withSenderCopy({ ui: { senderCopy: "platform_relay" }, rules: [] }, "clear");
  ok(JSON.stringify(onlyKey) === JSON.stringify({ rules: [] }), "clear：ui 因此为空时删掉 ui", onlyKey);
  ok(JSON.stringify(withSenderCopy(null, "platform_relay")) === JSON.stringify({ ui: { senderCopy: "platform_relay" } }), "空设置也能写");
}

console.log("\n代发文案通用、不含企业专属信息");
{
  ok(platformRelayTitle("梦馨家纺") === "梦馨家纺发信通道", "标题为「〈企业名〉发信通道」");
  ok(platformRelayTitle("  ") === "企业发信通道" && platformRelayTitle(undefined) === "企业发信通道", "企业名缺失时用通用标题");
  const texts = [PLATFORM_RELAY_SUMMARY, personalGmailNotice("a@b.c"), personalGmailNotice(null)];
  const banned = ["Cathy", "QQ", "@mengxinhometextile.com", "Sunny", "梦馨", "Resend"];
  ok(texts.every((t) => banned.every((b) => !t.includes(b))), "代发文案不含人名、邮箱、域名与其他企业名");
  ok(personalGmailNotice("a@b.c").includes("（a@b.c）") && !personalGmailNotice(null).includes("（"), "个人 Gmail 提示带上邮箱（有则显示）");
}

console.log("\n两页与企业列表接线（源码断言）");
{
  for (const p of ["src/app/(main)/settings/page.tsx", "src/app/(main)/settings/email/page.tsx"]) {
    const src = read(p);
    ok(!/MENGXIN_ORG_CODE|mengxin-home-textile/.test(src), `${p}：不再出现 MENGXIN_ORG_CODE 与 mengxin-home-textile`);
    ok(/currentOrg\?\.senderCopy === "platform_relay"/.test(src), `${p}：按当前企业的 senderCopy 判定`);
    ok(!/Cathy|inquiry@mengxinhometextile\.com|梦馨/.test(src), `${p}：页面里没有写死的梦馨人名与邮箱`);
    ok(/platformRelayTitle\(currentOrg\?\.name\)/.test(src) && (src.match(/PLATFORM_RELAY_SUMMARY/g) ?? []).length === 2, `${p}：代发文案取自 sender-copy 模块，说明只出现一次（另一处是 import）`);
  }
  const settings = code("src/app/(main)/settings/page.tsx");
  ok(/\{!isPlatformRelay && \(\s*<div className="border-t/.test(settings), "/settings：代发时不显示 Gmail OAuth 配置说明");
  const email = code("src/app/(main)/settings/email/page.tsx");
  ok((email.match(/\{!isPlatformRelay && /g) ?? []).length === 3, "/settings/email：代发时不显示当前通道提示、Google 一键授权与 SMTP 配置（3 处）");

  const api = code("src/app/api/organizations/route.ts");
  const hits = api.match(/senderCopy: readSenderCopy\((o|m\.org)\.settingsJson\)/g) ?? [];
  ok(hits.length === 2, "GET /api/organizations 两条分支都带 senderCopy", hits);
  ok(!/settingsJson: (o|m\.org)\.settingsJson/.test(api) && !/\.\.\.(o|m\.org),/.test(api), "企业列表不透出 settingsJson 本身（也不整对象展开）");
  const hook = read("src/lib/hooks/use-organizations.ts");
  ok(/senderCopy\?: "platform_relay" \| null;/.test(hook), "OrgSummary 带 senderCopy 字段");
}

console.log("\n回填脚本（源码断言）");
{
  const s = code("scripts/set-org-sender-copy.ts");
  const allowAt = s.indexOf('process.env.ALLOW_SENDER_COPY_UPDATE !== "true"');
  const dbAt = s.indexOf('await import("@/lib/db")');
  const actorAt = s.indexOf('actor.role !== "super_admin"');
  const orgReadAt = s.indexOf("db.organization.findUnique");
  ok(allowAt > 0 && dbAt > allowAt, "没有显式开关时先退出，不连库（含 --dry-run）");
  ok(actorAt > 0 && orgReadAt > actorAt, "执行者不是 super_admin 时先退出，不读企业设置");
  ok(/if \(dryRun\) return 0;/.test(s) && s.indexOf("if (dryRun) return 0;") < s.indexOf("organization.update"), "--dry-run 只打印、不写库");
  ok(/withSenderCopy\(org\.settingsJson, mode\)/.test(s), "只经 withSenderCopy 改 ui.senderCopy，保留其他键");
  const txAt = s.indexOf("db.$transaction(");
  ok(txAt > 0 && s.indexOf("tx.organization.findUnique", txAt) > txAt && s.indexOf("tx.organization.findUnique", txAt) < s.indexOf("tx.organization.update", txAt), "在事务里重读 settingsJson 再写（不覆盖期间别处改的其他键）");
  ok(/writeAuditLog\(tx, \{/.test(s) && /organization\.settings\.sender_copy/.test(s), "写库时在同一事务里记审计");
  ok(/return 1;/.test(s) && /return 2;/.test(s), "拒绝退出码 1，输入错误退出码 2");
  const seed = read("scripts/seed-org-mengxin-home-textile.ts");
  ok(/withSenderCopy\(\{ \.\.\.settings, timezone: ORG\.timezone \}, SENDER_COPY_PLATFORM_RELAY\)/.test(seed), "梦馨种子同步写入 platform_relay，重跑不回退");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
