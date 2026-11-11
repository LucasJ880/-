/**
 * TI-4c 行明细与补遗的录入（纯函数）+ 面板源码断言
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeWorkspace, saveWorkspaceRequestSchema, type LineDetail, type StoredWorkspace } from "../contract";
import {
  addendumFromDraft, detailFromDraft, draftFromDetail, emptyCertDraft, formatLineNos, parseAffectedLines, removeAddendum, upsertAddendum, withLineDetail,
  type CertDraft, type LineEntryDraft,
} from "../line-entry";
import { buildWorkspaceView, type WorkspaceContext } from "../workspace-view";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-11-11T15:00:00Z");
const ctx: WorkspaceContext = { now, closingAtIso: new Date(OTTAWA_18026.opportunity.closingAt).toISOString(), ownNames: ["Sunny Shutter Inc."], documentCount: 3, quotedSupplierCount: 0 };
const draft = (o: Partial<LineEntryDraft> = {}): LineEntryDraft => ({ make: "", model: "", offeredDimensions: "", certificates: [], ...o });
const cert = (o: Partial<CertDraft> = {}): CertDraft => ({ ...emptyCertDraft(), id: "CSA-70012345", status: "VERIFIED", coverage: "WHOLE_UNIT", issuer: "CSA Group", accredited: "YES", coveredModels: "HX-100, HX-100B", expiresAt: "2028-06-30", evidenceRef: "CSA 产品清单查询截图 2026-11-01", ...o });
const detailOf = (d: LineEntryDraft, basedOnAddendum = 0): LineDetail => { const r = detailFromDraft(d, { basedOnAddendum }); assert.ok(r.ok && r.detail); return r.detail; };

/* ---------- 草稿 → 保存内容 ---------- */
console.log("行明细草稿");
{
  const d = detailOf(draft({ make: " HeatX ", model: "HX-100", offeredDimensions: " 40 x 24 x 24 " }), 1);
  ok("品牌、型号、产品尺寸去掉首尾空白；记下补遗号", d.product?.make === "HeatX" && d.product?.model === "HX-100" && d.offeredDimensions === "40 x 24 x 24" && d.basedOnAddendum === 1);
  const empty = detailFromDraft(draft({ certificates: [emptyCertDraft()] }), { basedOnAddendum: 0 });
  ok("三项都空且没有证书 → 明细为空（该行应被移除）", empty.ok && empty.detail === null);
  const onlyDim = detailOf(draft({ offeredDimensions: "39 x 77.5 x 12" }));
  ok("只填产品尺寸 → 没有产品、没有证书", onlyDim.product === null && onlyDim.certificates?.length === 0);
  const c = detailOf(draft({ make: "HeatX", model: "HX-100", certificates: [cert(), emptyCertDraft()] })).certificates!;
  ok("证书：空白的那张被忽略；型号按逗号拆开；是否受认可转成布尔", c.length === 1 && c[0].coveredModels.join("|") === "HX-100|HX-100B" && c[0].issuerAccreditedInCanada === true && c[0].evidenceRef === "CSA 产品清单查询截图 2026-11-01");
  ok("是否受认可：否 → false，未确认 → null", detailOf(draft({ certificates: [cert({ accredited: "NO" })] })).certificates![0].issuerAccreditedInCanada === false && detailOf(draft({ certificates: [cert({ accredited: "UNKNOWN" })] })).certificates![0].issuerAccreditedInCanada === null);
  ok("到期日留空 → 空值（证书未载明到期日）", detailOf(draft({ certificates: [cert({ expiresAt: "" })] })).certificates![0].expiresAt === null);
  const noEvidence = detailFromDraft(draft({ certificates: [cert({ evidenceRef: "  " })] }), { basedOnAddendum: 0 });
  ok("已核验而没有出处 → 不通过，并说明是哪张证书", !noEvidence.ok && noEvidence.issuesZh.some((m) => m.includes("CSA-70012345") && m.includes("必须填出处")));
  ok("供应商声称不要求出处", detailFromDraft(draft({ certificates: [cert({ status: "CLAIMED", evidenceRef: "" })] }), { basedOnAddendum: 0 }).ok);
  const badDate = detailFromDraft(draft({ certificates: [cert({ expiresAt: "2028-02-30" })] }), { basedOnAddendum: 0 });
  ok("到期日不是有效日期 → 不通过", !badDate.ok && badDate.issuesZh[0].includes("2028-02-30"));
  const noId = detailFromDraft(draft({ certificates: [cert({ id: " " })] }), { basedOnAddendum: 0 });
  ok("填了内容却没有编号 → 不通过", !noId.ok && noId.issuesZh[0].includes("缺少编号"));
  const dup = detailFromDraft(draft({ certificates: [cert(), cert({ id: "csa-70012345" })] }), { basedOnAddendum: 0 });
  ok("编号重复（不分大小写）→ 不通过", !dup.ok && dup.issuesZh[0].includes("重复"));
  const round = draftFromDetail(detailOf(draft({ make: "HeatX", model: "HX-100", offeredDimensions: "40 x 24 x 24", certificates: [cert()] })));
  ok("保存内容 → 草稿 → 保存内容 往返一致", JSON.stringify(detailOf(round)) === JSON.stringify(detailOf(draft({ make: "HeatX", model: "HX-100", offeredDimensions: "40 x 24 x 24", certificates: [cert()] }))));
  ok("没有明细的行给出空草稿", JSON.stringify(draftFromDetail(undefined)) === JSON.stringify(draft()));
  ok("草稿转出的内容通过保存接口的请求校验", saveWorkspaceRequestSchema.safeParse({ lineDetails: { "13": detailOf(draft({ make: "HeatX", model: "HX-100", certificates: [cert()] })) } }).success);
}

/* ---------- 合并进整块明细 ---------- */
console.log("合并行明细");
{
  const all = { "1": detailOf(draft({ offeredDimensions: "39 x 77.5 x 12" })), "18": detailOf(draft({ offeredDimensions: "36 x 39" })) };
  const next = withLineDetail(all, 13, detailOf(draft({ make: "HeatX", model: "HX-100" })));
  ok("保存一行不改动其它行已存的明细", Object.keys(next).join() === "1,13,18" && next["1"] === all["1"] && next["18"] === all["18"]);
  ok("不修改传入的对象", Object.keys(all).join() === "1,18");
  ok("明细为空 → 移除该行", Object.keys(withLineDetail(next, 18, null)).join() === "1,13");
  ok("原来没有任何明细也能加", Object.keys(withLineDetail(null, 2, all["1"])).join() === "2");
}

/* ---------- 影响的行与补遗 ---------- */
console.log("补遗");
{
  const valid = OTTAWA_18026_LINES.map((l) => l.lineNo);
  const r = parseAffectedLines("13-15, 18", valid);
  ok("`13-15, 18` → 13、14、15、18", r.lineNos.join() === "13,14,15,18" && r.issuesZh.length === 0);
  ok("中文分隔与「至」、去重、升序", parseAffectedLines("18、13至15，14", valid).lineNos.join() === "13,14,15,18");
  ok("写不成行号的内容被指出", parseAffectedLines("13, abc, 5-", valid).issuesZh.length === 2);
  ok("区间起点大于终点被指出", parseAffectedLines("15-13", valid).issuesZh[0].includes("起点大于终点"));
  ok("价格表里没有的行被指出", parseAffectedLines("17-20", valid).issuesZh[0] === "价格表里没有第 19、20 行");
  ok("空内容 → 没有行、没有问题（补遗可以不影响任何行）", parseAffectedLines("  ", valid).lineNos.length === 0 && parseAffectedLines("", valid).issuesZh.length === 0);
  const a = addendumFromDraft({ number: "1", issuedOn: "2026-11-05", affected: "13-15", effect: " 整机加拿大电气认证 " }, valid);
  ok("补遗草稿 → 保存内容", a.ok && a.addendum.number === 1 && a.addendum.affectedLineNos.join() === "13,14,15" && a.addendum.effect === "整机加拿大电气认证");
  const bad = addendumFromDraft({ number: "0", issuedOn: "11/05/2026", affected: "x", effect: "" }, valid);
  ok("补遗号、日期、影响的行各自报错", !bad.ok && bad.issuesZh.length === 3);
  assert.ok(a.ok);
  const two = upsertAddendum([{ number: 2, affectedLineNos: [1], issuedOn: null, effect: null }], a.addendum);
  ok("新增后按号升序", two.map((x) => x.number).join() === "1,2");
  const replaced = upsertAddendum(two, { ...a.addendum, affectedLineNos: [13] });
  ok("同号再保存 → 替换原有那一条", replaced.length === 2 && replaced[0].affectedLineNos.join() === "13");
  ok("删除", removeAddendum(two, 1).map((x) => x.number).join() === "2" && two.length === 2);
  ok("补遗列表通过保存接口的请求校验", saveWorkspaceRequestSchema.safeParse({ addenda: two }).success);
  ok("行号压成区间显示", formatLineNos([18, 13, 14, 15]) === "13–15、18" && formatLineNos([]) === "" && formatLineNos([3]) === "3");
}

/* ---------- 端到端（纯逻辑）：从全是阻断到只剩成本与截标 ---------- */
console.log("渥太华：逐行录入后的判定");
{
  let ws: StoredWorkspace = mergeWorkspace(null, { priceSchedule: { lines: OTTAWA_18026_LINES }, addenda: [{ number: 1, issuedOn: "2026-11-05", affectedLineNos: [13, 14, 15], effect: "整机加拿大电气认证" }] }, "u", now);
  const before = buildWorkspaceView(ws, ctx).readiness.blockers;
  ok("录入前：17 行尺寸尚未核对、3 行认证未过", before.filter((b) => b.code === "DIMENSION_UNKNOWN").length === 17 && before.filter((b) => b.code === "CERTIFICATION_BLOCKED").length === 3);
  const offered: Record<number, string> = { 1: "39 x 77.5 x 12", 2: "39 x 77.5 x 9", 3: "39 x 80 x 9", 4: "54 x 77.5 x 12", 5: "54 x 77.5 x 9", 6: "60 x 80 x 12", 7: "60 x 80 x 9", 8: "78 x 80 x 11", 9: "28 x 52 x 7", 10: "20 x 26", 11: "20 x 30", 13: "38 x 23 x 23", 14: "40 x 40 x 28", 15: "111 x 58 x 80", 16: "26 x 33", 17: "28 x 39", 18: "36 x 38" };
  const models: Record<number, string> = { 13: "HX-100", 14: "HX-200", 15: "HX-900" };
  for (const line of OTTAWA_18026_LINES) {
    if (!offered[line.lineNo]) continue;
    const m = models[line.lineNo];
    const d = detailOf(draft({ offeredDimensions: offered[line.lineNo], ...(m ? { make: "HeatX", model: m, certificates: [cert({ id: `CSA-${m}`, coveredModels: m })] } : {}) }), 1);
    ws = mergeWorkspace(ws, { lineDetails: withLineDetail(ws.lineDetails, line.lineNo, d) }, "u", now);
  }
  const v = buildWorkspaceView(ws, ctx);
  ok("逐行录入后：17 行尺寸相符、3 行认证通过", v.lineChecks.filter((c) => c.dimension?.verdict === "MATCH").length === 17 && v.lineChecks.filter((c) => c.certification.verdict === "PASS").length === 3);
  ok("阻断项只剩已过截标与还没有成本核算", v.readiness.blockers.map((b) => b.code).sort().join() === "COST_MISSING,WINDOW_EXPIRED");
  ok("没被补遗涉及的行补遗号记 0，被涉及的记 1", ws.lineDetails["1"].basedOnAddendum === 0 && ws.lineDetails["13"].basedOnAddendum === 1);
  const mismatch = mergeWorkspace(ws, { lineDetails: withLineDetail(ws.lineDetails, 18, detailOf(draft({ offeredDimensions: "36 x 39" }))) }, "u", now);
  ok("第 18 行改成 36 x 39 → 尺寸不符", buildWorkspaceView(mismatch, ctx).readiness.blockers.some((b) => b.code === "DIMENSION_MISMATCH" && b.lineNo === 18));
}

/* ---------- 面板源码断言 ---------- */
console.log("面板源码");
{
  const root = resolve(__dirname, "../../../..");
  const panel = readFileSync(resolve(root, "src/components/tender/bid-workspace-panel.tsx"), "utf8");
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("行录入保存时带上其它行的明细（接口按块替换）", /withLineDetail\(workspace\?\.lineDetails/.test(code));
  ok("保存一行时带上当时影响该行的最新补遗号", /detailFromDraft\(draft, \{ basedOnAddendum: latestAddendumFor\(/.test(code));
  ok("面板写明「已核验」是人工确认", /VERIFIED_IS_MANUAL_ZH/.test(code));
  ok("行录入与补遗的编辑入口只对有写权限的人显示", /canManage && \(\s*<button[^>]*data-testid=\{`bw-line-edit-/.test(code) && /canManage && <AddendumForm/.test(code));
  ok("仍然只请求投标工作区的两个接口，没有删除请求", [...code.matchAll(/\/api\/[^"'`\s)]*/g)].length === 2 && !/method:\s*"(DELETE|PATCH)"/.test(code));
}

console.log(`\n✓ line-entry: ${passed} 项断言全部通过`);
