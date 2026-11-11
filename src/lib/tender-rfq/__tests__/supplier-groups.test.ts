/**
 * RFQ-AUTO-5 供应商分组 — 纯逻辑测试（开关 / 校验 / 比对 / 抽屉预选 / 修改 / 保存结果的处理）+ 接线断言
 * 运行：npx tsx src/lib/tender-rfq/__tests__/supplier-groups.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRfqSupplierGroupsEnabledForOrgWithEnv } from "../supplier-groups-flags";
import {
  EMPTY_SUPPLIER_GROUPS,
  SUPPLIER_GROUP_LIMITS,
  addGroup,
  buildSupplierGroupsEntry,
  findGroup,
  groupHint,
  groupPreselection,
  groupsWithoutKeywords,
  interpretGroupsSaveResponse,
  matchSupplierGroup,
  normalizeForMatch,
  parseKeywordsInput,
  parseSupplierGroupsDoc,
  removeGroup,
  replaceGroupSuppliers,
  sameSupplierGroups,
  sameSelection,
  selectionForGroup,
  supplierIdsInGroups,
  updateGroupMeta,
  validateSupplierGroups,
  type SupplierGroup,
  type SupplierGroupsDoc,
} from "../supplier-groups";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const G = (name: string, supplierIds: string[], keywords: string[] = []): SupplierGroup => ({ name, supplierIds, keywords });
const errOf = (raw: unknown): string => { const v = validateSupplierGroups(raw); return v.ok ? "" : v.error; };
const valid = (raw: unknown): SupplierGroupsDoc => { const v = validateSupplierGroups(raw); assert.equal(v.ok, true, v.ok ? "" : v.error); return (v as { doc: SupplierGroupsDoc }).doc; };

/* ---------- 开关 ---------- */
console.log("开关");
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
ok("默认关", !isRfqSupplierGroupsEnabledForOrgWithEnv("org1", env({})));
ok("打开且没有白名单 → 对所有组织生效", isRfqSupplierGroupsEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_SUPPLIER_GROUPS_ENABLED: "1" })));
ok("白名单非空 → 只对名单内的组织生效", isRfqSupplierGroupsEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_SUPPLIER_GROUPS_ENABLED: "true", TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST: "org2, org1" })) && !isRfqSupplierGroupsEnabledForOrgWithEnv("org3", env({ TENDER_RFQ_SUPPLIER_GROUPS_ENABLED: "true", TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST: "org2, org1" })));
ok("没有组织 → 关；自动起草的开关不影响本开关", !isRfqSupplierGroupsEnabledForOrgWithEnv(null, env({ TENDER_RFQ_SUPPLIER_GROUPS_ENABLED: "1" })) && !isRfqSupplierGroupsEnabledForOrgWithEnv("org1", env({ TENDER_RFQ_AUTO_DRAFT_ENABLED: "1" })));

/* ---------- 校验 ---------- */
console.log("校验");
{
  const L = SUPPLIER_GROUP_LIMITS;
  ok("上限：10 组、每组 8 家、10 个关键词、名字 30 字", L.groups === 10 && L.suppliers === 8 && L.keywords === 10 && L.nameMax === 30);
  ok("合规的一份通过，并收拾空白", JSON.stringify(valid([{ name: "  窗饰  供应商 ", supplierIds: ["a", "b"], keywords: [" blind ", "Roller   Shade"] }])) === JSON.stringify({ groups: [G("窗饰 供应商", ["a", "b"], ["blind", "Roller Shade"])] }));
  ok("空列表合规（= 没有分组）", valid([]).groups.length === 0);
  ok("不是列表 → 拒绝", errOf({ groups: [] }).length > 0 && errOf(null).length > 0 && errOf("x").length > 0);
  ok("11 个分组 → 拒绝", errOf(Array.from({ length: 11 }, (_, i) => G(`组${i}`, ["a"]))).includes("最多 10 个分组"));
  ok("10 个分组 → 通过", valid(Array.from({ length: 10 }, (_, i) => G(`组${i}`, ["a"]))).groups.length === 10);
  ok("一组 9 家 → 拒绝；8 家 → 通过", errOf([G("窗饰", Array.from({ length: 9 }, (_, i) => `s${i}`))]).includes("最多 8 家") && valid([G("窗饰", Array.from({ length: 8 }, (_, i) => `s${i}`))]).groups[0].supplierIds.length === 8);
  ok("一组 0 家 → 拒绝", errOf([G("窗饰", [])]).includes("至少要有 1 家"));
  ok("组里有重复的供应商 → 拒绝", errOf([G("窗饰", ["a", "a"])]).includes("重复"));
  ok("供应商 id 不是字符串 / 为空 / 过长 → 拒绝", [[1], [""], ["x".repeat(65)], "a"].every((ids) => errOf([{ name: "窗饰", supplierIds: ids, keywords: [] }]).length > 0));
  ok("两组同名（大小写、全半角不同也算）→ 拒绝", errOf([G("Blinds", ["a"]), G("blinds", ["b"])]).includes("都叫") && errOf([G("ＡＢＣ", ["a"]), G("abc", ["b"])]).includes("都叫"));
  ok("名字为空 / 只有空白 / 不是字符串 → 拒绝", errOf([G("", ["a"])]).includes("不能为空") && errOf([G("   ", ["a"])]).includes("不能为空") && errOf([{ supplierIds: ["a"] }]).length > 0);
  ok("名字 31 字 → 拒绝；30 字 → 通过", errOf([G("字".repeat(31), ["a"])]).includes("最多 30 个字") && valid([G("字".repeat(30), ["a"])]).groups.length === 1);
  ok("英文关键词 2 个字符 → 拒绝（太短容易乱对）；3 个 → 通过", errOf([G("窗饰", ["a"], ["ab"])]).includes("至少 3 个字符") && valid([G("窗饰", ["a"], ["abc"])]).groups[0].keywords.join() === "abc");
  ok("全角英文也按英文算：「ａｂ」→ 拒绝", errOf([G("窗饰", ["a"], ["ａｂ"])]).includes("至少 3 个字符"));
  ok("中文关键词 2 个字 → 通过；1 个字 → 拒绝", valid([G("窗饰", ["a"], ["窗帘"])]).groups[0].keywords.join() === "窗帘" && errOf([G("窗饰", ["a"], ["帘"])]).includes("2–40"));
  ok("关键词 41 字 → 拒绝；空的关键词 → 拒绝", errOf([G("窗饰", ["a"], ["字".repeat(41)])]).includes("2–40") && errOf([G("窗饰", ["a"], ["  "])]).includes("空的关键词"));
  ok("同一组里重复的关键词（不分大小写）只留一个", valid([G("窗饰", ["a"], ["Blind", "blind", "BLIND "])]).groups[0].keywords.join() === "Blind");
  ok("11 个关键词 → 拒绝", errOf([G("窗饰", ["a"], Array.from({ length: 11 }, (_, i) => `keyword${i}`))]).includes("最多 10 个关键词"));
  ok("关键词可以不给（= 没有关键词）", valid([{ name: "窗饰", supplierIds: ["a"] }]).groups[0].keywords.length === 0);
  ok("关键词不是字符串列表 → 拒绝", errOf([{ name: "窗饰", supplierIds: ["a"], keywords: [1] }]).length > 0 && errOf([{ name: "窗饰", supplierIds: ["a"], keywords: "blind" }]).length > 0);
  ok("多余的字段被丢掉：存下来的只有名字、供应商、关键词", Object.keys(valid([{ name: "窗饰", supplierIds: ["a"], keywords: [], price: 1, userId: "u" }]).groups[0]).sort().join() === "keywords,name,supplierIds");
  ok("有一处不对就整体拒绝（不部分保存）", !validateSupplierGroups([G("窗饰", ["a"]), G("家具", [])]).ok);
}

/* ---------- 读库里存的那份 ---------- */
console.log("读库里存的那份");
{
  const doc = { groups: [G("窗饰", ["a", "b"], ["blind"])] };
  ok("记录里是 JSON 文本：解析出来", sameSupplierGroups(parseSupplierGroupsDoc(JSON.stringify(doc)), doc));
  ok("对象也认", sameSupplierGroups(parseSupplierGroupsDoc(doc), doc));
  ok("坏数据（不是 JSON / 结构不对 / 内容不合规 / 空）当作没有分组", [null, undefined, "", "{", "[]", JSON.stringify({ groups: "x" }), JSON.stringify({ groups: [G("窗饰", [])] }), 42].every((raw) => parseSupplierGroupsDoc(raw).groups.length === 0));
  ok("用到的全部供应商：去重、保持出现顺序", supplierIdsInGroups({ groups: [G("A", ["x", "y"]), G("B", ["y", "z"])] }).join() === "x,y,z");
}

/* ---------- 项目用哪一组 ---------- */
console.log("项目用哪一组");
{
  const doc: SupplierGroupsDoc = { groups: [G("窗饰", ["a", "b"], ["blind", "窗帘"]), G("家具", ["c"], ["furniture"]), G("杂项", ["d"])] };
  const m = (name: string | null | undefined) => matchSupplierGroup(doc, name);
  ok("恰好一组对上：给出这一组与对上的关键词（不分大小写；blind 能对上 BLINDS）", JSON.stringify(m("Supply and Install Window BLINDS – Phase 2")) === JSON.stringify({ kind: "one", group: "窗饰", keyword: "blind" }));
  ok("中文关键词", JSON.stringify(m("某小学窗帘更换项目")) === JSON.stringify({ kind: "one", group: "窗饰", keyword: "窗帘" }));
  ok("一组都没对上", m("Janitorial Services 2027").kind === "none");
  ok("对上不止一组：列出这些组，不替人选", JSON.stringify(m("Blinds and Furniture Supply")) === JSON.stringify({ kind: "many", groups: ["窗饰", "家具"] }));
  ok("没有关键词的组不会被对上（哪怕项目名称里有它的名字）", m("杂项采购").kind === "none");
  ok("项目名称为空 / 没有 → 没对上", m("").kind === "none" && m(null).kind === "none" && m(undefined).kind === "none" && m("   ").kind === "none");
  ok("没有分组 → 没对上", matchSupplierGroup(EMPTY_SUPPLIER_GROUPS, "Window Blinds").kind === "none");
  ok("全角与连续空白：关键词「Roller Shade」对上「ＲＯＬＬＥＲ   shade replacement」", matchSupplierGroup({ groups: [G("卷帘", ["a"], ["Roller Shade"])] }, "ＲＯＬＬＥＲ   shade replacement").kind === "one");
  ok("规整：全半角统一、转小写、连续空白并成一个、去首尾", normalizeForMatch("  ＡＢＣ   Def\n ") === "abc def");
  ok("一组里多个关键词都对上：仍只算这一组，依据是保存顺序里的第一个", JSON.stringify(matchSupplierGroup({ groups: [G("窗饰", ["a"], ["shade", "blind"])] }, "blind and shade")) === JSON.stringify({ kind: "one", group: "窗饰", keyword: "shade" }));
  ok("确定性：同样的输入两次结果相同", JSON.stringify(m("Window Blinds")) === JSON.stringify(m("Window Blinds")));
  ok("按名字找组不分大小写", findGroup({ groups: [G("Blinds", ["a"])] }, "blinds")?.name === "Blinds" && findGroup(doc, "没有") === null);
}

/* ---------- 询价入口 / 抽屉预选 ---------- */
console.log("抽屉预选");
{
  const sup = (id: string, o: Partial<{ ready: boolean; isDefault: boolean }> = {}) => ({ id, ready: true, isDefault: false, ...o });
  const suppliers = [sup("d1", { isDefault: true }), sup("d2", { isDefault: true }), sup("d3", { isDefault: true, ready: false }), sup("a"), sup("b", { ready: false }), sup("c"), sup("e")];
  const doc: SupplierGroupsDoc = { groups: [G("窗饰", ["c", "b", "a"], ["blind"]), G("家具", ["e"], ["furniture"])] };
  const entry = (projectName: string) => buildSupplierGroupsEntry({ doc, version: "v1", projectName, readySupplierIds: new Set(suppliers.filter((s) => s.ready).map((s) => s.id)) });

  const e = entry("Window Blinds");
  ok("入口：每组现在几家可选；停用的仍在组里", e.groups[0].supplierIds.join() === "c,b,a" && e.groups[0].readyCount === 2 && e.groups[1].readyCount === 1 && e.version === "v1" && e.limits.groups === 10);
  ok("入口：这个项目对上了哪一组", e.match.kind === "one" && e.match.group === "窗饰");

  const none = groupPreselection({ groups: null, suppliers, max: 8 });
  ok("没有分组字段（功能关闭）→ 预选可选的常用供应商，与本功能之前相同，没有提示", none.selected.join() === "d1,d2" && none.hint === null && none.activeGroup === null);
  ok("有分组字段但一个组都没有 → 同上", groupPreselection({ groups: { groups: [], match: { kind: "none" } }, suppliers, max: 8 }).selected.join() === "d1,d2");
  ok("与原来的写法逐字一致（常用且可选、不超过上限）", groupPreselection({ groups: undefined, suppliers, max: 1 }).selected.join() === suppliers.filter((s) => s.isDefault && s.ready).slice(0, 1).map((s) => s.id).join());

  const matched = groupPreselection({ groups: e, suppliers, max: 8 });
  ok("恰好一组对上 → 预选这一组里可选的，按组内顺序；常用供应商不勾", matched.selected.join() === "c,a" && matched.activeGroup === "窗饰");
  ok("对上时写明依据，并说明组里有几家现在不能选", matched.hint?.tone === "matched" && matched.hint.textZh.includes("项目名称里有「blind」，对上了分组「窗饰」，已按这一组勾选") && matched.hint.textZh.includes("另有 1 家现在不能选"));
  const afterSwitch = groupHint({ groups: e, suppliers, selected: ["e"], max: 8 });
  ok("人改选了别的组 / 手动改了勾选之后：说明跟着变，不再写「已按这一组勾选」，并告诉他怎么回到对上的那一组", afterSwitch?.tone === "matched" && afterSwitch.textZh.includes("对上了分组「窗饰」") && !afterSwitch.textZh.includes("已按这一组勾选") && afterSwitch.textZh.includes("点「窗饰」可以按这一组勾选"));
  ok("勾选同样几家但顺序不同（取消再勾回来）：仍算是这一组", groupHint({ groups: e, suppliers, selected: ["a", "c"], max: 8 })?.textZh.includes("已按这一组勾选") === true && sameSelection(["a", "c"], ["c", "a"]) && !sameSelection(["a"], ["a", "c"]) && !sameSelection(["a", "a"], ["a", "c"]));
  ok("没有分组时没有说明；刚打开时的说明就是按预选结果算出来的那一句", groupHint({ groups: null, suppliers, selected: [], max: 8 }) === null && groupHint({ groups: e, suppliers, selected: matched.selected, max: 8 })?.textZh === matched.hint.textZh);

  const und = groupPreselection({ groups: entry("Janitorial Services"), suppliers, max: 8 });
  ok("对不上 → 不预先勾选任何供应商（常用供应商也不勾），提示选一组或手动勾选", und.selected.length === 0 && und.activeGroup === null && und.hint?.tone === "undetermined" && und.hint.textZh.includes("没有对上任何分组") && und.hint.textZh.includes("手动勾选"));
  const many = groupPreselection({ groups: entry("Blinds and Furniture"), suppliers, max: 8 });
  ok("对上不止一组 → 不预先勾选，列出这些组", many.selected.length === 0 && many.hint?.tone === "undetermined" && many.hint.textZh.includes("「窗饰」「家具」"));

  ok("点一个分组：勾选换成这一组里可选的，按组内顺序", selectionForGroup(doc.groups[1], suppliers, 8).join() === "e" && selectionForGroup(doc.groups[0], suppliers, 8).join() === "c,a");
  ok("点分组也不超过上限", selectionForGroup(G("x", ["a", "c", "e"]), suppliers, 2).join() === "a,c" && selectionForGroup(G("x", ["a"]), suppliers, 0).length === 0);
  ok("组里的供应商不在可选列表里（已被删）→ 不会被勾上", selectionForGroup(G("x", ["ghost", "a"]), suppliers, 8).join() === "a");
  const allBlocked = groupPreselection({ groups: buildSupplierGroupsEntry({ doc: { groups: [G("窗饰", ["b"], ["blind"])] }, version: null, projectName: "blinds", readySupplierIds: new Set() }), suppliers, max: 8 });
  ok("对上的那一组里没有可选的 → 不勾任何人，并照实说明", allBlocked.selected.length === 0 && allBlocked.hint?.tone === "undetermined" && allBlocked.hint.textZh.includes("现在没有能发询价的供应商") === true);
}

/* ---------- 修改 ---------- */
console.log("修改");
{
  const doc: SupplierGroupsDoc = { groups: [G("窗饰", ["a", "b"], ["blind"]), G("家具", ["c"], ["furniture"])] };
  const before = JSON.stringify(doc);
  const added = addGroup(doc, G("灯具", ["d"], ["lighting"]));
  ok("新增：加在最后", added.groups.map((g) => g.name).join() === "窗饰,家具,灯具");
  const replaced = replaceGroupSuppliers(doc, "窗饰", ["x", "y", "z"]);
  ok("覆盖供应商：名字与关键词不变，别的组不动", replaced.groups[0].supplierIds.join() === "x,y,z" && replaced.groups[0].keywords.join() === "blind" && replaced.groups[1].supplierIds.join() === "c");
  const renamed = updateGroupMeta(doc, "窗饰", { name: "窗帘类", keywords: ["shade"] });
  ok("改名字与关键词：供应商不变", renamed.groups[0].name === "窗帘类" && renamed.groups[0].keywords.join() === "shade" && renamed.groups[0].supplierIds.join() === "a,b");
  ok("删除", removeGroup(doc, "家具").groups.map((g) => g.name).join() === "窗饰");
  ok("找不到的组：原样", sameSupplierGroups(replaceGroupSuppliers(doc, "没有", ["x"]), doc) && sameSupplierGroups(removeGroup(doc, "没有"), doc));
  ok("这些修改都不改原对象", JSON.stringify(doc) === before);
  ok("改完仍要过校验：改成与别的组同名会被拒", !validateSupplierGroups(updateGroupMeta(doc, "窗饰", { name: "家具", keywords: [] }).groups).ok);
  ok("没有关键词的组列出来（提示用）", groupsWithoutKeywords({ groups: [G("A", ["a"]), G("B", ["b"], ["kwd"])] }).join() === "A");
  ok("输入框里的关键词：逗号、顿号、分号、换行都能分隔，空的丢掉", parseKeywordsInput(" blind, shade，窗帘、卷帘;\n roller  shade ,, ").join("|") === "blind|shade|窗帘|卷帘|roller shade");
}

/* ---------- 保存接口的响应 → 界面该怎么办 ---------- */
console.log("保存结果的处理");
{
  const view = { groups: [{ ...G("窗饰", ["a", "b"], ["blind"]), readyCount: 2 }], match: { kind: "one", group: "窗饰", keyword: "blind" }, version: "v2", limits: SUPPLIER_GROUP_LIMITS };
  const saved = interpretGroupsSaveResponse({ ok: true, status: 200, json: { ok: true, changed: true, supplierGroups: view } });
  ok("保存成功 → 换成返回的这一份", saved.kind === "saved" && saved.view.version === "v2" && saved.view.groups[0].readyCount === 2 && saved.view.match.kind === "one");
  const conflict = interpretGroupsSaveResponse({ ok: false, status: 409, json: { ok: false, errorCode: "VERSION_CONFLICT", error: "分组在别处被改过了，已换成最新的。请再操作一次。", supplierGroups: view } });
  ok("版本已变 → 换成最新的一份并提示再操作一次", conflict.kind === "conflict" && conflict.view.version === "v2" && conflict.messageZh.includes("再操作一次"));
  const invalid = interpretGroupsSaveResponse({ ok: false, status: 400, json: { ok: false, errorCode: "INVALID", error: "分组「窗饰」里最多 8 家供应商。" } });
  ok("内容不合规 → 显示服务端给的原因，不换分组", invalid.kind === "error" && invalid.messageZh === "分组「窗饰」里最多 8 家供应商。");
  ok("功能关闭（404）→ 说明不可用", interpretGroupsSaveResponse({ ok: false, status: 404, json: null }).kind === "error" && (interpretGroupsSaveResponse({ ok: false, status: 404, json: null }) as { messageZh: string }).messageZh.includes("不可用"));
  ok("成功的状态码但内容看不懂（不是 JSON / 没有分组 / 分组不合规）→ 按没保存处理，不假装成功", [null, "<html>", { ok: true }, { ok: true, supplierGroups: { groups: "x", match: { kind: "none" }, version: null } }, { ok: true, supplierGroups: { groups: [], match: { kind: "weird" }, version: null } }, { ok: true, supplierGroups: { groups: [], match: { kind: "none" }, version: 3 } }].every((json) => interpretGroupsSaveResponse({ ok: true, status: 200, json }).kind === "error"));
  ok("成功的状态码但 ok 不是 true → 没保存", interpretGroupsSaveResponse({ ok: true, status: 200, json: { ok: false, supplierGroups: view } }).kind === "error");
  ok("409 但没带回最新的分组 → 按没保存处理", interpretGroupsSaveResponse({ ok: false, status: 409, json: { ok: false, error: "x" } }).kind === "error");
  ok("500 / 没有说明 → 通用的一句", (interpretGroupsSaveResponse({ ok: false, status: 500, json: null }) as { messageZh: string }).messageZh === "没有保存成功，请重试。");
  ok("返回的可选家数不合理（负数 / 超过组内家数 / 不是数字）→ 收到合理范围内", (() => { const r = interpretGroupsSaveResponse({ ok: true, status: 200, json: { ok: true, supplierGroups: { ...view, groups: [{ ...G("窗饰", ["a", "b"]), readyCount: 99 }, { ...G("家具", ["c"]), readyCount: -1 }, { ...G("灯具", ["d"]), readyCount: "x" }] , match: { kind: "none" } } } }); return r.kind === "saved" && r.view.groups.map((g) => g.readyCount).join() === "2,0,0"; })());
}

/* ---------- 接线（源码断言：只确认该接的地方接上了，行为在上面与隔离库测试里测） ---------- */
console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const drawer = read("src/components/inquiry/rfq-web-entry-drawer.tsx");
  const comp = read("src/components/inquiry/rfq-supplier-groups.tsx");
  const route = read("src/app/api/projects/[id]/tender-rfq/supplier-groups/route.ts");
  const service = read("src/lib/tender-rfq/supplier-groups-service.ts");
  const pure = read("src/lib/tender-rfq/supplier-groups.ts");
  const autoDraft = read("src/lib/tender-rfq/auto-draft-service.ts");
  const build = read("src/lib/tender-rfq/build.ts");

  ok("抽屉的预选走纯函数 groupPreselection（不再自己筛常用供应商）", drawer.includes("groupPreselection({ groups: entry.supplierGroups, suppliers: entry.suppliers, max: MAX_SUPPLIERS }).selected") && !drawer.includes("filter((s) => s.isDefault && s.ready)"));
  ok("抽屉只在入口给了分组时才渲染分组区；保存后刷新入口", drawer.includes("{groupsView && entry.suppliers.length > 0 && (") && drawer.includes("<RfqSupplierGroups") && /onSaved=\{\(view\) => \{\s*setSavedGroups\(view\);\s*onChanged\(\);/.test(drawer));
  ok("分组区：保存前先过校验、带上读到的那一版、结果交给纯函数处理", comp.includes("validateSupplierGroups(next.groups)") && comp.includes("baseVersion: view.version") && comp.includes("interpretGroupsSaveResponse("));
  ok("分组区：保存失败不动勾选（组件里没有在失败路径上调用 onSelect）", (comp.match(/onSelect\(/g) ?? []).length === 1 && comp.includes("onClick={() => onSelect(ids)}"));
  ok("分组区：删除要先确认", comp.includes("setConfirmDelete(g.name)") && comp.includes("确认删除") && comp.includes("供应商本身不会被删"));
  ok("分组区的测试标记齐全", ["rfq-groups-bar", "rfq-group-chip", "rfq-group-hint", "rfq-groups-manage", "rfq-group-create", "rfq-group-overwrite", "rfq-group-delete-confirm", "rfq-groups-message"].every((id) => comp.includes(`data-testid="${id}"`)));
  ok("接口：要求项目写权限；用户与组织取自登录态与项目，不取自请求体", route.includes("requireProjectWriteAccess(request, projectId)") && route.includes("userId: access.user.id") && route.includes("access.project.orgId") && route.includes(".strict()") && !/parsed\.data\.(userId|orgId)/.test(route));
  ok("接口：四种失败各有状态码（功能关闭 404、内容不合规 / 别的组织的供应商 400、版本已变 409）", route.includes("DISABLED: 404") && route.includes("INVALID: 400") && route.includes("FOREIGN_SUPPLIER: 400") && route.includes("VERSION_CONFLICT: 409"));
  ok("服务：读只按本人 + 本组织；保存在一个事务里先取本人的锁再比版本", service.includes("where: { orgId, userId, action: SUPPLIER_GROUPS_AUDIT_ACTION, targetType: SUPPLIER_GROUPS_TARGET, targetId: userId }") && service.includes("pg_advisory_xact_lock") && service.indexOf("pg_advisory_xact_lock") < service.indexOf("current.version !== input.baseVersion"));
  ok("服务：不写组织设置", !service.includes("settingsJson") && !service.includes("organization.update"));
  ok("纯函数文件零依赖（前后端共用）", !/^import /m.test(pure));
  ok("自动起草：只读操作者本人的分组，有分组时名单不取常用供应商", autoDraft.includes("loadActiveSupplierGroups(input.orgId, input.userId)") && autoDraft.includes("hasGroups ? (matchedGroup?.supplierIds ?? []) : prefs.defaultSupplierIds"));
  ok("询价单与邮件的生成不知道分组（分组信息不出站）", !build.includes("supplier-groups") && !build.includes("autoDraftGroup") && !build.includes("groupName"));
}

console.log(`\n✓ supplier-groups: ${passed} 项断言全部通过`);
