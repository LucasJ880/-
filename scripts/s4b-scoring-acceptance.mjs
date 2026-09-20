/**
 * S4-B 供应商评分 + 找厂优先级 + 项目推荐 — 真实浏览器验收（Playwright）。
 * 前置：dev server 跑在隔离库上；已执行 scripts/s3a-fixture-seed.ts（含 s4a + s4b 夹具）。
 * 用法：S4B_BASE=http://localhost:3218 S4B_IDS=<seed json> DATABASE_URL=<隔离库> node scripts/s4b-scoring-acceptance.mjs
 * 纪律：没有 `|| true`；写操作全部 API 读回；FLOW C / I 的「厂家回复报价 / 改 live 数据」用隔离库直写模拟外部事实，
 *      并在写之前再次校验主机不是生产。「厂家 / 报价 / 证书」全是合成夹具。
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.S4B_BASE || "http://localhost:3218";
const IDS_FILE = process.env.S4B_IDS;
const PASSWORD = process.env.S4B_PASSWORD || "s3a-demo-pass";
const OUT = process.env.S4B_SHOT_DIR || ".s4b-screenshots";
const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL || DB_URL.includes("ep-super-field-antfibsl")) { console.error("DATABASE_URL 缺失或指向生产主机 — ABORT"); process.exit(2); }
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
let ids;
try { ids = JSON.parse(readFileSync(IDS_FILE, "utf8")); } catch (e) { console.error(`无法读取夹具清单 ${IDS_FILE}：${e?.message}`); process.exit(2); }
const ORG = ids.orgId; const EMAILS = ids.users; const S4A = ids.s4a; const PROJ = S4A?.projectId; const SUP_B = S4A?.supplierId;

let pass = 0, fail = 0;
function ok(cond, name, detail) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); } }
function requireFixture(v, name) { if (v === undefined || v === null || v === "") { fail++; console.log(`  ✗ [夹具缺失] ${name}`); return false; } pass++; console.log(`  ✓ [夹具就绪] ${name}`); return true; }

async function login(context, email) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email} failed ${res.status()}`);
  const body = await res.json();
  await context.addInitScript((o) => { try { localStorage.setItem("qy_active_org_id", o); } catch {} }, body.activeOrgId ?? ORG);
}
const evidenceUrl = (supplierId, extra = "") => `${BASE}/projects/intelligence/supply-chain/supplier?supplierId=${encodeURIComponent(supplierId)}&projectId=${encodeURIComponent(PROJ)}${extra}`;
async function waitWorkspace(page) { await page.waitForSelector('[data-testid="supplier-evidence-workspace"], [data-testid="workspace-fatal"]', { timeout: 120_000 }); await page.waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), { timeout: 90_000 }).catch(() => {}); }
async function openEvaluationTab(page) { await page.locator('[data-testid="tab-evaluation"]').click(); await page.waitForSelector('[data-testid="evaluation-panel"]', { timeout: 60_000 }); }
async function apiJson(ctx, path) { const r = await ctx.request.get(`${BASE}${path}`); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status(), json, text }; }
async function apiEval(ctx, runId) { return apiJson(ctx, `/api/supplier-intel/runs/${runId}/evaluation?orgId=${encodeURIComponent(ORG)}`); }
async function apiRanking(ctx) { return apiJson(ctx, `/api/supplier-intel/projects/${PROJ}/ranking?orgId=${encodeURIComponent(ORG)}`); }
async function waitEvalState(ctx, runId, pred, timeoutMs = 120_000) { const dl = Date.now() + timeoutMs; let last = null; while (Date.now() < dl) { last = await apiEval(ctx, runId); if (last.json?.view && pred(last.json.view)) return last; await new Promise((r) => setTimeout(r, 1500)); } return last; }
async function waitRunView(page, runId) { await page.locator(`[data-testid="evaluation-run"][data-run-id="${runId}"]`).waitFor({ state: "visible", timeout: 120_000 }); }
async function startEvaluation(page, offeringId) {
  await page.selectOption('[data-testid="evaluation-offering"]', offeringId);
  const before = new Set(await page.locator('[data-testid="evaluation-run-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-run-id"))));
  await page.locator('[data-testid="evaluation-start"]').click();
  await page.waitForFunction((prev) => { const rows = [...document.querySelectorAll('[data-testid="evaluation-run-row"]')].map((e) => e.getAttribute("data-run-id")); return rows.some((id) => !prev.includes(id)); }, [...before], { timeout: 120_000 });
  const rows = await page.locator('[data-testid="evaluation-run-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-run-id")));
  const runId = rows.find((id) => !before.has(id));
  // dev + 远程隔离库下评估视图一次要十几秒；视图首载失败时（如连接池抖动）采购人员会再点一次运行行——这里做同样的事
  try { await page.locator(`[data-testid="evaluation-run"][data-run-id="${runId}"]`).waitFor({ state: "visible", timeout: 60_000 }); }
  catch { await page.locator(`[data-testid="evaluation-run-row"][data-run-id="${runId}"]`).click(); await waitRunView(page, runId); }
  return runId;
}
async function applySuggestion(page, ctx, runId, key) {
  const row = page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"]`);
  await row.locator('[data-testid="apply-suggestion"]').click();
  await waitEvalState(ctx, runId, (v) => v.candidates[0].requirements.find((r) => r.entry.code === key)?.match);
  await page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"][data-evaluated-by="DETERMINISTIC"]`).waitFor({ state: "visible", timeout: 60_000 });
}
async function humanAdjudicate(page, ctx, runId, key, verdict, certId) {
  const row = page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"]`);
  await row.locator('[data-testid="open-adjudicate"]').waitFor({ state: "visible", timeout: 30_000 });
  await row.locator('[data-testid="open-adjudicate"]').click();
  await row.locator(`[data-testid="verdict-${verdict}"]`).click();
  if (certId) await row.locator(`[data-testid="evidence-cert"][data-cert-id="${certId}"]`).check();
  await row.locator('[data-testid="adjudicate-submit"]').click();
  await waitEvalState(ctx, runId, (v) => v.candidates[0].requirements.find((r) => r.entry.code === key)?.match);
}
async function computeGate(page, ctx, runId) {
  await page.locator('[data-testid="compute-gate"]').click();
  await waitEvalState(ctx, runId, (v) => v.candidates[0].mandatoryGateResult !== "PENDING");
  await page.waitForFunction((id) => { const el = document.querySelector(`[data-testid="evaluation-run"][data-run-id="${id}"]`); return el && el.getAttribute("data-gate-result") !== "PENDING"; }, runId, { timeout: 60_000 });
}
async function completeRun(page, ctx, runId) {
  await page.locator('[data-testid="complete-evaluation"]').click();
  const done = await waitEvalState(ctx, runId, (v) => v.run.status === "COMPLETED");
  await page.waitForFunction((id) => document.querySelector(`[data-testid="evaluation-run"][data-run-id="${id}"]`)?.getAttribute("data-run-status") === "COMPLETED", runId, { timeout: 60_000 });
  return done;
}
/** 全流程：开始评估 → R-001 人工 PASS（证书）→ R-002 规则 → R-003 人工 PASS → 算门 → 完成并评分 */
async function evaluateFull(page, ctx, offeringId, certId, opts = {}) {
  const runId = await startEvaluation(page, offeringId);
  await humanAdjudicate(page, ctx, runId, "R-001", "PASS", certId);
  await applySuggestion(page, ctx, runId, "R-002");
  if (!opts.skipR003) await humanAdjudicate(page, ctx, runId, "R-003", "PASS", certId);
  await computeGate(page, ctx, runId);
  const done = await completeRun(page, ctx, runId);
  return { runId, view: done.json.view };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n== 夹具门 ==");
  requireFixture(ORG, "orgId"); requireFixture(EMAILS?.buyer, "采购员"); requireFixture(EMAILS?.viewer, "只读成员");
  for (const k of ["projectId", "supplierId", "offeringAId", "certBifmaAId", "socialSignalId", "s4bSupplier1688Id", "s4bOffering1688Id", "s4bSignal1688Id", "s4bCert1688Id", "s4bSupplierCheapId", "s4bOfferingCheapId", "s4bCertCheapId", "s4bSupplierFullId", "s4bOfferingFullId", "s4bCertFullId", "s4bRound1Id"]) requireFixture(S4A?.[k], `s4a.${k}`);
  if (fail > 0) { console.log(`\n夹具不完整，终止：${pass} 通过 / ${fail} 失败`); process.exit(1); }
  const host = new URL(DB_URL.replace(/^postgres(ql)?:/, "http:")).hostname;
  ok(!host.startsWith("ep-super-field-antfibsl") && host.startsWith("ep-"), `隔离库主机守卫：${host}`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, EMAILS.buyer);
    const page = await ctx.newPage();

    console.log("\n== FLOW A：1688 线索 → 找厂优先级 P1/P2/P3 + 明确「不代表 Tender 合格」==");
    await page.goto(`${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(PROJ)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "供应商线索" }).click();
    const row1688 = page.locator(`[data-testid="signal-row"][data-signal-id="${S4A.s4bSignal1688Id}"]`);
    await row1688.waitFor({ state: "visible", timeout: 90_000 });
    ok((await row1688.innerText()).includes("1688 / 国内采购平台"), "A1：ONE688 线索标「1688 / 国内采购平台」");
    const badge = row1688.locator('[data-testid="discovery-priority"]');
    ok((await badge.count()) === 1 && (await badge.getAttribute("data-bucket")) === "P1", "A2：1688 高相关 + 厂家 / OEM → 找厂优先级 P1", await badge.getAttribute("data-bucket"));
    ok((await page.locator('[data-testid="discovery-priority-disclaimer"]').innerText()).includes("不代表供应商符合本 Tender"), "A3：列表明说「不代表供应商符合本 Tender」");
    const rowCheap = page.locator(`[data-testid="signal-row"][data-signal-id="${S4A.s4bSignalCheapId}"]`);
    ok((await rowCheap.locator('[data-testid="discovery-priority"]').getAttribute("data-bucket")) === "P3", "A4：低信息线索 P3（平台不等于优先级）", await rowCheap.locator('[data-testid="discovery-priority"]').getAttribute("data-bucket"));
    await row1688.click();
    await page.waitForSelector('[data-testid="discovery-priority-box"]', { timeout: 30_000 });
    const boxText = await page.locator('[data-testid="discovery-priority-box"]').innerText();
    ok(boxText.includes("P1 — 优先查看") && boxText.includes("不是已核验能力") && boxText.includes("不是可靠性"), "A5：抽屉解释命中原因，并区分「文本命中 ≠ 核验」「可操作性 ≠ 可靠性」");
    // 页面**必须**写「不代表已认证 / 不代表本标合规」这类否定句；断言抓的是把这些词当陈述用，先剥掉已知否定形式
    const stripNegated = (t) => t.replace(/不代表已认证|不代表本标合规|不代表已合格|不是已核验|≠ 已核验/g, "");
    const mainA = stripNegated(await page.innerText("main"));
    ok(!/推荐供应商|已合格|已认证/.test(mainA), "A6：线索页不把「推荐供应商 / 已合格 / 已认证」当陈述使用（否定句除外）", (mainA.match(/推荐供应商|已合格|已认证/) ?? [])[0]);
    await page.screenshot({ path: `${OUT}/flow-a-priority.png` });
    await page.keyboard.press("Escape");

    console.log("\n== FLOW H：便宜但 mandatory FAIL → NOT_ELIGIBLE，无正式评分 ==");
    await page.goto(evidenceUrl(S4A.s4bSupplierCheapId), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await openEvaluationTab(page);
    const runH = await startEvaluation(page, S4A.s4bOfferingCheapId);
    await humanAdjudicate(page, ctx, runH, "R-001", "PASS", S4A.s4bCertCheapId);
    await applySuggestion(page, ctx, runH, "R-002");
    await computeGate(page, ctx, runH);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("强制项：不通过"), "H1：250 lb < 300 lb → 强制项不通过");
    const doneH = await completeRun(page, ctx, runH);
    const cH = doneH.json.view.candidates[0];
    ok(cH.recommendation === "NOT_ELIGIBLE" && cH.scores.total === null && cH.scores.commercial === null, "H2：NOT_ELIGIBLE，评分列全 null（最低正式价 90000 也救不了）");
    ok((await page.locator('[data-testid="supplier-score-box"]').getAttribute("data-score-state")) === "NOT_SCORED" && (await page.locator('[data-testid="score-not-computed"]').innerText()).includes("不计算正式评分"), "H3：界面「强制项不通过：不计算正式评分」");
    await page.screenshot({ path: `${OUT}/flow-h-gate-fail.png` });

    console.log("\n== FLOW B / E：1688 便宜挂牌价 + 门 PASS + 无 RFQ → Commercial 待确认；新供应商 → Reliability 待验证 → 总分 null → NEEDS_VERIFICATION ==");
    await page.goto(evidenceUrl(S4A.s4bSupplier1688Id), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await openEvaluationTab(page);
    const { runId: runB, view: vB } = await evaluateFull(page, ctx, S4A.s4bOffering1688Id, S4A.s4bCert1688Id);
    const cB = vB.candidates[0];
    ok(cB.mandatoryGateResult === "PASS" && cB.recommendation === "NEEDS_VERIFICATION" && cB.scores.total === null, "B1：门 PASS 但 NEEDS_VERIFICATION，总分 null");
    ok(cB.scoreBreakdown?.commercial?.priceEvidenceTier === "PLATFORM_LISTED" && cB.scores.commercial === null, "B2：商务 = PLATFORM_LISTED → 待确认（不进正式评分）");
    ok((await page.locator('[data-testid="price-evidence-box"]').getAttribute("data-tier")) === "PLATFORM_LISTED" && (await page.locator('[data-testid="price-evidence-tier"]').innerText()).includes("平台挂牌价 / 待询价确认"), "B3：界面「平台挂牌价 / 待询价确认」");
    ok((await page.locator('[data-testid="listed-price"]').innerText()).includes("1688 平台挂牌价") && (await page.locator('[data-testid="listed-price"]').innerText()).includes("不进入正式 Commercial Score"), "B4：1688 挂牌价 ¥80 明示不进入正式 Commercial Score");
    const compC = page.locator('[data-testid="score-component"][data-component="commercial"]');
    ok((await compC.innerText()).includes("待核实") && !/\b0 \/ 100/.test(await compC.innerText()), "B5：未知维度显示「待核实」，不用 0 伪装");
    ok((await page.locator('[data-testid="score-component"][data-component="reliability"]').innerText()).includes("待核实"), "E1：新供应商 → 履约可靠性待核实");
    ok((await page.locator('[data-testid="score-total-value"]').innerText()).includes("待核实"), "E2：总分待核实（不给正式总分）");
    ok((await page.locator('[data-testid="score-reasons"]').innerText()).includes("平台挂牌价") && (await page.locator('[data-testid="score-reasons"]').innerText()).includes("历史不足"), "B6/E3：原因用中文说明");
    const mainB = await page.innerText("main");
    ok(!/PRIMARY|BACKUP/.test(mainB), "B7：评估页不出现 PRIMARY / BACKUP（当前推荐在项目级）");
    await page.screenshot({ path: `${OUT}/flow-b-1688-listing.png` });

    console.log("\n== FLOW D / F：历史供应商 B（正式 RFQ + VERIFIED 出口）→ 技术 40 分维度可解释；进口准备度出现 ==");
    await page.goto(evidenceUrl(SUP_B), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await openEvaluationTab(page);
    const { runId: runD, view: vD } = await evaluateFull(page, ctx, S4A.offeringAId, S4A.certBifmaAId);
    const cD = vD.candidates[0];
    ok(cD.scores.technical === 100 && cD.scores.commercial !== null && cD.scores.reliability !== null && cD.scores.importRisk !== null && cD.scores.total !== null, "D1/F1：四维齐全，总分存在", JSON.stringify(cD.scores));
    ok((await page.locator('[data-testid="supplier-score-box"]').getAttribute("data-score-state")) === "COMPLETE", "D2：评分框 COMPLETE");
    // 分解在 <details> 里：先展开再读（折叠内容的 innerText 为空）
    await page.locator('[data-testid="supplier-score-box"] details summary').first().click();
    await page.locator('[data-testid="technical-breakdown"]').waitFor({ state: "visible", timeout: 10_000 });
    const tb = await page.locator('[data-testid="technical-breakdown"]').innerText();
    ok(tb.includes("R-001") && tb.includes("R-002") && tb.includes("100 分") && tb.includes("规则判断"), "D3：技术分解逐条可解释（含谁判的）");
    ok((await page.locator('[data-testid="score-table"]').innerText()).includes("× 40%") && (await page.locator('[data-testid="score-table"]').innerText()).includes("× 15%"), "D4：权重 40/25/20/15 可见");
    ok((await page.locator('[data-testid="import-detail"]').innerText()).includes("CANADA_EXPORT") && cD.scores.importRisk === 100, "F2：进口与交付准备度依据显示已核验 CANADA_EXPORT，分 100");
    ok((await page.locator('[data-testid="price-evidence-tier"]').innerText()).includes("正式报价") && (await page.locator('[data-testid="price-evidence-box"]').innerText()).includes("Project Inquiry Round 1"), "D5：正式报价 · 来源 Project Inquiry Round 1");
    ok(cD.recommendation === null, "D6：四维齐全且无重大风险 → 候选不写 PRIMARY（由项目级派生）");
    await page.screenshot({ path: `${OUT}/flow-d-score.png` });

    console.log("\n== FLOW G 前置：第二家四维齐全（FULL）==");
    await page.goto(evidenceUrl(S4A.s4bSupplierFullId), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await openEvaluationTab(page);
    const { view: vF } = await evaluateFull(page, ctx, S4A.s4bOfferingFullId, S4A.s4bCertFullId);
    const cF = vF.candidates[0];
    ok(cF.scores.total !== null || cF.recommendation === "HIGH_RISK", "G0：FULL 四维齐全（或按契约 HIGH_RISK）", JSON.stringify(cF.scores));

    console.log("\n== FLOW G：当前排名 → PRIMARY / BACKUP，排名原因可见；P1 ≠ PRIMARY ==");
    await page.goto(`${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(PROJ)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "供应商赛马" }).click();
    await page.waitForSelector('[data-testid="ranking-sections"]', { timeout: 90_000 });
    ok((await page.locator('[data-testid="ranking-disclaimer"]').innerText()).includes("历史评估记录本身不会被改写"), "G1：明说「动态计算；历史记录不改写」");
    const rk = await apiRanking(ctx);
    const primary = rk.json.view.sections.PRIMARY; const backup = rk.json.view.sections.BACKUP;
    ok(rk.status === 200 && primary.length === 1 && [SUP_B, S4A.s4bSupplierFullId].includes(primary[0].supplierId), "G2：恰好一家 PRIMARY（B 或 FULL）", JSON.stringify(primary.map((p) => p.supplierId)));
    ok(primary.length + backup.length + rk.json.view.sections.HIGH_RISK.length >= 2 && primary[0].rank === 1, "G3：至少两家四维齐全参与；#1 = PRIMARY");
    if (backup.length) ok(backup[0].rank === 2, "G4：BACKUP 显示 #2");
    const primaryRow = page.locator(`[data-testid="ranking-section"][data-section="PRIMARY"] [data-testid="ranking-row"]`);
    ok((await primaryRow.count()) === 1 && (await primaryRow.locator('[data-testid="ranking-rank"]').innerText()) === "#1", "G5：界面 PRIMARY 区恰好一行 #1");
    ok((await primaryRow.locator('[data-testid="ranking-reason"]').innerText()).includes("排名依据"), "G6：排名原因可见");
    const nv = rk.json.view.sections.NEEDS_VERIFICATION; const ne = rk.json.view.sections.NOT_ELIGIBLE;
    ok(nv.some((r) => r.supplierId === S4A.s4bSupplier1688Id) && ne.some((r) => r.supplierId === S4A.s4bSupplierCheapId), "G7：1688 在 NEEDS VERIFICATION、便宜不合规在 NOT ELIGIBLE");
    const racing1688 = page.locator(`[data-testid="racing-row"][data-supplier-id="${S4A.s4bSupplier1688Id}"]`);
    ok((await racing1688.getAttribute("data-bucket")) === "P1" && (await racing1688.getAttribute("data-section")) === "NEEDS_VERIFICATION" && (await racing1688.locator('[data-testid="racing-rank"]').innerText()).includes("待核实"), "G8：赛马表：1688 找厂优先级 P1，但 Current Rank = 待核实（P1 ≠ PRIMARY）");
    ok((await racing1688.locator('[data-testid="racing-next-action"]').innerText()).includes("向厂家正式询价"), "G9：下一步动作 = 向厂家正式询价");
    ok((await racing1688.locator('[data-testid="racing-rfq"]').innerText()).includes("待询价"), "G10：RFQ 列 = 待询价");
    const mainG = await page.innerText("main");
    ok(!/自动发送|自动询价|已发送邮件/.test(mainG), "G11：无自动询价 / 发消息");
    await page.screenshot({ path: `${OUT}/flow-g-ranking.png` });

    console.log("\n== FLOW C：1688 厂家正式回复 RFQ（隔离库直写模拟）→ 新评估才有 Commercial；旧评估不漂移 ==");
    const oldB = (await apiEval(ctx, runB)).json.view.candidates[0];
    await db.inquiryItem.create({ data: { inquiryId: S4A.s4bRound1Id, supplierId: S4A.s4bSupplier1688Id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: 80000, currency: "CAD", deliveryDays: 35, validUntil: new Date("2026-12-31"), createdById: (await db.user.findFirstOrThrow({ where: { email: EMAILS.buyer } })).id } });
    const oldB2 = (await apiEval(ctx, runB)).json.view.candidates[0];
    ok(JSON.stringify(oldB.scores) === JSON.stringify(oldB2.scores) && oldB2.recommendation === "NEEDS_VERIFICATION" && oldB2.scoreBreakdown.commercial.priceEvidenceTier === "PLATFORM_LISTED", "C1 / I0：旧评估不因新报价漂移");
    await page.goto(evidenceUrl(S4A.s4bSupplier1688Id), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await openEvaluationTab(page);
    const { view: vC } = await evaluateFull(page, ctx, S4A.s4bOffering1688Id, S4A.s4bCert1688Id);
    const cC = vC.candidates[0];
    ok(cC.scoreBreakdown.commercial.priceEvidenceTier === "RFQ_CONFIRMED" && cC.scores.commercial !== null && cC.scoreBreakdown.commercial.sub.price === 100, "C2：新评估 RFQ_CONFIRMED，最低正式价 → 价格分 100", JSON.stringify(cC.scoreBreakdown.commercial.sub));
    ok((await page.locator('[data-testid="price-evidence-tier"]').innerText()).includes("正式报价") && (await page.locator('[data-testid="listed-price"]').innerText()).includes("正式报价覆盖挂牌价"), "C3：界面「正式报价 · 来源 Round 1」，挂牌证据保留并注明被覆盖");
    ok(cC.recommendation === "NEEDS_VERIFICATION" && cC.scores.total === null, "C4：仍缺可靠性 / 出口核验 → 仍 NEEDS_VERIFICATION（最低价也不 PRIMARY）");
    const rk2 = await apiRanking(ctx);
    ok(!rk2.json.view.ranked.some((r) => r.supplierId === S4A.s4bSupplier1688Id && r.rank !== null), "C5：1688 仍无名次");
    await page.screenshot({ path: `${OUT}/flow-c-rfq-upgrade.png` });

    console.log("\n== FLOW I：完成评分后改报价 / 能力，旧 Run 不变；新 Run 反映新数据 ==");
    const frozen = (await apiEval(ctx, runD)).json.view.candidates[0];
    await db.inquiryItem.updateMany({ where: { inquiryId: S4A.s4bRound1Id, supplierId: S4A.s4bSupplierCheapId }, data: { totalPrice: 10 } });
    await db.supplierCapabilitySignal.updateMany({ where: { discoverySignalId: S4A.socialSignalId, type: "CANADA_EXPORT" }, data: { evidenceStatus: "CLAIMED" } });
    const after = (await apiEval(ctx, runD)).json.view.candidates[0];
    ok(JSON.stringify(frozen.scores) === JSON.stringify(after.scores) && JSON.stringify(frozen.scoreBreakdown) === JSON.stringify(after.scoreBreakdown), "I1：报价 / 能力变了，B 历史评估评分与快照一字不变");
    await page.goto(evidenceUrl(SUP_B, `&evaluationRunId=${runD}`), { waitUntil: "domcontentloaded" }); await waitWorkspace(page); await waitRunView(page, runD);
    ok((await page.locator('[data-testid="supplier-score-box"]').getAttribute("data-official-total")) === String(frozen.scores.total), "I2：历史界面显示冻结总分");
    const { view: vI } = await evaluateFull(page, ctx, S4A.offeringAId, S4A.certBifmaAId);
    const cI = vI.candidates[0];
    ok(cI.scores.importRisk !== frozen.scores.importRisk || cI.scores.commercial !== frozen.scores.commercial, "I3：新评估反映新数据（出口回到 CLAIMED / 竞价变化）", JSON.stringify({ old: frozen.scores, new: cI.scores }));
    await page.screenshot({ path: `${OUT}/flow-i-immutability.png` });

    console.log("\n== 只读成员：能看排名，不能收口 ==");
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await login(vctx, EMAILS.viewer);
    const vr = await vctx.request.get(`${BASE}/api/supplier-intel/projects/${PROJ}/ranking?orgId=${encodeURIComponent(ORG)}`);
    ok(vr.status() === 200, "V1：只读成员 GET ranking 200", `实际 ${vr.status()}`);
    const vc = await vctx.request.post(`${BASE}/api/supplier-intel/runs/${runD}/complete?orgId=${encodeURIComponent(ORG)}`, { data: {} });
    ok(vc.status() === 403 || vc.status() === 409, "V2：只读成员不能收口 / 评分", `实际 ${vc.status()}`);
    await vctx.close();

    console.log("\n== 三个视口（赛马页）==");
    await page.goto(`${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(PROJ)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "供应商赛马" }).click();
    await page.waitForSelector('[data-testid="ranking-sections"]', { timeout: 90_000 });
    for (const vp of [{ name: "desktop-1440x900", width: 1440, height: 900 }, { name: "laptop-1024x768", width: 1024, height: 768 }, { name: "mobile-390x844", width: 390, height: 844 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForFunction(() => document.readyState === "complete");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      ok(!overflow, `VP-${vp.name}：页面无横向溢出（赛马表自身可横滚）`);
      await page.screenshot({ path: `${OUT}/vp-${vp.name}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await ctx.close();
  } finally {
    await browser.close(); await db.$disconnect();
  }
  console.log(`\nS4-B 浏览器验收：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await db.$disconnect().catch(() => {}); process.exit(1); });
