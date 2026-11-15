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
import { tenderRfqSettingsPutSchema } from "../landed-cost";
import {
  FX_NEEDS_DATE_AND_SOURCE_ZH,
  MAILBOX_NOTE_ZH,
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
  ok("加一种币种：整张汇率表发出去，日期与来源没改就不发", add.ok && JSON.stringify(add.body) === JSON.stringify({ landedCost: { fxRates: { CNY: 0.19, USD: 1.36, EUR: 1.5 } } }) && valid(add.body), add);
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
  ok("百分比超过 100：写明", (() => { const r = run((f) => ({ ...f, freight: { mode: "pct_of_goods", value: "120" } })); return !r.ok && r.errors.some((e) => e.includes("不能超过 100")); })());
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

console.log("呈现");
{
  const html = (o: { errors?: string[]; projects?: Array<{ id: string; name: string }>; form?: TenderRfqSettingsForm } = {}) =>
    renderToStaticMarkup(<TenderRfqSettingsFields form={o.form ?? base()} onChange={() => undefined} projects={o.projects ?? [{ id: "projA", name: "Fixture Tender A" }]} errors={o.errors ?? []} msg={null} busy={false} onSave={() => undefined} onReset={() => undefined} />);
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
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = read("src/app/(main)/organizations/[orgId]/page.tsx");
  const sec = read("src/components/organizations/tender-rfq-settings-section.tsx");
  ok("组织页：只对 canManageOrg（org_admin / 平台管理员）渲染", page.includes("{canManageOrg && <TenderRfqSettingsSection orgId={orgId} />}") && /const canManageOrg =\s*org\?\.myRole === "org_admin" \|\| isSuperAdmin\(platformRole\);/.test(page));
  ok("读与存走现有接口（GET / PUT tender-rfq-settings），请求体来自 bodyFromForm", sec.includes("`/api/organizations/${orgId}/tender-rfq-settings`") && sec.includes('method: "PUT"') && sec.includes("const r = bodyFromForm(form, initial);") && sec.includes("body: JSON.stringify(r.body)"));
  ok("有错或没改动时不调接口", /if \(!r\.ok\) \{\s*setErrors\(r\.errors\);\s*return;\s*\}/.test(sec) && /if \(r\.empty\) \{\s*setMsg\("没有改动"\);\s*return;\s*\}/.test(sec));
  ok("读取失败（如不是管理员，接口 403）：这一节不显示", sec.includes(".catch(() => setHidden(true));") && sec.includes("if (hidden || !form || !initial) return null;"));
  ok("项目下拉只列招投标项目", sec.includes('.filter((p) => p.workDomain === "tender")'));
  ok("保存之后重新读取（打开时的值随之更新）", /setMsg\("已保存"\);\s*load\(\);/.test(sec));
}

console.log(`\nsettings-form: ${passed} passed`);
