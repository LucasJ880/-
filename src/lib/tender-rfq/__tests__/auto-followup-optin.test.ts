/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」— 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts
 */
import assert from "node:assert/strict";
import { AUTO_DRAFT_OPTIN_KEY, readAutoDraftFollowUpOptIn, withAutoDraftFollowUpOptIn } from "../auto-followup-optin";
import { applyTenderRfqSettingsUpdate } from "../landed-cost";
import { readTenderRfqSettings } from "../round-pure";
import { learnSupplier, readUserPrefs, withUserPrefs } from "@/lib/muse-bridge/prefs-pure";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const NOW = new Date("2026-11-12T09:00:00Z");

console.log("读");
ok("默认关：没有设置、空对象、null、不是对象，都算没开", [undefined, null, {}, "x", 3, [], { tenderRfq: null }, { tenderRfq: { [AUTO_DRAFT_OPTIN_KEY]: null } }].every((s) => !readAutoDraftFollowUpOptIn(s, "u1")));
const on = (userId: string, v: unknown) => ({ tenderRfq: { [AUTO_DRAFT_OPTIN_KEY]: { [userId]: v } } });
ok("开：enabled 是字面量 true 且有时间", readAutoDraftFollowUpOptIn(on("u1", { enabled: true, at: "2026-11-12T09:00:00.000Z" }), "u1"));
ok("严格解析：enabled 是 \"true\" / 1 / 缺时间 / 整个值就是 true，都算没开", [{ enabled: "true", at: "x" }, { enabled: 1, at: "x" }, { enabled: true }, { enabled: true, at: "" }, true, "on", ["enabled"]].every((v) => !readAutoDraftFollowUpOptIn(on("u1", v), "u1")));
ok("只看本人的那一格：别人开了不算我开", !readAutoDraftFollowUpOptIn(on("u2", { enabled: true, at: "x" }), "u1"));
ok("用户号不合规（空、过长）一律算没开；原型上的键不算", !readAutoDraftFollowUpOptIn(on("", { enabled: true, at: "x" }), "") && !readAutoDraftFollowUpOptIn(on("u".repeat(65), { enabled: true, at: "x" }), "u".repeat(65)) && !readAutoDraftFollowUpOptIn({ tenderRfq: { [AUTO_DRAFT_OPTIN_KEY]: {} } }, "constructor") && !readAutoDraftFollowUpOptIn({ tenderRfq: { [AUTO_DRAFT_OPTIN_KEY]: {} } }, "__proto__"));

console.log("写");
const base = {
  timezone: "America/Toronto",
  tenderRfq: { fromName: "Qyan-Sunny Purchasing", fromEmail: "project@example.com", mailboxEmail: "owner@example.com", landedCost: { fxAsOf: "2026-11-01" }, [AUTO_DRAFT_OPTIN_KEY]: { u2: { enabled: true, at: "2026-11-01T00:00:00.000Z" } } },
  museBridge: { userPrefs: { u1: { defaultSupplierIds: ["s1"], defaultIncoterm: "FOB", chaseAfterDays: 3, lastUpdatedAt: null } }, bindings: { x: 1 } },
};
const opened = withAutoDraftFollowUpOptIn(base, "u1", true, NOW);
ok("开启：状态变了，本人的那一格写成 { enabled: true, at }", opened.changed && readAutoDraftFollowUpOptIn(opened.next, "u1") && JSON.stringify((opened.next.tenderRfq as Record<string, Record<string, unknown>>)[AUTO_DRAFT_OPTIN_KEY].u1) === JSON.stringify({ enabled: true, at: NOW.toISOString() }));
ok("开启：别人的开关原样保留", readAutoDraftFollowUpOptIn(opened.next, "u2") && JSON.stringify((opened.next.tenderRfq as Record<string, Record<string, unknown>>)[AUTO_DRAFT_OPTIN_KEY].u2) === JSON.stringify(base.tenderRfq[AUTO_DRAFT_OPTIN_KEY].u2));
ok("开启：询价设置的其它键、Muse 的偏好与绑定、组织的其它设置都原样保留", (() => { const { tenderRfq: t1, ...rest1 } = opened.next as typeof base; const { tenderRfq: t0, ...rest0 } = base; const strip = (t: Record<string, unknown>) => { const { [AUTO_DRAFT_OPTIN_KEY]: _drop, ...r } = t; void _drop; return r; }; return JSON.stringify(rest1) === JSON.stringify(rest0) && JSON.stringify(strip(t1)) === JSON.stringify(strip(t0)); })());
ok("不改传入的对象", !readAutoDraftFollowUpOptIn(base, "u1") && Object.keys(base.tenderRfq[AUTO_DRAFT_OPTIN_KEY]).join() === "u2");
ok("已经开着再开：状态没变，返回原对象（调用方据此不写库、不写审计）", (() => { const again = withAutoDraftFollowUpOptIn(opened.next, "u1", true, new Date("2027-01-01T00:00:00Z")); return !again.changed && again.next === opened.next; })());
const closed = withAutoDraftFollowUpOptIn(opened.next, "u1", false, NOW);
ok("关闭：删掉本人的那一格，别人的还在", closed.changed && !readAutoDraftFollowUpOptIn(closed.next, "u1") && readAutoDraftFollowUpOptIn(closed.next, "u2") && !("u1" in (closed.next.tenderRfq as Record<string, Record<string, unknown>>)[AUTO_DRAFT_OPTIN_KEY]));
ok("本来就没开再关：状态没变", !withAutoDraftFollowUpOptIn(base, "u1", false, NOW).changed);
ok("最后一个人也关了：整格删掉，不留空对象", (() => { const c = withAutoDraftFollowUpOptIn(withAutoDraftFollowUpOptIn({ tenderRfq: { fromName: "F" } }, "u1", true, NOW).next, "u1", false, NOW); return c.changed && !(AUTO_DRAFT_OPTIN_KEY in (c.next.tenderRfq as Record<string, unknown>)) && (c.next.tenderRfq as Record<string, unknown>).fromName === "F"; })());
ok("没有任何设置时也能开", readAutoDraftFollowUpOptIn(withAutoDraftFollowUpOptIn(null, "u1", true, NOW).next, "u1"));
ok("用户号不合规：不写", !withAutoDraftFollowUpOptIn(base, "", true, NOW).changed && !withAutoDraftFollowUpOptIn(base, "u".repeat(65), true, NOW).changed);

console.log("与既有设置互不干扰");
{
  const upd = applyTenderRfqSettingsUpdate(opened.next, { fromName: "New Name" } as never);
  ok("管理员改询价设置（发件抬头）：个人开关不被冲掉", upd.ok && readAutoDraftFollowUpOptIn(upd.next, "u1") && readAutoDraftFollowUpOptIn(upd.next, "u2") && readTenderRfqSettings(upd.next).fromName === "New Name");
  const prefs = withUserPrefs(opened.next, "u1", learnSupplier(readUserPrefs(opened.next, "u1"), "s9", NOW));
  ok("Muse 写个人偏好（学到一家常用供应商）：个人开关不被冲掉，偏好里也没有多出这个键", readAutoDraftFollowUpOptIn(prefs, "u1") && readUserPrefs(prefs, "u1").defaultSupplierIds[0] === "s9" && !JSON.stringify((prefs.museBridge as Record<string, unknown>).userPrefs).includes(AUTO_DRAFT_OPTIN_KEY));
  ok("读询价设置不受这一格影响", readTenderRfqSettings(opened.next).fromEmail === "project@example.com" && readTenderRfqSettings(opened.next).mailboxEmail === "owner@example.com");
}

console.log(`\n✓ auto-followup-optin: ${passed} 项断言全部通过`);
