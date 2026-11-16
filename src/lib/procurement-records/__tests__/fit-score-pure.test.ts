/**
 * P2-2 新标匹配度：纯规则（四项、PSPC 例外、原因、总分、排序、查询串、页面接线）
 *
 * 运行：npx tsx src/lib/procurement-records/__tests__/fit-score-pure.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareByFit, computeFitScore, noticeBuyer, prepareFitProjects, projectsForNotice, FIT_NOTE_ZH, type FitNotice } from "../fit-score-pure";
import { candidatesQuery, FIT_SORT_VALUE, NEW_VIEW_VALUE } from "../new-notices-pure";
import { jaccard, tokenize } from "@/lib/projects/text-similarity";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("P2-2 fit score — pure");
const now = new Date("2026-11-16T15:00:00.000Z"); // 多伦多 11-16 10:00
const dim = (s: ReturnType<typeof computeFitScore>, key: string) => s.dimensions.find((d) => d.key === key)!;
const notice = (o: Partial<FitNotice> = {}): FitNotice => ({
  title: "Supply and installation of roller blinds",
  buyingInstitution: "Department of National Defence",
  contractingInstitution: "Public Services and Procurement Canada",
  closingAt: new Date("2026-12-07T19:00:00.000Z"), // 多伦多 12-07，21 天
  match: { productHits: ["roller blinds", "blinds"], serviceHits: [], categoryHits: [] },
  ...o,
});
const proj = (o: Partial<{ id: string; name: string; clientOrganization: string | null; tenderStatus: string | null; submittedAt: Date | null; sourceMetadataJson: string | null }>) => ({
  id: "p", name: "Office roller blinds replacement", clientOrganization: "DND", tenderStatus: null, submittedAt: null, ...o,
});

// spec 场景：两个产品词、同采购方中标过、21 天
const won = prepareFitProjects([proj({ id: "w1", name: "Roller blinds supply and installation", tenderStatus: "won", submittedAt: new Date() })]);
const s1 = computeFitScore(notice(), won, now);
ok(dim(s1, "BUSINESS_MATCH").points === 20, "两个产品词 → 20", dim(s1, "BUSINESS_MATCH"));
ok(dim(s1, "BUSINESS_MATCH").reasonZh.includes("roller blinds、blinds"), "原因写出命中的词");
ok(dim(s1, "BUYER_HISTORY").points === 25 && dim(s1, "BUYER_HISTORY").reasonZh === "与该采购方有 1 个投标项目，交过标 1 次，中标 1 次", "同采购方中标 → 25，只写次数", dim(s1, "BUYER_HISTORY"));
ok(dim(s1, "PREP_TIME").points === 15 && dim(s1, "PREP_TIME").reasonZh === "截标 2026-12-07，还有 21 天", "21 天 → 15", dim(s1, "PREP_TIME"));
ok(dim(s1, "PAST_WORK").points === 20 && dim(s1, "PAST_WORK").reasonZh.includes("「Roller blinds supply and installation」"), "标题相近写出项目名", dim(s1, "PAST_WORK"));
ok(s1.score === 80 && s1.noteZh === FIT_NOTE_ZH, "总分为四项之和；带说明", s1.score);
ok(s1.dimensions.map((d) => d.max).reduce((a, b) => a + b, 0) === 100, "满分 100");

// 业务匹配边界
const bm = (m: FitNotice["match"]) => dim(computeFitScore(notice({ match: m }), [], now), "BUSINESS_MATCH");
ok(bm({ productHits: ["a", "b", "c", "d", "e"] }).points === 30, "产品词封顶 30");
ok(bm({ productHits: ["a", "b", "c"], categoryHits: ["N7230"], serviceHits: ["installation"] }).points === 40, "30 + 分类 6 + 服务 4 = 40");
ok(bm({ productHits: ["a", "b", "c", "d"], categoryHits: ["N7230"], serviceHits: ["x"] }).points === 40, "封顶 40");
ok(bm({ serviceHits: ["installation"] }).points === 0, "只有服务词不加分");
ok(bm({ categoryHits: ["N7230"], serviceHits: ["installation"] }).points === 10, "分类 + 服务 = 10");
ok(bm(null).points === 0 && bm(null).reasonZh === "没有命中产品词或分类", "没有命中写明");

// 往来：交过标 / 只建过项目 / 别的采购方 / 采购方未知
const bh = (projects: ReturnType<typeof prepareFitProjects>, n: Partial<FitNotice> = {}) => dim(computeFitScore(notice(n), projects, now), "BUYER_HISTORY");
ok(bh(prepareFitProjects([proj({ tenderStatus: "lost" })])).points === 15, "交过标没中 → 15");
ok(bh(prepareFitProjects([proj({ submittedAt: new Date() })])).points === 15, "有提交时间算交过标");
ok(bh(prepareFitProjects([proj({})])).points === 5, "只建过项目 → 5");
ok(bh(prepareFitProjects([proj({ tenderStatus: "bid_submitted" })])).points === 15, "状态「已提交」算交过标（审查 L2）");
ok(bh(prepareFitProjects([proj({ clientOrganization: "Correctional Service Canada" })])).points === 0, "别的采购方 → 0");
ok(bh(prepareFitProjects([proj({ clientOrganization: "Correctional Service Canada" })])).reasonZh === "没有同一采购方的投标项目", "写明没有");
ok(bh([], { buyingInstitution: null, contractingInstitution: null }).reasonZh === "公告没有写采购方", "采购方未知写明");
ok(bh(prepareFitProjects([proj({ clientOrganization: null })]), { buyingInstitution: null, contractingInstitution: null }).points === 0, "两边都未知不算同一采购方");
ok(bh(prepareFitProjects([proj({ clientOrganization: "Ministère de la Défense nationale" })])).points === 5, "别名表认出法文写法");

// PSPC 例外
const pspcWon = prepareFitProjects([proj({ clientOrganization: "PWGSC", tenderStatus: "won" })]);
const pspc = bh(pspcWon, { buyingInstitution: null, contractingInstitution: "Public Services and Procurement Canada" });
ok(pspc.points === 5 && pspc.reasonZh.includes("PSPC（代各部门采购），往来仅供参考"), "只知道是 PSPC → 5 分并写明", pspc);
ok(noticeBuyer({ buyingInstitution: null, contractingInstitution: "PSPC" }).pspcOnly === true, "只有 PSPC 时标记");
ok(noticeBuyer({ buyingInstitution: "DND", contractingInstitution: "PSPC" }).key === "DND", "使用部门优先于采购机关");
ok(bh(pspcWon).points === 0, "公告使用部门是 DND 时，客户写 PSPC 的项目不算同一采购方");
// 审查 M1：使用部门本身写的是 PSPC，也按「只知道是 PSPC」
const pspcBuying = bh(pspcWon, { buyingInstitution: "Public Works and Government Services Canada", contractingInstitution: "PSPC" });
ok(pspcBuying.points === 5 && pspcBuying.reasonZh.includes("仅供参考"), "使用部门写 PSPC 也只给 5 分", pspcBuying);
ok(noticeBuyer({ buyingInstitution: "PWGSC", contractingInstitution: null }).pspcOnly === true, "PSPC 来自使用部门也标记");

// 业绩：只比已中标的
const pw = (projects: ReturnType<typeof prepareFitProjects>, title: string) => dim(computeFitScore(notice({ title }), projects, now), "PAST_WORK");
ok(pw(prepareFitProjects([proj({ name: "Roller blinds supply and installation", tenderStatus: "lost" })]), "Supply and installation of roller blinds").reasonZh === "没有已中标项目可比", "没中的不算业绩");
ok(pw(won, "Snow removal services").points === 0 && pw(won, "Snow removal services").reasonZh === "标题与已中标项目都不相近", "不相近写明");
const t = (a: string, b: string) => jaccard(tokenize(a), tokenize(b));
const mid = "Blinds supply for office building";
const midSim = t(mid, "Roller blinds supply and installation");
const midPts = pw(won, mid).points;
ok((midSim >= 0.3 ? midPts === 12 : midSim >= 0.15 ? midPts === 6 : midPts === 0), "相似度分档与 Jaccard 一致", { midSim, midPts });
// 审查 L4：0.5 与 0.3 两档
const tierPts = (title: string, wonName: string) => pw(prepareFitProjects([proj({ name: wonName, tenderStatus: "won" })]), title).points;
ok(t("roller blinds supply", "roller blinds supply installation") === 0.75 && tierPts("roller blinds supply", "roller blinds supply installation") === 20, "相似度 ≥ 0.5 → 20");
ok(t("roller blinds supply office building", "roller blinds window coverings") === 2 / 7 && tierPts("roller blinds supply office building", "roller blinds window coverings") === 6, "相似度 0.29（< 0.3）→ 6");
ok(t("roller blinds supply office", "roller blinds window coverings") === 2 / 6 && tierPts("roller blinds supply office", "roller blinds window coverings") === 12, "相似度 0.33（≥ 0.3）→ 12");
ok(t("roller blinds supply", "roller blinds window coverings") === 2 / 5 && tierPts("roller blinds supply", "roller blinds window coverings") === 12, "相似度 0.4（< 0.5）→ 12");
ok(t("roller blinds", "roller blinds supply installation") === 0.5 && tierPts("roller blinds", "roller blinds supply installation") === 20, "正好 0.5 → 20");
const two = prepareFitProjects([proj({ id: "a", name: "Window coverings", tenderStatus: "won" }), proj({ id: "b", name: "Roller blinds supply and installation", tenderStatus: "won" })]);
ok(pw(two, "Supply and installation of roller blinds").reasonZh.includes("Roller blinds supply"), "取最相近的那个");

// 准备时间边界（多伦多日期）
const pt = (iso: string | null) => dim(computeFitScore(notice({ closingAt: iso ? new Date(iso) : null }), [], now), "PREP_TIME");
ok(pt("2026-11-30T19:00:00Z").points === 15, "14 天 → 15");
ok(pt("2026-11-29T19:00:00Z").points === 10, "13 天 → 10");
ok(pt("2026-11-23T19:00:00Z").points === 10, "7 天 → 10");
ok(pt("2026-11-22T19:00:00Z").points === 5, "6 天 → 5");
ok(pt("2026-11-19T19:00:00Z").points === 5, "3 天 → 5");
ok(pt("2026-11-18T19:00:00Z").points === 0 && pt("2026-11-18T19:00:00Z").reasonZh.includes("时间很紧"), "2 天 → 0 并写明");
ok(pt(null).points === 5 && pt(null).reasonZh === "截标时间未知", "截标未知 → 5");
// 多伦多晚上截标：UTC 已是次日，按多伦多日期算
ok(pt("2026-11-30T04:30:00Z").reasonZh.startsWith("截标 2026-11-29"), "按多伦多日期（UTC 次日凌晨 = 多伦多前一天晚上）", pt("2026-11-30T04:30:00Z"));

// 审查 L4：旧数据 / 写坏的命中字段不抛错
ok(bm({ productHits: "blinds" as unknown as string[] }).points === 0, "命中字段不是数组按没有命中");
ok(bm({ productHits: ["blinds", 3 as unknown as string] }).points === 10, "数组里非字符串忽略");

// 审查 H1：为这条公告建的项目不算
const own = prepareFitProjects([
  proj({ id: "linked", tenderStatus: "won" }),
  proj({ id: "followed", tenderStatus: "won", sourceMetadataJson: JSON.stringify({ procurementInstrumentId: "inst-1", source: "x" }) }),
  proj({ id: "other", tenderStatus: "won", sourceMetadataJson: JSON.stringify({ procurementInstrumentId: "inst-2" }) }),
  proj({ id: "bad", sourceMetadataJson: "{not json" }),
]);
ok(JSON.stringify(projectsForNotice(own, "inst-1", ["linked"]).map((p) => p.id)) === JSON.stringify(["other", "bad"]), "去掉「本项目」关联的与由跟标建出的", projectsForNotice(own, "inst-1", ["linked"]).map((p) => p.id));
ok(own.find((p) => p.id === "bad")?.followedInstrumentId === null, "来源元数据写坏不抛错");

// 价格字段不进来
ok(!Object.keys(prepareFitProjects([proj({})])[0]).some((k) => /price|value/i.test(k)), "整理后的项目没有价格字段");

// 排序：分高在前，同分按发布日期新到旧（空在后），再按首次发现
const row = (score: number | null, publishedAt: string | null, firstSeenAt = "2026-11-10T00:00:00Z") => ({ fit: score === null ? null : { score, dimensions: [], noteZh: "" }, publishedAt, firstSeenAt });
const sorted = [row(40, "2026-11-10"), row(70, "2026-11-01"), row(40, null), row(40, "2026-11-12"), row(null, "2026-11-15"), row(40, "2026-11-12", "2026-11-13T00:00:00Z")].sort(compareByFit);
ok(JSON.stringify(sorted.map((r) => [r.fit?.score ?? null, r.publishedAt, r.firstSeenAt.slice(5, 10)])) === JSON.stringify([[70, "2026-11-01", "11-10"], [40, "2026-11-12", "11-13"], [40, "2026-11-12", "11-10"], [40, "2026-11-10", "11-10"], [40, null, "11-10"], [null, "2026-11-15", "11-10"]]), "排序比较器", sorted);

// 查询串
ok(candidatesQuery(NEW_VIEW_VALUE, FIT_SORT_VALUE) === "&view=new&sort=fit", "新标 + 按匹配度");
ok(candidatesQuery(NEW_VIEW_VALUE) === "&view=new", "默认按发布日期");
ok(candidatesQuery("CANDIDATE", FIT_SORT_VALUE) === "&triage=CANDIDATE", "别的视图不带排序");

// 接线
const views = readFileSync(join(process.cwd(), "src/lib/procurement-records/views.ts"), "utf8");
ok(/getVisibleProjectIds\(viewer\.id, viewer\.role\)/.test(views), "按看的人可见的项目");
ok(!/ourBidPrice|winningBidPrice|estimatedValue/.test(views.slice(views.indexOf("async function fitProjectsFor"), views.indexOf("export async function listCandidates"))), "算分查询不读价格");
const route = readFileSync(join(process.cwd(), "src/app/api/procurement/candidates/route.ts"), "utf8");
ok(/sort: sp\.get\("sort"\), viewer: \{ id: user\.id, role: user\.role \}/.test(route), "接口传排序与看的人（服务端身份）");
const monitor = readFileSync(join(process.cwd(), "src/components/procurement-records/procurement-monitor.tsx"), "utf8");
ok(/candidatesQuery\(triage, sort\)/.test(monitor) && /aria-label="排序"/.test(monitor), "页面有排序选择并带进查询");
ok(/sort === FIT_SORT_VALUE \? NEW_VIEW_FIT_HINT_ZH : NEW_VIEW_HINT_ZH/.test(monitor), "按匹配度排时说明文字跟着改");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
