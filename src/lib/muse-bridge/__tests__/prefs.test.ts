/**
 * P1-8 个人偏好记忆 — 纯函数测试（§4-8 … §4-11；供应商选择顺序；只对操作者生效）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/prefs.test.ts
 */
import assert from "node:assert/strict";
import { parseMuseCommand, MUSE_BRIDGE_CONTRACT_VERSION } from "../contract";
import {
  DEFAULT_SUPPLIERS_MAX,
  EMPTY_PREFS,
  applyPreference,
  learnIncoterm,
  learnSupplier,
  pickRfqIncoterm,
  pickRfqSuppliers,
  readUserPrefs,
  withUserPrefs,
  type MuseUserPrefs,
} from "../prefs-pure";
import { preferencesAdvisory, rfqDraftAdvisory } from "../router-pure";
import { renderAdvisory } from "../advisory";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-25T12:00:00Z");

console.log("muse-bridge prefs");

/* §4-8 */
{
  let p: MuseUserPrefs = EMPTY_PREFS;
  for (const id of ["s-1", "s-2", "s-3"]) p = learnSupplier(p, id, NOW);
  ok("§4-8 三次选不同供应商 → 最近优先", p.defaultSupplierIds.join() === "s-3,s-2,s-1", p.defaultSupplierIds);
  p = learnSupplier(p, "s-1", NOW);
  ok("§4-8 再选旧的一家 → 挪到最前且去重", p.defaultSupplierIds.join() === "s-1,s-3,s-2");
  for (const id of ["s-4", "s-5", "s-6"]) p = learnSupplier(p, id, NOW);
  ok("§4-8 选第 6 家 → 列表仍 5 个，最旧的被挤出", p.defaultSupplierIds.length === DEFAULT_SUPPLIERS_MAX && p.defaultSupplierIds[0] === "s-6" && !p.defaultSupplierIds.includes("s-2"), p.defaultSupplierIds);
}

/* 只对操作者生效 */
{
  const before = withUserPrefs(withUserPrefs({}, "u-A", EMPTY_PREFS), "u-B", { ...EMPTY_PREFS, defaultSupplierIds: ["s-B"] });
  const after = withUserPrefs(before, "u-A", learnSupplier(readUserPrefs(before, "u-A"), "s-1", NOW));
  ok("学习只改操作者那一条（u-B 不变）", readUserPrefs(after, "u-A").defaultSupplierIds.join() === "s-1" && readUserPrefs(after, "u-B").defaultSupplierIds.join() === "s-B");
  const withBindings = withUserPrefs({ museBridge: { bindings: { "muse:evan": { userId: "u-A" } } }, tenderRfq: { fromName: "X" } }, "u-A", EMPTY_PREFS);
  ok("写偏好不动绑定表与其它 settings 键", (withBindings.museBridge as { bindings: object }).bindings !== undefined && (withBindings.tenderRfq as { fromName: string }).fromName === "X");
}

/* §4-9：选择顺序 显式 > 提示 > 偏好 > 候选 */
{
  const prefs = { ...EMPTY_PREFS, defaultSupplierIds: ["s-A", "s-B"] };
  ok("§4-9 显式 supplierIds 优先", pickRfqSuppliers({ supplierIds: ["s-X"], supplierHint: "宁波", prefs }).source === "explicit");
  ok("§4-9 其次名称提示", pickRfqSuppliers({ supplierHint: "宁波", prefs }).source === "hint");
  const p = pickRfqSuppliers({ prefs });
  ok("§4-9 不带 supplierIds、偏好有 2 家 → 直接用这 2 家", p.source === "prefs" && JSON.stringify(p.supplierIds) === '["s-A","s-B"]');
  ok("§4-9 都没有 → 候选列表", pickRfqSuppliers({ prefs: EMPTY_PREFS }).source === "candidates");
  const draft = rfqDraftAdvisory({
    projectId: "p1", actionId: "pa-1", roundNumber: 1, replyBy: "2026-11-07", fromEmail: "project@sunnyshutter.ca",
    suppliers: [{ name: "A 工厂" }, { name: "B 贸易" }], blockedSuppliers: [], excludedRequirements: 0,
    supplierSource: "prefs", incoterm: "DDP", incotermFromPrefs: true,
  });
  ok("§4-9 草稿理由含「常用」并列出这 2 家", draft.reasons[0] === "按你常用的 A 工厂、B 贸易", draft.reasons);
  ok("§4-9 贸易条款来自偏好时注明", renderAdvisory(draft).includes("贸易条款 DDP（你的默认）"));
  ok("贸易条款：显式 > 偏好", pickRfqIncoterm("FOB", { ...EMPTY_PREFS, defaultIncoterm: "DDP" }).incoterm === "FOB" && pickRfqIncoterm(null, { ...EMPTY_PREFS, defaultIncoterm: "DDP" }).fromPrefs);
}

/* §4-10 */
{
  const set = applyPreference(EMPTY_PREFS, "defaultIncoterm", "ddp", NOW);
  assert.ok(set.ok);
  const stored = withUserPrefs({}, "u-A", set.prefs);
  const back = readUserPrefs(stored, "u-A");
  ok("§4-10 set_preference defaultIncoterm=DDP → preferences 读回", back.defaultIncoterm === "DDP" && renderAdvisory(preferencesAdvisory(back, new Map())).includes("默认贸易条款：DDP"));
  const env = (command: unknown) => ({ contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId: "req-0001-abcdef", orgId: "org_1", museUserRef: "muse:x", command });
  ok("preferences：已设默认条款时不再建议「设为 DDP」", preferencesAdvisory(back, new Map()).alternatives?.length === 0 && preferencesAdvisory(EMPTY_PREFS, new Map()).alternatives?.length === 1);
  ok("§4-10 写 {key:\"price\"} → 契约拒绝（command 路由回 VALIDATION_FAILED）", !parseMuseCommand(env({ intent: "set_preference", key: "price", value: 100 })).ok);
  ok("§4-10 合法 key 但值不对 → applyPreference 拒绝（handler 回 VALIDATION_FAILED）", !applyPreference(EMPTY_PREFS, "defaultIncoterm", "XYZ", NOW).ok && !applyPreference(EMPTY_PREFS, "chaseAfterDays", 0, NOW).ok && !applyPreference(EMPTY_PREFS, "defaultSupplierIds", ["a", "b", "c", "d", "e", "f"], NOW).ok);
  ok("§4-10 不认识的 key 在纯函数层也拒绝", !applyPreference(EMPTY_PREFS, "price", 1, NOW).ok);
  ok("null 清空", (() => { const r = applyPreference({ ...EMPTY_PREFS, defaultIncoterm: "DDP" }, "defaultIncoterm", null, NOW); return r.ok && r.prefs.defaultIncoterm === null; })());
  ok("契约接受合法 set_preference / preferences", parseMuseCommand(env({ intent: "set_preference", key: "chaseAfterDays", value: 5 })).ok && parseMuseCommand(env({ intent: "preferences" })).ok);
}

/* §4-11 */
{
  // 调用方硬塞金额类字段：写回时只序列化四个白名单字段
  const polluted = { ...EMPTY_PREFS, defaultSupplierIds: ["s-1"], price: 42.5, unitPrice: 1, cost: 9, landedCad: 100, marginPct: 12, budget: 1 } as unknown as MuseUserPrefs;
  const stored = withUserPrefs({}, "u-A", polluted);
  const json = JSON.stringify((stored.museBridge as { userPrefs: Record<string, unknown> }).userPrefs["u-A"]);
  ok("§4-11 偏好 JSON 只有四个键", JSON.stringify(Object.keys(JSON.parse(json)).sort()) === JSON.stringify(["chaseAfterDays", "defaultIncoterm", "defaultSupplierIds", "lastUpdatedAt"]), json);
  ok("§4-11 偏好 JSON 里不存在价格 / 成本类键", !/price|cost|landed|margin|budget|amount|成本|价格|金额/i.test(json), json);
  const fromDb = readUserPrefs({ museBridge: { userPrefs: { "u-A": { defaultSupplierIds: ["s-1"], price: 99 } } } }, "u-A");
  ok("§4-11 读出时也丢弃非白名单键", !("price" in fromDb));
}

/* rfq 意图的 incoterm 参数：显式 > 偏好 */
{
  const env = (command: unknown) => ({ contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId: "req-0002-abcdef", orgId: "org_1", museUserRef: "muse:x", command });
  const r = parseMuseCommand(env({ intent: "rfq", projectId: "p1", incoterm: " ddp " }));
  ok("rfq 意图接受 incoterm（大小写 / 空格不敏感）", r.ok && (r.value.command as { incoterm?: string }).incoterm === "DDP");
  ok("rfq 意图拒绝不认识的贸易条款", !parseMuseCommand(env({ intent: "rfq", projectId: "p1", incoterm: "CPT" })).ok);
  ok("rfq 意图不带 incoterm 仍合法", parseMuseCommand(env({ intent: "rfq", projectId: "p1" })).ok);
  const t = pickRfqIncoterm("FOB", { ...EMPTY_PREFS, defaultIncoterm: "DDP" });
  const draft = rfqDraftAdvisory({
    projectId: "p1", actionId: "pa-1", roundNumber: 1, replyBy: "2026-11-07", fromEmail: "project@sunnyshutter.ca",
    suppliers: [{ name: "A 工厂" }], blockedSuppliers: [], excludedRequirements: 0,
    supplierSource: "explicit", incoterm: t.incoterm, incotermFromPrefs: t.fromPrefs,
  });
  ok("显式贸易条款覆盖偏好，草稿里不标「你的默认」", renderAdvisory(draft).includes("贸易条款 FOB") && !renderAdvisory(draft).includes("你的默认"));
}

/* 学习贸易条款：仅当之前为 null */
{
  ok("learnIncoterm：之前为 null → 记下", learnIncoterm(EMPTY_PREFS, "FOB", NOW).defaultIncoterm === "FOB");
  ok("learnIncoterm：已有默认 → 不覆盖", learnIncoterm({ ...EMPTY_PREFS, defaultIncoterm: "DDP" }, "FOB", NOW).defaultIncoterm === "DDP");
  ok("learnIncoterm：不认识的条款不记", learnIncoterm(EMPTY_PREFS, "CPT", NOW).defaultIncoterm === null);
}

/* 坏数据 */
{
  const p = readUserPrefs({ museBridge: { userPrefs: { "u-A": { defaultSupplierIds: ["a", "a", 3, "", "b"], defaultIncoterm: "XYZ", chaseAfterDays: 999 } } } }, "u-A");
  ok("坏数据：去重、丢非法、越界当没填", p.defaultSupplierIds.join() === "a,b" && p.defaultIncoterm === null && p.chaseAfterDays === null);
}

console.log(`\nmuse-bridge prefs: ${passed} passed`);
