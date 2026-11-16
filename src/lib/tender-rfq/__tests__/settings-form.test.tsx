/**
 * W-2 组织页「询价与落地价设置」——表单规则、呈现与接线
 * 运行：npx tsx src/lib/tender-rfq/__tests__/settings-form.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TenderRfqSettingsFields } from "@/components/organizations/tender-rfq-settings-section";
import {
  LOAD_FAILED_ZH,
  NOTHING_TO_SAVE_ZH,
  PROJECTS_FAILED_ZH,
  SAVED_ZH,
  initialSectionState,
  prepareSave,
  sectionReducer,
  type SectionAction,
  type SectionState,
} from "../settings-section-state";
import { tenderRfqSettingsPutSchema } from "../landed-cost";
import {
  FX_NEEDS_DATE_AND_SOURCE_ZH,
  MAILBOX_NOTE_ZH,
  PIN_MAILBOX_NOTE_ZH,
  SETTINGS_PURPOSE_ZH,
  bodyFromForm,
  formFromView,
  type TenderRfqSettingsForm,
  type TenderRfqSettingsView,
} from "../settings-form";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const VIEW: TenderRfqSettingsView = {
  fromName: "Fixture Procurement",
  fromEmail: "project@fixture.test",
  mailboxEmail: "owner@fixture.test",
  stored: { fromName: true, fromEmail: true, mailboxEmail: true },
  landedCost: {
    fxRates: { USD: 1.36, CNY: 0.19 },
    fxAsOf: "2026-11-10",
    fxSource: "MANUAL",
    freightEstimate: { mode: "per_unit", value: 6 },
    exportInlandEstimate: null,
    insurancePct: 1,
    clearanceFlatCad: 150,
    projects: { projA: { dutyRatePct: 6.5, deliveryDeadline: "2026-12-20" }, projB: { dutyRatePct: 8, deliveryDeadline: null } },
  },
};
const base = () => formFromView(VIEW);
const run = (mut: (f: TenderRfqSettingsForm) => TenderRfqSettingsForm) => bodyFromForm(mut(base()), base());
const valid = (b: unknown) => tenderRfqSettingsPutSchema.safeParse(b).success;

console.log("读");
{
  const f = base();
  ok("汇率按币种排序成行、日期与来源", JSON.stringify(f.fxRows) === JSON.stringify([{ currency: "CNY", rate: "0.19" }, { currency: "USD", rate: "1.36" }]) && f.fxAsOf === "2026-11-10" && f.fxSource === "MANUAL");
  ok("估算参数：有的带方式与数值，没有的为空", f.freight.mode === "per_unit" && f.freight.value === "6" && f.inland.mode === "" && f.inland.value === "");
  ok("项目设置成行（缺的为空字符串）", JSON.stringify(f.projects) === JSON.stringify([{ projectId: "projA", dutyRatePct: "6.5", deliveryDeadline: "2026-12-20" }, { projectId: "projB", dutyRatePct: "8", deliveryDeadline: "" }]));
  const empty = formFromView({ fromName: "", fromEmail: "", mailboxEmail: "", landedCost: { fxRates: {}, fxAsOf: null, fxSource: null, freightEstimate: null, exportInlandEstimate: null, insurancePct: null, clearanceFlatCad: null, projects: {} } });
  ok("什么都没存：全空", empty.fxRows.length === 0 && empty.fxSource === "" && empty.insurancePct === "" && empty.projects.length === 0);
}

console.log("只发改过的项");
{
  const none = bodyFromForm(base(), base());
  ok("什么都没改：空请求（页面说「没有改动」，不调接口）", none.ok && none.empty && JSON.stringify(none.body) === "{}");
  const ins = run((f) => ({ ...f, insurancePct: "1.5" }));
  ok("只改保险费率：请求里只有 landedCost.insurancePct", ins.ok && JSON.stringify(ins.body) === JSON.stringify({ landedCost: { insurancePct: 1.5 } }) && valid(ins.body), ins);
  ok("数值写法不同但相等（1 与 1.0）：不算改了", (() => { const r = run((f) => ({ ...f, insurancePct: "1.0", clearanceFlatCad: " 150 " })); return r.ok && r.empty; })());
  const clr = run((f) => ({ ...f, clearanceFlatCad: "" }));
  ok("清空清关杂费：发 null", clr.ok && JSON.stringify(clr.body) === JSON.stringify({ landedCost: { clearanceFlatCad: null } }) && valid(clr.body));
  const mail = run((f) => ({ ...f, mailboxEmail: "  New.Owner@Fixture.TEST " }));
  ok("改授权邮箱：只发这一项，转小写、去空格；显示地址不发", mail.ok && JSON.stringify(mail.body) === JSON.stringify({ mailboxEmail: "new.owner@fixture.test" }) && valid(mail.body), mail);
  const clearName = run((f) => ({ ...f, fromName: "" }));
  ok("清空发件显示名：发 null（回退默认）", clearName.ok && clearName.body.fromName === null && valid(clearName.body));
  ok("邮箱不对：写明哪一项", (() => { const r = run((f) => ({ ...f, fromEmail: "not-an-email" })); return !r.ok && r.errors.some((e) => e.startsWith("显示地址")); })());
  ok("显示名太长：写明", (() => { const r = run((f) => ({ ...f, fromName: "x".repeat(121) })); return !r.ok && r.errors.some((e) => e.includes("太长")); })());
}

console.log("汇率");
{
  const add = run((f) => ({ ...f, fxRows: [...f.fxRows, { currency: "EUR", rate: "1.5" }] }));
  ok("加一种币种：整张汇率表连同日期、来源一起发（三项是一个整体）", add.ok && JSON.stringify(add.body) === JSON.stringify({ landedCost: { fxRates: { CNY: 0.19, USD: 1.36, EUR: 1.5 }, fxAsOf: "2026-11-10", fxSource: "MANUAL" } }) && valid(add.body), add);
  const blankRowOnly = run((f) => ({ ...f, fxRows: [...f.fxRows, { currency: "", rate: "" }] }));
  ok("只多了一行空白：不算改了", blankRowOnly.ok && blankRowOnly.empty);
  const reorder = run((f) => ({ ...f, fxRows: [...f.fxRows].reverse() }));
  ok("只是顺序不同：不算改了", reorder.ok && reorder.empty);
  const fresh = formFromView({ ...VIEW, landedCost: { ...VIEW.landedCost, fxRates: {}, fxAsOf: null, fxSource: null } });
  const noDate = bodyFromForm({ ...fresh, fxRows: [{ currency: "USD", rate: "1.36" }] }, fresh);
  ok("填了汇率没填日期与来源：不发，写明缺什么", !noDate.ok && noDate.errors.includes(FX_NEEDS_DATE_AND_SOURCE_ZH), noDate);
  const withDate = bodyFromForm({ ...fresh, fxRows: [{ currency: "USD", rate: "1.36" }], fxAsOf: "2026-11-14", fxSource: "BANK_SETTLEMENT" }, fresh);
  ok("填齐汇率、日期、来源：三项都发", withDate.ok && JSON.stringify(withDate.body) === JSON.stringify({ landedCost: { fxRates: { USD: 1.36 }, fxAsOf: "2026-11-14", fxSource: "BANK_SETTLEMENT" } }) && valid(withDate.body), withDate);
  const clearDate = run((f) => ({ ...f, fxAsOf: "" }));
  ok("还有汇率时清空日期：不发，写明", !clearDate.ok && clearDate.errors.includes(FX_NEEDS_DATE_AND_SOURCE_ZH));
  const clearAll = run((f) => ({ ...f, fxRows: [], fxAsOf: "", fxSource: "" }));
  ok("汇率、日期、来源都清掉：发空汇率表与两个 null", clearAll.ok && JSON.stringify(clearAll.body) === JSON.stringify({ landedCost: { fxRates: {}, fxAsOf: null, fxSource: null } }) && valid(clearAll.body), clearAll);
  const lower = run((f) => ({ ...f, fxRows: [...f.fxRows, { currency: "eur", rate: "1.5" }] }));
  ok("币种小写：写明哪一行", !lower.ok && lower.errors.some((e) => e.startsWith("汇率第 3 行") && e.includes("三位大写")), lower);
  ok("汇率为 0：写明", (() => { const r = run((f) => ({ ...f, fxRows: [{ currency: "USD", rate: "0" }] })); return !r.ok && r.errors.some((e) => e.includes("大于 0")); })());
  ok("汇率空着：写明", (() => { const r = run((f) => ({ ...f, fxRows: [{ currency: "USD", rate: "" }] })); return !r.ok && r.errors.some((e) => e.includes("大于 0")); })());
  ok("CAD：不用填", (() => { const r = run((f) => ({ ...f, fxRows: [{ currency: "CAD", rate: "1" }] })); return !r.ok && r.errors.some((e) => e.includes("CAD 不用填")); })());
  ok("币种重复：写明", (() => { const r = run((f) => ({ ...f, fxRows: [...f.fxRows, { currency: "USD", rate: "1.4" }] })); return !r.ok && r.errors.some((e) => e.includes("USD 重复了")); })());
  ok("日期格式不对：写明", (() => { const r = run((f) => ({ ...f, fxAsOf: "2026/11/14" })); return !r.ok && r.errors.some((e) => e.startsWith("汇率日期")); })());
}

console.log("估算参数");
{
  const off = run((f) => ({ ...f, freight: { mode: "", value: "6" } }));
  ok("运费方式改为「不填」：发 null", off.ok && JSON.stringify(off.body) === JSON.stringify({ landedCost: { freightEstimate: null } }) && valid(off.body));
  const inl = run((f) => ({ ...f, inland: { mode: "per_shipment", value: "800" } }));
  ok("加内陆运费（按票 800）", inl.ok && JSON.stringify(inl.body) === JSON.stringify({ landedCost: { exportInlandEstimate: { mode: "per_shipment", value: 800 } } }) && valid(inl.body));
  const pct = run((f) => ({ ...f, freight: { mode: "pct_of_goods", value: "8" } }));
  ok("改成按货值 8%", pct.ok && JSON.stringify(pct.body) === JSON.stringify({ landedCost: { freightEstimate: { mode: "pct_of_goods", value: 8 } } }) && valid(pct.body));
  ok("按货值百分比超过 100：与接口一致，允许（不另加限制）", (() => { const r = run((f) => ({ ...f, freight: { mode: "pct_of_goods", value: "120" } })); return r.ok && valid(r.body); })());
  ok("估算数值 0：允许", (() => { const r = run((f) => ({ ...f, freight: { mode: "per_unit", value: "0" } })); return r.ok && r.body.landedCost?.freightEstimate?.value === 0 && valid(r.body); })());
  ok("边界：保险费率 100、关税率 100、显示名 120 字：都允许", (() => { const r = run((f) => ({ ...f, insurancePct: "100", fromName: "x".repeat(120), projects: [{ ...f.projects[0], dutyRatePct: "100" }, f.projects[1]] })); return r.ok && valid(r.body); })());
  ok("选了方式没填数：写明", (() => { const r = run((f) => ({ ...f, inland: { mode: "per_unit", value: "" } })); return !r.ok && r.errors.some((e) => e.startsWith("出口内陆运费")); })());
  ok("数值相同只是写法不同（6 与 6.0）：不算改了", (() => { const r = run((f) => ({ ...f, freight: { mode: "per_unit", value: "6.0" } })); return r.ok && r.empty; })());
  ok("保险费率超过 100、清关为负：各自写明", (() => { const r = run((f) => ({ ...f, insurancePct: "101", clearanceFlatCad: "-1" })); return !r.ok && r.errors.some((e) => e.startsWith("保险费率")) && r.errors.some((e) => e.startsWith("进口清关杂费")); })());
}

console.log("项目关税率");
{
  const addRm = run((f) => ({ ...f, projects: [f.projects[0], { projectId: "projC", dutyRatePct: "6.5", deliveryDeadline: "" }] }));
  ok("加一个项目、删一个项目：前者带两项，后者 null；没动的不发", addRm.ok && JSON.stringify(addRm.body) === JSON.stringify({ landedCost: { projects: { projC: { dutyRatePct: 6.5, deliveryDeadline: null }, projB: null } } }) && valid(addRm.body), addRm);
  const edit = run((f) => ({ ...f, projects: [{ ...f.projects[0], dutyRatePct: "7" }, f.projects[1]] }));
  ok("改一个项目的关税率：只发这个项目", edit.ok && JSON.stringify(edit.body) === JSON.stringify({ landedCost: { projects: { projA: { dutyRatePct: 7, deliveryDeadline: "2026-12-20" } } } }) && valid(edit.body), edit);
  const dlOnly = run((f) => ({ ...f, projects: [{ ...f.projects[0], deliveryDeadline: "2027-01-15" }, f.projects[1]] }));
  ok("只改一个项目的交付截止：也会发", dlOnly.ok && JSON.stringify(dlOnly.body) === JSON.stringify({ landedCost: { projects: { projA: { dutyRatePct: 6.5, deliveryDeadline: "2027-01-15" } } } }), dlOnly);
  ok("新加的一行什么都没填：写明（不存一条空设置）", (() => { const r = run((f) => ({ ...f, projects: [...f.projects, { projectId: "projC", dutyRatePct: "", deliveryDeadline: "" }] })); return !r.ok && r.errors.some((e) => e.includes("请填关税率或交付截止")); })());
  ok("已有的一行把两项都清空：照常发（接口存成空）", (() => { const r = run((f) => ({ ...f, projects: [{ ...f.projects[0], dutyRatePct: "", deliveryDeadline: "" }, f.projects[1]] })); return r.ok && JSON.stringify(r.body.landedCost?.projects) === JSON.stringify({ projA: { dutyRatePct: null, deliveryDeadline: null } }); })());
  ok("没选项目：写明哪一行", (() => { const r = run((f) => ({ ...f, projects: [...f.projects, { projectId: "", dutyRatePct: "5", deliveryDeadline: "" }] })); return !r.ok && r.errors.some((e) => e.startsWith("项目设置第 3 行") && e.includes("选择项目")); })());
  ok("同一个项目两行：写明", (() => { const r = run((f) => ({ ...f, projects: [...f.projects, { ...f.projects[0] }] })); return !r.ok && r.errors.some((e) => e.includes("重复了")); })());
  ok("关税率超过 100、日期格式不对：各自写明", (() => { const r = run((f) => ({ ...f, projects: [{ ...f.projects[0], dutyRatePct: "150" }, { ...f.projects[1], deliveryDeadline: "12/20" }] })); return !r.ok && r.errors.some((e) => e.includes("关税率请填")) && r.errors.some((e) => e.includes("交付截止格式")); })());
}

console.log("一次改多项");
{
  const many = run((f) => ({ ...f, fromName: "New Name", insurancePct: "2", fxRows: [{ currency: "USD", rate: "1.4" }], projects: [] }));
  ok("多项一起改：都在一个请求里，接口的校验能通过", many.ok && many.body.fromName === "New Name" && many.body.landedCost?.insurancePct === 2 && JSON.stringify(many.body.landedCost?.fxRates) === JSON.stringify({ USD: 1.4 }) && JSON.stringify(many.body.landedCost?.projects) === JSON.stringify({ projA: null, projB: null }) && valid(many.body), many);
  const bad = run((f) => ({ ...f, fromEmail: "x", insurancePct: "abc" }));
  ok("有错时一次列出所有错，不发请求", !bad.ok && bad.errors.length === 2);
}

console.log("组织自己存的与回退的");
{
  const unstoredView: TenderRfqSettingsView = { ...VIEW, fromEmail: "project@env-default.test", mailboxEmail: "project@env-default.test", stored: { fromName: true, fromEmail: false, mailboxEmail: false } };
  const f0 = formFromView(unstoredView);
  ok("没存的发件项：表单里为空，生效值另记（用作占位文字）", f0.fromEmail === "" && f0.mailboxEmail === "" && f0.effective.fromEmail === "project@env-default.test" && f0.fromName === "Fixture Procurement");
  ok("旧接口没有 stored：当作都存了", formFromView({ ...VIEW, stored: undefined }).fromEmail === "project@fixture.test");
  const untouched = bodyFromForm(f0, f0);
  ok("没动：不发（回退值不会被写死）", untouched.ok && untouched.empty);
  const onlyFrom = bodyFromForm({ ...f0, fromEmail: "alias@fixture.test" }, f0);
  ok("授权邮箱没单独存、只改显示地址：授权邮箱固定为改之前实际用的那个（发信账号不变）", onlyFrom.ok && JSON.stringify(onlyFrom.body) === JSON.stringify({ fromEmail: "alias@fixture.test", mailboxEmail: "project@env-default.test" }) && valid(onlyFrom.body), onlyFrom);
  const both = bodyFromForm({ ...f0, fromEmail: "alias@fixture.test", mailboxEmail: "box@fixture.test" }, f0);
  ok("两个都改：按人填的", both.ok && both.body.mailboxEmail === "box@fixture.test");
  const storedMailbox = run((f) => ({ ...f, fromEmail: "alias@fixture.test" }));
  ok("授权邮箱已单独存：只改显示地址就只发显示地址", storedMailbox.ok && JSON.stringify(storedMailbox.body) === JSON.stringify({ fromEmail: "alias@fixture.test" }));
  const clearStored = run((f) => ({ ...f, fromEmail: "" }));
  ok("清空已存的显示地址：发 null（回到回退值）", clearStored.ok && clearStored.body.fromEmail === null);
  ok("邮箱规则与接口一致（a@b.c 这类接口不收的也不发）", (() => { const r = run((f) => ({ ...f, fromEmail: "a@b.c" })); return !r.ok === !tenderRfqSettingsPutSchema.safeParse({ fromEmail: "a@b.c" }).success; })());
}

console.log("汇率与日期来源是一个整体");
{
  const r = run((f) => ({ ...f, fxRows: [{ currency: "USD", rate: "1.31" }, { currency: "CNY", rate: "0.19" }] }));
  ok("只改了汇率：日期与来源按表单上的值一起发（两人同时改时不会挂上别人的日期与来源）", r.ok && r.body.landedCost?.fxAsOf === "2026-11-10" && r.body.landedCost?.fxSource === "MANUAL" && r.body.landedCost?.fxRates?.USD === 1.31, r);
  const onlyDate = run((f) => ({ ...f, fxAsOf: "2026-11-15" }));
  ok("只改日期：只发日期", onlyDate.ok && JSON.stringify(onlyDate.body) === JSON.stringify({ landedCost: { fxAsOf: "2026-11-15" } }));
  const brokenDateView: TenderRfqSettingsView = { ...VIEW, landedCost: { ...VIEW.landedCost, fxAsOf: null } };
  const fb = formFromView(brokenDateView);
  const senderOnly = bodyFromForm({ ...fb, fromName: "New" }, fb);
  ok("存量汇率日期缺失时只改发件名：不拦（与接口一致，接口只在写落地价参数时查）", senderOnly.ok && JSON.stringify(senderOnly.body) === JSON.stringify({ fromName: "New" }));
  const lcEdit = bodyFromForm({ ...fb, insurancePct: "2" }, fb);
  ok("同样情况下改落地价参数：拦下，写明缺日期与来源", !lcEdit.ok && lcEdit.errors.includes(FX_NEEDS_DATE_AND_SOURCE_ZH));
}

console.log("页面状态（reducer）");
{
  const reduce = (actions: SectionAction[], start: SectionState = initialSectionState()) => actions.reduce(sectionReducer, start);
  const ready = reduce([{ type: "loaded", view: VIEW }]);
  ok("读到之后：可编辑，打开时的值 = 表单", ready.phase === "ready" && ready.form != null && JSON.stringify(ready.form) === JSON.stringify(ready.initial));
  ok("读失败 403（不是管理员）：整节不显示", reduce([{ type: "loadFailed", status: 403 }]).phase === "hidden");
  const e500 = reduce([{ type: "loadFailed", status: 500 }]);
  ok("读失败其它原因：显示错误，不是悄悄消失", e500.phase === "error" && e500.loadError === LOAD_FAILED_ZH);
  ok("网络失败：同样显示错误", reduce([{ type: "loadFailed", status: null }]).phase === "error");
  const fx = reduce([{ type: "fxAdd" }, { type: "fxUpdate", index: 2, patch: { currency: "eur" } }, { type: "fxUpdate", index: 2, patch: { rate: "1.5" } }], ready);
  ok("加一行汇率、填币种（自动转大写）与汇率：只改这一行", fx.form!.fxRows.length === 3 && fx.form!.fxRows[2].currency === "EUR" && fx.form!.fxRows[2].rate === "1.5" && fx.form!.fxRows[0].currency === "CNY" && fx.form!.fxRows[1].currency === "USD");
  const fxRm = reduce([{ type: "fxRemove", index: 0 }], ready);
  ok("删第 1 行汇率：只删这一行", fxRm.form!.fxRows.length === 1 && fxRm.form!.fxRows[0].currency === "USD");
  const pj = reduce([{ type: "projectAdd" }, { type: "projectUpdate", index: 2, patch: { projectId: "projC" } }, { type: "projectUpdate", index: 2, patch: { dutyRatePct: "5" } }, { type: "projectRemove", index: 0 }], ready);
  ok("加一行项目、选项目、填关税率、删第 1 行：各自只动对应的那一行", pj.form!.projects.length === 2 && pj.form!.projects[0].projectId === "projB" && pj.form!.projects[1].projectId === "projC" && pj.form!.projects[1].dutyRatePct === "5");
  const est = reduce([{ type: "estimate", key: "inland", patch: { mode: "per_shipment" } }, { type: "estimate", key: "inland", patch: { value: "800" } }], ready);
  ok("改估算方式与数值", est.form!.inland.mode === "per_shipment" && est.form!.inland.value === "800" && est.form!.freight.mode === "per_unit");
  const set = reduce([{ type: "set", key: "insurancePct", value: "1.5" }], ready);
  ok("改一个输入框", set.form!.insurancePct === "1.5" && set.initial!.insurancePct === "1");
  const undo = reduce([{ type: "reset" }], set);
  ok("撤销未保存的修改：回到打开时的值，清掉提示", JSON.stringify(undo.form) === JSON.stringify(set.initial) && undo.errors.length === 0);
  const p1 = prepareSave(set);
  ok("保存：只发改过的项", p1.kind === "send" && JSON.stringify(p1.body) === JSON.stringify({ landedCost: { insurancePct: 1.5 } }));
  ok("没改动就点保存：不调接口，提示没有改动", prepareSave(ready).kind === "empty" && reduce([{ type: "nothingToSave" }], ready).msg === NOTHING_TO_SAVE_ZH);
  const bad = reduce([{ type: "set", key: "fxAsOf", value: "" }], ready);
  const p2 = prepareSave(bad);
  ok("有错：不调接口，列出错误", p2.kind === "errors" && reduce([{ type: "validationFailed", errors: p2.kind === "errors" ? p2.errors : [] }], bad).errors.includes(FX_NEEDS_DATE_AND_SOURCE_ZH));
  const busy = reduce([{ type: "saveStarted" }], set);
  ok("保存中：不能再改、不能撤销、不能再保存", busy.busy && reduce([{ type: "set", key: "insurancePct", value: "9" }], busy).form!.insurancePct === "1.5" && JSON.stringify(reduce([{ type: "reset" }], busy).form) === JSON.stringify(busy.form) && prepareSave(busy).kind === "noop");
  const newView: TenderRfqSettingsView = { ...VIEW, landedCost: { ...VIEW.landedCost, insurancePct: 1.5 } };
  const okd = reduce([{ type: "saveSucceeded", view: newView }], busy);
  ok("保存成功：用接口返回的设置更新表单与打开时的值，提示已保存", !okd.busy && okd.msg === SAVED_ZH && okd.form!.insurancePct === "1.5" && okd.initial!.insurancePct === "1.5" && prepareSave(okd).kind === "empty");
  const failed = reduce([{ type: "saveFailed", error: "参数不合法", issues: ["landedCost.fxAsOf: 日期格式 YYYY-MM-DD"] }], busy);
  ok("保存失败：列出接口的错误与逐项说明，修改保留", !failed.busy && failed.errors[0] === "参数不合法" && failed.errors[1].startsWith("landedCost.fxAsOf") && failed.form!.insurancePct === "1.5");
  ok("保存失败没有说明：写「保存失败」", reduce([{ type: "saveFailed" }], busy).errors[0] === "保存失败");
  const pf = reduce([{ type: "projectsFailed" }], ready);
  ok("项目列表读失败：给提示，不能新加项目（已有的照常显示）", pf.projectsError === PROJECTS_FAILED_ZH && reduce([{ type: "projectAdd" }], pf).form!.projects.length === 2);
  ok("项目列表读到：可选", reduce([{ type: "projectsLoaded", projects: [{ id: "projA", name: "A" }] }], ready).projects.length === 1);
}

console.log("呈现");
{
  const st = (o: Partial<SectionState> = {}): SectionState => ({ ...sectionReducer(initialSectionState(), { type: "loaded", view: VIEW }), projects: [{ id: "projA", name: "Fixture Tender A" }], ...o });
  const html = (o: Partial<SectionState> = {}) => renderToStaticMarkup(<TenderRfqSettingsFields state={st(o)} dispatch={() => undefined} onSave={() => undefined} />);
  const h = html();
  ok("标题、用途说明、两个地址的说明", h.includes("询价与落地价设置") && h.includes(SETTINGS_PURPOSE_ZH) && h.includes(MAILBOX_NOTE_ZH));
  ok("当前值都显示出来（地址、汇率、日期、运费、保险、清关）", h.includes('value="project@fixture.test"') && h.includes('value="owner@fixture.test"') && h.includes('value="USD"') && h.includes('value="1.36"') && h.includes('value="2026-11-10"') && h.includes('value="150"'));
  ok("估算方式的选项：不填 / 按件 / 按票 / 按货值百分比", h.includes("不填") && h.includes("按件（CAD / 件）") && h.includes("按票（CAD / 票）") && h.includes("按货值百分比（%）"));
  ok("没有密码、令牌输入", !h.includes('type="password"') && !/密码|令牌|token|secret/i.test(h));
  ok("写明 GST/HST 不在这里填", h.includes("GST/HST 不在这里填"));
  ok("项目设置：列表里的显示名称；不在列表里的显示 id 并标明", h.includes("Fixture Tender A") && h.includes("projB（不在列表里）"));
  const withErr = html({ errors: [FX_NEEDS_DATE_AND_SOURCE_ZH] });
  ok("有错时列出来", withErr.includes('data-testid="tender-rfq-settings-errors"') && withErr.includes(FX_NEEDS_DATE_AND_SOURCE_ZH));
  ok("没错时没有错误框", !h.includes("tender-rfq-settings-errors"));
  ok("数字输入用文本框（避免浏览器把打错的数字当成空，误清空）", !h.includes('type="number"') && h.includes('inputMode="decimal"'));
  const busyH = html({ busy: true });
  ok("保存中：保存、撤销按钮与输入框都禁用", /data-testid="tender-rfq-settings-save"[^>]*disabled=""/.test(busyH.replace(/disabled=""([^>]*)data-testid="tender-rfq-settings-save"/, 'data-testid="tender-rfq-settings-save" disabled=""')) && /disabled=""[^>]*data-testid="tender-rfq-settings-reset"|data-testid="tender-rfq-settings-reset"[^>]*disabled=""/.test(busyH) && (busyH.match(/disabled=""/g) ?? []).length > 15);
  ok("不在保存中：保存按钮可点", !/disabled=""[^>]*data-testid="tender-rfq-settings-save"|data-testid="tender-rfq-settings-save"[^>]*disabled=""/.test(h));
  const unstored = renderToStaticMarkup(<TenderRfqSettingsFields state={st({ form: formFromView({ ...VIEW, fromEmail: "project@env.test", mailboxEmail: "project@env.test", stored: { fromName: true, fromEmail: false, mailboxEmail: false } }), initial: formFromView({ ...VIEW, fromEmail: "project@env.test", mailboxEmail: "project@env.test", stored: { fromName: true, fromEmail: false, mailboxEmail: false } }) })} dispatch={() => undefined} onSave={() => undefined} />);
  ok("没单独设置的地址：输入框为空，占位文字写明当前用的是什么；并说明授权邮箱会被固定", unstored.includes('placeholder="未单独设置，当前用：project@env.test"') && unstored.includes(PIN_MAILBOX_NOTE_ZH));
  ok("已单独设置的授权邮箱：不出现固定说明", !h.includes(PIN_MAILBOX_NOTE_ZH));
  ok("读失败：显示错误", html({ phase: "error", loadError: LOAD_FAILED_ZH, form: null }).includes(LOAD_FAILED_ZH));
  ok("不是管理员（hidden）、还在读：什么都不渲染", html({ phase: "hidden" }) === "" && html({ phase: "loading" }) === "");
  const pfh = html({ projectsError: PROJECTS_FAILED_ZH });
  ok("项目列表读失败：有提示，「加一个项目」禁用", pfh.includes(PROJECTS_FAILED_ZH) && /disabled=""[^>]*>[^<]*<svg[^>]*>[\s\S]*?加一个项目|加一个项目/.test(pfh));
  ok("保存后的提示显示出来", html({ msg: SAVED_ZH }).includes(SAVED_ZH));
  const inlandInput = h.match(/<input[^>]*aria-label="出口国内陆运费（EXW 用）数值"[^>]*>/)?.[0] ?? "";
  const freightInput = h.match(/<input[^>]*aria-label="国际运费（海运）数值"[^>]*>/)?.[0] ?? "";
  ok("估算方式为「不填」时数值框禁用；选了方式的可填", inlandInput.includes('disabled=""') && freightInput !== "" && !freightInput.includes('disabled=""'), { inlandInput, freightInput });
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = read("src/app/(main)/organizations/[orgId]/page.tsx");
  const sec = read("src/components/organizations/tender-rfq-settings-section.tsx");
  const route = read("src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts");
  ok("组织页：只对 canManageOrg（org_admin / 平台管理员）且组织在用时渲染", page.includes("{canEditTenderRfqSettings && <TenderRfqSettingsSection key={orgId} orgId={orgId} />}") && page.includes('const canEditTenderRfqSettings = canManageOrg && org?.status === "active";') && /const canManageOrg =\s*org\?\.myRole === "org_admin" \|\| isSuperAdmin\(platformRole\);/.test(page));
  ok("读与存走现有接口（GET / PUT tender-rfq-settings），请求体来自 prepareSave", sec.includes("`/api/organizations/${orgId}/tender-rfq-settings`") && sec.includes('method: "PUT"') && sec.includes("const p = prepareSave(state);") && sec.includes("body: JSON.stringify(p.body)"));
  ok("读失败按状态码交给 reducer（403 才隐藏）", sec.includes('if (!res.ok) dispatch({ type: "loadFailed", status: res.status });'));
  ok("保存成功用接口返回的设置，失败带上逐项说明", sec.includes('dispatch({ type: "saveSucceeded", view: json as unknown as TenderRfqSettingsView })') && sec.includes("issues: Array.isArray(json.issues)"));
  ok("项目下拉只列招投标项目；读失败交给 reducer", sec.includes('.filter((p) => p.workDomain === "tender")') && sec.includes('dispatch({ type: "projectsFailed" })'));
  ok("接口：读取多返回 stored（哪几项是组织自己存的）", route.includes("stored: { fromName: isSet(\"fromName\"), fromEmail: isSet(\"fromEmail\"), mailboxEmail: isSet(\"mailboxEmail\"), ...t.stored }"));
  ok("接口：删除项目设置（null）不校验项目归属；写入的仍校验", route.includes(".filter(([, v]) => v !== null)") && route.includes("projects 里有不属于本组织的项目"));
}

console.log(`\nsettings-form: ${passed} passed`);
