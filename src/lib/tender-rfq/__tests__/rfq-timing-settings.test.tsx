/**
 * W-2b 询价节奏三项（回复提前量 / 轮次锁天数 / 催单天数）——接口校验与合并、读法、表单、呈现与接线
 * 运行：npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TenderRfqSettingsFields } from "@/components/organizations/tender-rfq-settings-section";
import { RFQ_TIMING_KEYS, applyTenderRfqSettingsUpdate, tenderRfqSettingsPutSchema } from "../landed-cost";
import { readRfqTimingView, RFQ_TIMING_DEFAULTS } from "../rfq-timing-view";
import { readTenderRfqSettings } from "../round-pure";
import { resolveChaseAfterDays } from "../chase-pure";
import { computeReplyBy } from "../build";
import { RFQ_TIMING_FIELDS, bodyFromForm, formFromView, timingPlaceholder, type TenderRfqSettingsForm, type TenderRfqSettingsView } from "../settings-form";
import { initialSectionState, prepareSave, sectionReducer, type SectionState } from "../settings-section-state";
import { preferencesAdvisory } from "@/lib/muse-bridge/router-pure";
import { renderAdvisory } from "@/lib/muse-bridge/advisory";
import { EMPTY_PREFS } from "@/lib/muse-bridge/prefs-pure";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const LC = { fxRates: {}, fxAsOf: null, fxSource: null, freightEstimate: null, exportInlandEstimate: null, insurancePct: null, clearanceFlatCad: null, projects: {} } as unknown as TenderRfqSettingsView["landedCost"];
const VIEW: TenderRfqSettingsView = {
  fromName: "Fixture Procurement",
  fromEmail: "project@fixture.test",
  mailboxEmail: "project@fixture.test",
  stored: { fromName: true, fromEmail: true, mailboxEmail: true, replyLeadDays: true, roundLockDays: false, chaseAfterDays: false },
  timing: { replyLeadDays: 10, roundLockDays: 3, chaseAfterDays: 3 },
  timingDefaults: { replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 },
  landedCost: LC,
};
const base = () => formFromView(VIEW);
const run = (mut: (f: TenderRfqSettingsForm) => TenderRfqSettingsForm) => bodyFromForm(mut(base()), base());
const setT = (k: (typeof RFQ_TIMING_KEYS)[number], v: string) => (f: TenderRfqSettingsForm) => ({ ...f, timing: { ...f.timing, [k]: v } });

console.log("接口：校验");
{
  const valid = (b: unknown) => tenderRfqSettingsPutSchema.safeParse(b).success;
  for (const k of RFQ_TIMING_KEYS) {
    ok(`${k}：1、60、null 合法`, valid({ [k]: 1 }) && valid({ [k]: 60 }) && valid({ [k]: null }));
    ok(`${k}：0、61、2.5、"5"、-1 不合法`, !valid({ [k]: 0 }) && !valid({ [k]: 61 }) && !valid({ [k]: 2.5 }) && !valid({ [k]: "5" }) && !valid({ [k]: -1 }));
  }
  ok("别的未知键仍然 400（strict）", !valid({ replyLeadDay: 5 }));
}

console.log("接口：合并");
{
  const cur = { tenderRfq: { fromName: "A", replyLeadDays: 9, landedCost: { insurancePct: 1 } }, museBridge: { keep: 1 } };
  const r = applyTenderRfqSettingsUpdate(cur, { roundLockDays: 5 });
  ok("传了的写进去，没传的保留，其它键不动", r.ok && JSON.stringify(r.tenderRfq) === JSON.stringify({ fromName: "A", replyLeadDays: 9, landedCost: { insurancePct: 1 }, roundLockDays: 5 }) && JSON.stringify((r.next as { museBridge: unknown }).museBridge) === JSON.stringify({ keep: 1 }), r);
  const c = applyTenderRfqSettingsUpdate(cur, { replyLeadDays: null, chaseAfterDays: 12 });
  ok("null 清空、数字覆盖", c.ok && c.tenderRfq.replyLeadDays === null && c.tenderRfq.chaseAfterDays === 12, c);
  ok("清空后读取回到默认 7", c.ok && readTenderRfqSettings(c.next).replyLeadDays === 7);
  ok("写进去的值读取都认", c.ok && resolveChaseAfterDays(null, c.next) === 12 && readTenderRfqSettings(applyTenderRfqSettingsUpdate({}, { replyLeadDays: 60, roundLockDays: 1 }).ok ? (applyTenderRfqSettingsUpdate({}, { replyLeadDays: 60, roundLockDays: 1 }) as { next: unknown }).next : null).roundLockDays === 1);
  const none = applyTenderRfqSettingsUpdate(cur, {});
  ok("空请求不改这三项", none.ok && none.tenderRfq.replyLeadDays === 9 && !("roundLockDays" in none.tenderRfq) && !("chaseAfterDays" in none.tenderRfq));
}

console.log("读法");
{
  const v0 = readRfqTimingView({});
  ok("什么都没存：生效值 = 默认 7 / 3 / 3，都没存", JSON.stringify(v0.timing) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }) && JSON.stringify(v0.timingDefaults) === JSON.stringify(RFQ_TIMING_DEFAULTS) && Object.values(v0.stored).every((x) => x === false), v0);
  const v1 = readRfqTimingView({ tenderRfq: { replyLeadDays: 10, roundLockDays: 5, chaseAfterDays: 4 } });
  ok("都存了：生效值是存的值，都算存了", JSON.stringify(v1.timing) === JSON.stringify({ replyLeadDays: 10, roundLockDays: 5, chaseAfterDays: 4 }) && Object.values(v1.stored).every((x) => x === true), v1);
  ok("都存了：默认值仍是 7 / 3 / 3（不跟着存的值变）", JSON.stringify(v1.timingDefaults) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }), v1.timingDefaults);
  const v2 = readRfqTimingView({ tenderRfq: { replyLeadDays: "10", roundLockDays: "5", chaseAfterDays: "4" } });
  ok("坏值（字符串）：读取不认就是默认，算没存", JSON.stringify(v2.timing) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }) && Object.values(v2.stored).every((x) => x === false), v2);
  const v2n = readRfqTimingView({ tenderRfq: { replyLeadDays: -1, roundLockDays: -2, chaseAfterDays: 2.5 } });
  ok("坏值（数字但读取不认：负数、催单小数）：默认，算没存", JSON.stringify(v2n.timing) === JSON.stringify({ replyLeadDays: 7, roundLockDays: 3, chaseAfterDays: 3 }) && Object.values(v2n.stored).every((x) => x === false), v2n);
  const v2c = readRfqTimingView({ tenderRfq: { chaseAfterDays: 99 } });
  ok("催单天数超过 60：默认，算没存", v2c.timing.chaseAfterDays === 3 && v2c.stored.chaseAfterDays === false);
  const v3 = readRfqTimingView({ tenderRfq: { chaseAfterDays: 4 }, museBridge: { userPrefs: { u1: { chaseAfterDays: 9 } } } });
  ok("催单天数只看组织层：个人偏好不影响这里", v3.timing.chaseAfterDays === 4);
  ok("存的值正好等于默认：也算存了", readRfqTimingView({ tenderRfq: { roundLockDays: 3 } }).stored.roundLockDays === true);
  ok("生效值与系统读取同一来源", readRfqTimingView({ tenderRfq: { replyLeadDays: 0 } }).timing.replyLeadDays === readTenderRfqSettings({ tenderRfq: { replyLeadDays: 0 } }).replyLeadDays);
  const now = new Date("2026-11-01T00:00:00Z");
  ok("回复提前量 10 天：截标 11-30 → 回复截止 11-20", computeReplyBy("2026-11-30T00:00:00Z", now, readTenderRfqSettings({ tenderRfq: { replyLeadDays: 10 } }).replyLeadDays)?.startsWith("2026-11-20") === true);
}

console.log("表单");
{
  const f = base();
  ok("存了的显示存的值，没存的为空", f.timing.replyLeadDays === "10" && f.timing.roundLockDays === "" && f.timing.chaseAfterDays === "", f.timing);
  ok("生效值另记（用于占位文字）", f.timingEffective.roundLockDays === 3 && f.timingEffective.replyLeadDays === 10);
  const old = formFromView({ ...VIEW, stored: { fromName: true, fromEmail: true, mailboxEmail: true }, timing: undefined, timingDefaults: undefined });
  ok("旧接口没有这三项：都为空，生效值未知", Object.values(old.timing).every((x) => x === "") && Object.values(old.timingEffective).every((x) => x === null));
  ok("没改：空请求", (() => { const r = bodyFromForm(base(), base()); return r.ok && r.empty; })());
  const r1 = run(setT("chaseAfterDays", "5"));
  ok("只改催单天数：请求里只有 chaseAfterDays: 5", r1.ok && JSON.stringify(r1.body) === JSON.stringify({ chaseAfterDays: 5 }), r1);
  ok("请求能过接口校验", r1.ok && tenderRfqSettingsPutSchema.safeParse(r1.body).success);
  const r2 = run(setT("replyLeadDays", ""));
  ok("清空回复提前量：发 null", r2.ok && JSON.stringify(r2.body) === JSON.stringify({ replyLeadDays: null }), r2);
  const r3 = run(setT("replyLeadDays", " 10 "));
  ok("前后空格、与原值相同：不发", r3.ok && r3.empty);
  const r4 = run(setT("roundLockDays", "3"));
  ok("没存的填成和默认一样：照样发（变成组织自己存的）", r4.ok && JSON.stringify(r4.body) === JSON.stringify({ roundLockDays: 3 }), r4);
  for (const bad of ["0", "61", "2.5", "abc", "-3", "1e1", "0x0A", "+5"]) {
    const r = run(setT("roundLockDays", bad));
    ok(`轮次锁填「${bad}」：写明哪一项、要 1–60 的整数，不发`, !r.ok && r.errors.length === 1 && r.errors[0] === "轮次锁天数：请填 1–60 的整数（或留空用默认）", r);
  }
  const r5 = run((x) => setT("chaseAfterDays", "x")(setT("replyLeadDays", "0")(x)));
  ok("两项都错：各写一条", !r5.ok && r5.errors.length === 2 && r5.errors.some((e) => e.startsWith("回复提前量")) && r5.errors.some((e) => e.startsWith("催单天数")), r5);
  // 库里已有读取认得、但不在 1–60 的旧值：不改就不发，也不挡别的项保存（先比较后校验）
  const legacyView: TenderRfqSettingsView = { ...VIEW, stored: { ...VIEW.stored!, roundLockDays: true, replyLeadDays: true }, timing: { replyLeadDays: 2.5, roundLockDays: 0, chaseAfterDays: 3 } };
  const lf = formFromView(legacyView);
  ok("旧值照样显示", lf.timing.roundLockDays === "0" && lf.timing.replyLeadDays === "2.5");
  const lr = bodyFromForm({ ...lf, insurancePct: "1.5" }, lf);
  ok("库里有旧值 0 / 2.5，只改保险费率：请求里只有保险费率", lr.ok && JSON.stringify(lr.body) === JSON.stringify({ landedCost: { insurancePct: 1.5 } }), lr);
  const lr2 = bodyFromForm({ ...lf, timing: { ...lf.timing, roundLockDays: "" } }, lf);
  ok("把旧值清空：发 null（回到默认）", lr2.ok && JSON.stringify(lr2.body) === JSON.stringify({ roundLockDays: null }), lr2);
  const r6 = run((x) => ({ ...setT("roundLockDays", "5")(x), insurancePct: "1.5" }));
  ok("和落地价参数一起改：各自只发改过的", r6.ok && JSON.stringify(r6.body) === JSON.stringify({ roundLockDays: 5, landedCost: { insurancePct: 1.5 } }), r6);
}

console.log("页面状态");
{
  const ready = sectionReducer(initialSectionState(), { type: "loaded", view: VIEW });
  const ed = sectionReducer(ready, { type: "timing", key: "chaseAfterDays", value: "6" });
  ok("改一项：表单变了，打开时的值没变", ed.form!.timing.chaseAfterDays === "6" && ed.initial!.timing.chaseAfterDays === "");
  const p = prepareSave(ed);
  ok("保存：发 chaseAfterDays: 6", p.kind === "send" && JSON.stringify(p.body) === JSON.stringify({ chaseAfterDays: 6 }), p);
  ok("撤销：回到打开时的值", sectionReducer(ed, { type: "reset" }).form!.timing.chaseAfterDays === "");
  const busy = sectionReducer(ed, { type: "saveStarted" });
  ok("保存中不能改", sectionReducer(busy, { type: "timing", key: "chaseAfterDays", value: "9" }).form!.timing.chaseAfterDays === "6");
  const after = sectionReducer(busy, { type: "saveSucceeded", view: { ...VIEW, stored: { ...VIEW.stored!, chaseAfterDays: true }, timing: { ...VIEW.timing!, chaseAfterDays: 6 } } });
  ok("保存成功：用返回的设置更新，再存是没有改动", after.form!.timing.chaseAfterDays === "6" && prepareSave(after).kind === "empty");
  const bad = prepareSave(sectionReducer(ready, { type: "timing", key: "replyLeadDays", value: "0" }));
  ok("填错：不发，列出错误", bad.kind === "errors" && bad.errors[0].startsWith("回复提前量"));
}

console.log("呈现");
{
  const st = (o: Partial<SectionState> = {}): SectionState => ({ ...sectionReducer(initialSectionState(), { type: "loaded", view: VIEW }), ...o });
  const h = renderToStaticMarkup(<TenderRfqSettingsFields state={st()} dispatch={() => undefined} onSave={() => undefined} />);
  ok("有「询价节奏」小标题与三项", h.includes("询价节奏（天）") && RFQ_TIMING_FIELDS.every((f) => h.includes(`data-testid="tender-rfq-timing-${f.key}"`) && h.includes(f.label)));
  ok("三项各有说明", RFQ_TIMING_FIELDS.every((f) => h.includes(f.note)));
  ok("说明写明生效范围：只影响以后新建的、个人设置优先、仍生效的自动跟进按当时定下的", h.includes("只影响以后新建的询价") && h.includes("项目负责人自己设了催单天数时按个人设置") && h.includes("开了自动跟进且仍在生效的轮次按开的时候定下的天数"));
  ok("催单天数说明写明：第二次催单与标「未响应」也按它，标未响应不用批；催单交项目负责人批", h.includes("第二次催单、标「未响应」也按这个天数") && h.includes("直接标未响应（不起草、不用批）") && h.includes("交项目负责人批") && !h.includes("给你批"));
  ok("轮次锁说明写明：上一轮已发出、没结束，从它建立起算", h.includes("上一轮已发出、还没结束时，从它建立起这么多天内不开新一轮"));
  ok("存了的显示值", /data-testid="tender-rfq-timing-replyLeadDays"[\s\S]*?value="10"/.test(h));
  ok("没存的为空，占位写默认天数", /data-testid="tender-rfq-timing-roundLockDays"[\s\S]*?value=""[^>]*placeholder="未单独设置，默认 3 天"|data-testid="tender-rfq-timing-roundLockDays"[\s\S]*?placeholder="未单独设置，默认 3 天"[^>]*value=""/.test(h), h.match(/data-testid="tender-rfq-timing-roundLockDays"[\s\S]{0,400}/)?.[0]);
  ok("生效值未知时占位不编天数", timingPlaceholder(null) === "未单独设置，用默认值");
  ok("用文本框（不是 number），输入法给数字键盘", !h.includes('type="number"') && (h.match(/inputMode="numeric"/g) ?? []).length === 3);
  const bh = renderToStaticMarkup(<TenderRfqSettingsFields state={st({ busy: true })} dispatch={() => undefined} onSave={() => undefined} />);
  ok("保存中三项禁用", (bh.match(/<input inputMode="numeric" disabled=""/g) ?? []).length === 3, bh.match(/<input inputMode="numeric"[^>]*>/g));
  ok("没有密码、令牌输入", !h.includes('type="password"'));
}

console.log("Muse 查看偏好");
{
  const text = (days?: number) => renderAdvisory(days === undefined ? preferencesAdvisory(EMPTY_PREFS, new Map()) : preferencesAdvisory(EMPTY_PREFS, new Map(), days));
  ok("本人没设、组织 5 天：写「未设（按组织设置：5 天没回）」", text(5).includes("催单：未设（按组织设置：5 天没回）"), text(5));
  ok("不再固定写「默认 3 天」", !text(5).includes("默认 3 天"));
  ok("没传组织天数：按 3 天写", text().includes("催单：未设（按组织设置：3 天没回）"));
  ok("本人设了：照旧写本人的天数", renderAdvisory(preferencesAdvisory({ ...EMPTY_PREFS, chaseAfterDays: 8 }, new Map(), 5)).includes("催单：8 天没回"));
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts");
  ok("GET 用 readRfqTimingView：timing / timingDefaults / stored 三项", route.includes("readRfqTimingView(settingsJson)") && route.includes("timing: t.timing") && route.includes("timingDefaults: t.timingDefaults") && route.includes("...t.stored"));
  ok("PUT 仍是 org_admin、仍走同一个 schema 与合并函数", (route.match(/requireOrgRole\(request, orgId, "org_admin"\)/g) ?? []).length === 2 && route.includes("tenderRfqSettingsPutSchema.safeParse") && route.includes("applyTenderRfqSettingsUpdate(current, body)"));
  const view = read("src/lib/tender-rfq/rfq-timing-view.ts");
  ok("读法直接用系统的读取函数", view.includes("readTenderRfqSettings(settingsJson)") && view.includes("resolveChaseAfterDays(null, settingsJson)"));
  const service = read("src/lib/tender-rfq/service.ts");
  ok("建轮次用的就是这份读取（回复提前量、轮次锁）", service.includes("replyLeadDays: settings.replyLeadDays") && service.includes("roundLockDays: settings.roundLockDays"));
  const comp = read("src/components/organizations/tender-rfq-settings-section.tsx");
  ok("组件按 RFQ_TIMING_FIELDS 逐项画，改动 dispatch timing", comp.includes("RFQ_TIMING_FIELDS.map") && comp.includes('type: "timing", key: f.key'));
  const router = read("src/lib/muse-bridge/router.ts");
  ok("Muse 查看偏好：用 chaseDaysFor(identity, null) 算组织天数并传给 preferencesAdvisory", router.includes("const orgChaseDays = await chaseDaysFor(identity, null);") && router.includes("preferencesAdvisory(prefs, await supplierNamesOf(identity.orgId, prefs.defaultSupplierIds), orgChaseDays)"));
  ok("chaseDaysFor 用 resolveChaseAfterDays（与催单扫描同一套）", /async function chaseDaysFor[\s\S]{0,400}resolveChaseAfterDays\(days, org\?\.settingsJson\)/.test(router));
  const rp = read("src/lib/tender-rfq/round-pure.ts");
  ok("读取规则没改（≥ 0 的有限数字，默认 7 / 3）", rp.includes('replyLeadDays: num("replyLeadDays", TENDER_RFQ_DEFAULTS.replyLeadDays)') && rp.includes("v >= 0 ? v : d"));
}

console.log(`\n${passed} passed`);
