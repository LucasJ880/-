/**
 * S4-A 项目匹配 + 强制项硬门 — 真实浏览器验收（Playwright）。
 * 前置：dev server 跑在隔离库上；已执行 scripts/s3a-fixture-seed.ts（含 s3b + s4a 夹具）。
 * 用法：S4A_BASE=http://localhost:3213 S4A_IDS=<seed json> S4A_PASSWORD=... node scripts/s4a-evaluation-acceptance.mjs
 * 纪律：没有 `|| true`；写操作全部 API 读回；「厂家 / 证书」全是合成夹具。
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.S4A_BASE || "http://localhost:3213";
const IDS_FILE = process.env.S4A_IDS;
const PASSWORD = process.env.S4A_PASSWORD || "s3a-demo-pass";
const OUT = process.env.S4A_SHOT_DIR || ".s4a-screenshots";
let ids;
try { ids = JSON.parse(readFileSync(IDS_FILE, "utf8")); } catch (e) { console.error(`无法读取夹具清单 ${IDS_FILE}：${e?.message}`); process.exit(2); }
const ORG = ids.orgId; const EMAILS = ids.users; const S4A = ids.s4a; const PROJ = S4A?.projectId; const SUP = S4A?.supplierId;

let pass = 0, fail = 0;
function ok(cond, name, detail) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); } }
function requireFixture(v, name) { if (v === undefined || v === null || v === "") { fail++; console.log(`  ✗ [夹具缺失] ${name}`); return false; } pass++; console.log(`  ✓ [夹具就绪] ${name}`); return true; }
const FORBIDDEN = /\/100|排名|推荐指数|合格率|PRIMARY|BACKUP|HIGH_RISK|系统已确认/;
/** 页面**必须**写「这不是最终供应商排名」这类否定句；断言抓的是把排名 / 分数当陈述用，先剥掉已知否定形式 */
function stripNegated(t) { return t.replace(/这不是最终供应商排名|不是最终排名|不是排名|不是评分|不是合规判定/g, ""); }

async function login(context, email) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email} failed ${res.status()}`);
  const body = await res.json();
  await context.addInitScript((o) => { try { localStorage.setItem("qy_active_org_id", o); } catch {} }, body.activeOrgId ?? ORG);
}
const evidenceUrl = (extra = "") => `${BASE}/projects/intelligence/supply-chain/supplier?supplierId=${encodeURIComponent(SUP)}&projectId=${encodeURIComponent(PROJ)}${extra}`;
async function waitWorkspace(page) { await page.waitForSelector('[data-testid="supplier-evidence-workspace"], [data-testid="workspace-fatal"]', { timeout: 120_000 }); await page.waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), { timeout: 90_000 }).catch(() => {}); }
async function openEvaluationTab(page) { await page.locator('[data-testid="tab-evaluation"]').click(); await page.waitForSelector('[data-testid="evaluation-panel"]', { timeout: 60_000 }); }
async function apiJson(ctx, path) { const r = await ctx.request.get(`${BASE}${path}`); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status(), json, text }; }
async function apiEval(ctx, runId) { return apiJson(ctx, `/api/supplier-intel/runs/${runId}/evaluation?orgId=${encodeURIComponent(ORG)}`); }
async function waitEvalState(ctx, runId, pred, timeoutMs = 90_000) { const dl = Date.now() + timeoutMs; let last = null; while (Date.now() < dl) { last = await apiEval(ctx, runId); if (last.json?.view && pred(last.json.view)) return last; await new Promise((r) => setTimeout(r, 1500)); } return last; }
async function waitRunView(page, runId) { await page.locator(`[data-testid="evaluation-run"][data-run-id="${runId}"]`).waitFor({ state: "visible", timeout: 90_000 }); }
async function startEvaluation(page, ctx, offeringId) {
  await page.selectOption('[data-testid="evaluation-offering"]', offeringId);
  const before = new Set(await page.locator('[data-testid="evaluation-run-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-run-id"))));
  await page.locator('[data-testid="evaluation-start"]').click();
  await page.waitForFunction((prev) => { const rows = [...document.querySelectorAll('[data-testid="evaluation-run-row"]')].map((e) => e.getAttribute("data-run-id")); return rows.some((id) => !prev.includes(id)); }, [...before], { timeout: 90_000 });
  const rows = await page.locator('[data-testid="evaluation-run-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-run-id")));
  const runId = rows.find((id) => !before.has(id));
  await waitRunView(page, runId);
  return runId;
}
async function applySuggestion(page, ctx, runId, key) {
  const row = page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"]`);
  await row.locator('[data-testid="apply-suggestion"]').click();
  await waitEvalState(ctx, runId, (v) => v.candidates[0].requirements.find((r) => r.entry.code === key)?.match);
  await page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"][data-evaluated-by="DETERMINISTIC"]`).waitFor({ state: "visible", timeout: 60_000 });
}
async function humanAdjudicate(page, ctx, runId, key, verdict, pickEvidence) {
  const row = page.locator(`[data-testid="requirement-row"][data-requirement-key="${key}"]`);
  const openBtn = row.locator('[data-testid="open-adjudicate"]');
  await openBtn.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  if ((await openBtn.count()) === 0) {
    // 不只报 timeout：把服务端此刻的 status / canWrite / 该键是否已有 Match 一起报出来
    const ev = await apiEval(ctx, runId);
    const v = ev.json?.view; const m = v?.candidates?.[0]?.requirements?.find((r) => r.entry.code === key)?.match;
    throw new Error(`「人工判定」按钮缺失（${key}）：api=${ev.status} status=${v?.run?.status} canWrite=${v?.canWrite} match=${m ? m.verdict + "/" + m.evaluatedBy : "none"}`);
  }
  await openBtn.click();
  await row.locator(`[data-testid="verdict-${verdict}"]`).click();
  if (pickEvidence) await pickEvidence(row);
  await row.locator('[data-testid="adjudicate-submit"]').click();
}
async function computeGate(page, ctx, runId) {
  await page.locator('[data-testid="compute-gate"]').click();
  await waitEvalState(ctx, runId, (v) => v.candidates[0].mandatoryGateResult !== "PENDING");
  await page.waitForFunction((id) => { const el = document.querySelector(`[data-testid="evaluation-run"][data-run-id="${id}"]`); return el && el.getAttribute("data-gate-result") !== "PENDING"; }, runId, { timeout: 60_000 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n== 夹具门 ==");
  requireFixture(ORG, "orgId"); requireFixture(EMAILS?.buyer, "采购员"); requireFixture(EMAILS?.viewer, "只读成员"); requireFixture(EMAILS?.outsider, "无项目权限成员");
  for (const k of ["projectId", "supplierId", "offeringAId", "offeringBId", "certBifmaAId", "certBifmaClaimedId", "certUlExpiredId", "certBifmaFutureAId", "socialSignalId", "archiveItemId"]) requireFixture(S4A?.[k], `s4a.${k}`);
  if (fail > 0) { console.log(`\n夹具不完整，终止：${pass} 通过 / ${fail} 失败`); process.exit(1); }

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, EMAILS.buyer);
    const page = await ctx.newPage();

    console.log("\n== FLOW A：Tender → 国内采购 → 已关联供应商 → 证据页 → 项目匹配 → 选产品 → 开始评估 ==");
    await page.goto(`${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(PROJ)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "供应商线索" }).click();
    const row = page.locator(`[data-testid="signal-row"][data-signal-id="${S4A.socialSignalId}"]`);
    await row.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
    ok((await row.count()) === 1, "A1：已关联线索可见");
    await row.click();
    await page.waitForSelector('[data-testid="view-supplier-evidence"]', { timeout: 30_000 });
    await page.locator('[data-testid="view-supplier-evidence"]').click();
    await page.waitForURL(/supply-chain\/supplier/, { timeout: 60_000 });
    await waitWorkspace(page);
    ok((await page.locator('[data-testid="tab-evaluation"]').count()) === 1, "A2：有项目上下文时出现「项目匹配」页签");
    await openEvaluationTab(page);
    ok((await page.locator('[data-testid="evaluation-disclaimer"]').innerText()).includes("这不是最终供应商排名"), "A3：顶部明说不是最终排名");
    const runA = await startEvaluation(page, ctx, S4A.offeringAId);
    ok(Boolean(runA), "A4：创建评估运行并显示", runA ?? "null");
    const evA = await apiEval(ctx, runA);
    ok(evA.json?.view?.run?.runMode === "EVALUATION_ONLY" && evA.json.view.run.status === "RUNNING", "A5：服务端 runMode=EVALUATION_ONLY 且 RUNNING");
    ok(evA.json?.view?.candidates?.[0]?.offering?.id === S4A.offeringAId, "A6：候选绑定所选产品（供应商 ≠ 产品）");
    ok((await page.locator('[data-testid="evaluation-status"]').innerText()).includes("评估进行中"), "A7：状态文案「评估进行中」");
    ok((await page.locator('[data-testid="requirement-row"]').count()) === 3, "A8：逐条要求齐全（3 条）");
    const r1 = page.locator('[data-testid="requirement-row"][data-requirement-key="R-001"]');
    ok((await r1.locator('[data-testid="requirement-mandatory"]').innerText()) === "强制要求", "A9：强制状态标签");
    ok((await r1.locator('[data-testid="requirement-text-en"]').innerText()).includes("BIFMA"), "A10：英文原文");
    ok((await r1.locator('[data-testid="requirement-text-zh"]').count()) === 1, "A11：中文说明");
    ok((await page.locator('[data-testid="requirement-row"][data-requirement-key="R-003"] [data-testid="requirement-mandatory"]').innerText()) === "非强制要求", "A12：非强制项标签（不写 optional）");
    await page.screenshot({ path: `${OUT}/flow-a-start.png` });

    console.log("\n== FLOW G/B：VERIFIED + scope + 有效 可支撑 → 全部 mandatory PASS → 强制项已通过 ==");
    ok((await r1.locator('[data-testid="requirement-suggestion"]').getAttribute("data-suggestion-verdict")) === "PASS", "G1：R-001 规则建议 PASS（BIFMA VERIFIED，产品 A）");
    await applySuggestion(page, ctx, runA, "R-001");
    await applySuggestion(page, ctx, runA, "R-002");
    ok((await page.locator('[data-testid="requirement-row"][data-requirement-key="R-002"] [data-testid="requirement-evaluated-by"]').innerText()).includes("规则判断"), "G2：显示「规则判断」（不是「系统已确认」）");
    await computeGate(page, ctx, runA);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("强制项：已通过"), "B1：强制项：已通过");
    ok((await page.locator('[data-testid="gate-recommendation"]').count()) === 0, "B2：PASS 不显示任何推荐（不提前 PRIMARY/BACKUP）");
    const mainText = await page.innerText("main");
    ok(!FORBIDDEN.test(stripNegated(mainText)), "B3：页面不把分数 / 排名 / PRIMARY / BACKUP / HIGH_RISK 当陈述使用（否定句除外）", (stripNegated(mainText).match(FORBIDDEN) ?? [])[0]);
    await page.locator('[data-testid="complete-evaluation"]').click();
    const doneA = await waitEvalState(ctx, runA, (v) => v.run.status === "COMPLETED");
    ok(doneA.json?.view?.run?.status === "COMPLETED", "B4：完成评估 → COMPLETED");
    const candA = doneA.json.view.candidates[0];
    ok(candA.mandatoryGateResult === "PASS" && candA.recommendation === null && candA.rejectionReason === null, "B5：服务端门 PASS、推荐 null");
    ok(Object.values(candA.scores).every((v) => v === null), "B6：评分字段全部 null");
    ok(candA.originSource === "NEW_DISCOVERY", "B7：originSource 服务端推导（已关联线索）");
    await page.screenshot({ path: `${OUT}/flow-b-pass.png` });

    console.log("\n== FLOW C：一个 mandatory FAIL → 强制项不通过 → 不可进入推荐候选 ==");
    const runC = await startEvaluation(page, ctx, S4A.offeringBId);
    const r2c = page.locator(`[data-testid="evaluation-run"][data-run-id="${runC}"] [data-testid="requirement-row"][data-requirement-key="R-002"]`);
    ok((await r2c.locator('[data-testid="requirement-suggestion"]').getAttribute("data-suggestion-verdict")) === "FAIL", "C1：250 lb < 300 lb 规则建议 FAIL");
    await applySuggestion(page, ctx, runC, "R-002");
    await applySuggestion(page, ctx, runC, "R-001");
    ok((await page.locator('[data-testid="requirement-row"][data-requirement-key="R-001"]').getAttribute("data-verdict")) === "UNKNOWN", "C2：产品 A 的证书对产品 B 不可用 → 规则判 UNKNOWN");
    await computeGate(page, ctx, runC);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("强制项：不通过"), "C3：强制项：不通过");
    ok((await page.locator('[data-testid="gate-recommendation"]').innerText()).includes("不可进入推荐候选"), "C4：NOT_ELIGIBLE 文案");
    const evC = await apiEval(ctx, runC);
    ok(evC.json.view.candidates[0].recommendation === "NOT_ELIGIBLE" && evC.json.view.candidates[0].rejectionReason === "R-002:MANDATORY_MATCH_FAIL", "C5：服务端 NOT_ELIGIBLE + 确定性 rejectionReason");
    ok(evC.json.view.candidates[0].offeringSnapshot?.unitPrice === "50", "C6：这是最低价候选——价格绕不过硬门");
    await page.screenshot({ path: `${OUT}/flow-c-fail.png` });

    console.log("\n== FLOW D：一个 UNKNOWN → 资料不足 → 待核实 ==");
    const runD = await startEvaluation(page, ctx, S4A.offeringAId);
    await humanAdjudicate(page, ctx, runD, "R-001", "UNKNOWN", null);
    await waitEvalState(ctx, runD, (v) => v.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match);
    await applySuggestion(page, ctx, runD, "R-002");
    await computeGate(page, ctx, runD);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("资料不足"), "D1：强制项：资料不足 / 待核实");
    ok((await page.locator('[data-testid="gate-recommendation"]').innerText()).includes("待核实"), "D2：NEEDS_VERIFICATION 文案");
    const evD = await apiEval(ctx, runD);
    ok(evD.json.view.candidates[0].mandatoryGateResult === "INCOMPLETE" && evD.json.view.candidates[0].recommendation === "NEEDS_VERIFICATION", "D3：服务端 INCOMPLETE + NEEDS_VERIFICATION");
    ok((await page.locator('[data-testid="requirement-row"][data-requirement-key="R-001"] [data-testid="requirement-evaluated-by"]').innerText()).includes("人工确认"), "D4：显示「人工确认」");

    console.log("\n== FLOW E：社媒自述作为「满足」证据 → 不能过硬门 ==");
    const runE = await startEvaluation(page, ctx, S4A.offeringAId);
    await humanAdjudicate(page, ctx, runE, "R-001", "PASS", async (row) => { await row.locator(`[data-testid="evidence-signal"][data-signal-id="${S4A.socialSignalId}"]`).check(); });
    await waitEvalState(ctx, runE, (v) => v.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match);
    await applySuggestion(page, ctx, runE, "R-002");
    await computeGate(page, ctx, runE);
    const gateE = page.locator('[data-testid="gate-item"][data-requirement-key="R-001"]');
    ok((await gateE.getAttribute("data-reason")) === "EVIDENCE_NOT_VERIFIED", "E1：硬门原因 EVIDENCE_NOT_VERIFIED", await gateE.getAttribute("data-reason"));
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("资料不足"), "E2：整体 INCOMPLETE（社媒自述不算）");
    ok((await gateE.innerText()).includes("社媒"), "E3：原因用中文说明");

    console.log("\n== FLOW F：CLAIMED 证书作为「满足」证据 → 不能过硬门 ==");
    const runF = await startEvaluation(page, ctx, S4A.offeringAId);
    await humanAdjudicate(page, ctx, runF, "R-001", "PASS", async (row) => { await row.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaClaimedId}"]`).check(); });
    await waitEvalState(ctx, runF, (v) => v.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match);
    await applySuggestion(page, ctx, runF, "R-002");
    await computeGate(page, ctx, runF);
    ok((await page.locator('[data-testid="gate-item"][data-requirement-key="R-001"]').getAttribute("data-reason")) === "CERT_NOT_VERIFIED", "F1：硬门原因 CERT_NOT_VERIFIED");
    ok((await page.locator('[data-testid="evaluation-run"]').getAttribute("data-recommendation")) === "NEEDS_VERIFICATION", "F2：NEEDS_VERIFICATION");
    await page.screenshot({ path: `${OUT}/flow-f-claimed.png` });

    console.log("\n== FLOW H：错产品的证书 → 写入即拒 ==");
    const runH = await startEvaluation(page, ctx, S4A.offeringBId);
    const rowH = page.locator(`[data-testid="evaluation-run"][data-run-id="${runH}"] [data-testid="requirement-row"][data-requirement-key="R-001"]`);
    await rowH.locator('[data-testid="open-adjudicate"]').click();
    await rowH.locator('[data-testid="verdict-PASS"]').click();
    const certLabel = await rowH.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaAId}"]`).locator("xpath=..").innerText();
    ok(certLabel.includes("对应其它产品，不可采信"), "H1：选择器标注该证书对应其它产品");
    await rowH.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaAId}"]`).check();
    await rowH.locator('[data-testid="adjudicate-submit"]').click();
    await page.locator('[data-testid="evaluation-message"]').waitFor({ state: "visible", timeout: 60_000 });
    ok((await page.locator('[data-testid="evaluation-message"]').innerText()).includes("认证"), "H2：服务端拒绝并提示（CERT_SCOPE_MISMATCH）");
    const evH = await apiEval(ctx, runH);
    ok(!evH.json.view.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match, "H3：没有产生 Match");

    console.log("\n== FLOW K（FR2）：VERIFIED 但 validFrom 在评估之后的证书 → 评估时尚未生效，不可采信 ==");
    const runK = await startEvaluation(page, ctx, S4A.offeringAId);
    const rowK = page.locator(`[data-testid="evaluation-run"][data-run-id="${runK}"] [data-testid="requirement-row"][data-requirement-key="R-001"]`);
    await rowK.locator('[data-testid="open-adjudicate"]').click();
    const futureLabel = await rowK.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaFutureAId}"]`).locator("xpath=..").innerText();
    ok(futureLabel.includes("生效于") && futureLabel.includes("对应本产品"), "K1：选择器显示该证书的生效日（范围对、已核实）", futureLabel);
    await rowK.locator('[data-testid="verdict-PASS"]').click();
    await rowK.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaFutureAId}"]`).check();
    await rowK.locator('[data-testid="adjudicate-submit"]').click();
    await waitEvalState(ctx, runK, (v) => v.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match);
    await applySuggestion(page, ctx, runK, "R-002");
    await computeGate(page, ctx, runK);
    const gateK = page.locator('[data-testid="gate-item"][data-requirement-key="R-001"]');
    ok((await gateK.getAttribute("data-reason")) === "CERT_NOT_YET_VALID_AT_EVALUATION", "K2：硬门原因 CERT_NOT_YET_VALID_AT_EVALUATION（不是 CERT_NOT_VERIFIED）", await gateK.getAttribute("data-reason"));
    ok((await gateK.innerText()).includes("尚未生效"), "K3：原因用中文说明「尚未生效」");
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("资料不足"), "K4：整体 INCOMPLETE → 待核实（不 PASS）");
    const evK = await apiEval(ctx, runK);
    const evidK = evK.json.view.candidates[0].requirements.find((r) => r.entry.code === "R-001").match.evidence[0];
    ok(evidK.statusAtEvaluation === "VERIFIED" && typeof evidK.validFrom === "string" && typeof evidK.capturedAt === "string" && Date.parse(evidK.validFrom) > Date.parse(evidK.capturedAt), "K5：冻结证据带 validFrom / capturedAt，且 validFrom > capturedAt", JSON.stringify({ s: evidK.statusAtEvaluation, vf: evidK.validFrom, ca: evidK.capturedAt }));
    await page.screenshot({ path: `${OUT}/flow-k-not-yet-valid.png` });

    console.log("\n== FLOW L（FR3）：已算门后再新增 Match → 门立刻失效（PENDING）→ 不能完成 → 重算 ==");
    const runL = await startEvaluation(page, ctx, S4A.offeringAId);
    await applySuggestion(page, ctx, runL, "R-002");
    await computeGate(page, ctx, runL);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("资料不足"), "L1：只判了 R-002 → 资料不足（R-001 缺）");
    ok((await page.locator('[data-testid="gate-stale-hint"]').count()) === 0, "L2：门与 Match 集一致时没有「需要重新计算」提示");
    await humanAdjudicate(page, ctx, runL, "R-001", "PASS", async (row) => { await row.locator(`[data-testid="evidence-cert"][data-cert-id="${S4A.certBifmaAId}"]`).check(); });
    const stale = await waitEvalState(ctx, runL, (v) => v.candidates[0].requirements.find((r) => r.entry.code === "R-001")?.match && v.candidates[0].mandatoryGateResult === "PENDING");
    const candL = stale.json.view.candidates[0];
    ok(candL.mandatoryGateResult === "PENDING" && candL.mandatoryGate === null && candL.recommendation === null && candL.rejectionReason === null, "L3：服务端：新增 Match 后门立刻 PENDING、快照 / 推荐 / 原因清空", JSON.stringify({ g: candL.mandatoryGateResult, rec: candL.recommendation }));
    await page.waitForFunction((id) => document.querySelector(`[data-testid="evaluation-run"][data-run-id="${id}"]`)?.getAttribute("data-gate-result") === "PENDING", runL, { timeout: 60_000 });
    ok((await page.locator('[data-testid="gate-stale-hint"]').count()) === 1 && (await page.locator('[data-testid="gate-stale-hint"]').innerText()).includes("重新计算"), "L4：界面提示「判定已更新，强制项需要重新计算」");
    ok(await page.locator('[data-testid="complete-evaluation"]').isDisabled(), "L5：「完成评估」按钮禁用（门未算）");
    const lc = await ctx.request.post(`${BASE}/api/supplier-intel/runs/${runL}/complete?orgId=${encodeURIComponent(ORG)}`, { data: {} });
    const lcBody = await lc.json().catch(() => null);
    ok(lc.status() === 409 && lcBody?.code === "GATE_PENDING", "L6：API 直接完成 → 409 GATE_PENDING（服务端拒绝，不靠按钮）", `${lc.status()} ${JSON.stringify(lcBody)}`);
    await computeGate(page, ctx, runL);
    ok((await page.locator('[data-testid="mandatory-gate-label"]').innerText()).includes("强制项：已通过"), "L7：重算 → 已通过（R-001 + R-002 都 PASS）");
    ok((await page.locator('[data-testid="gate-stale-hint"]').count()) === 0, "L8：重算后提示消失");
    await page.locator('[data-testid="complete-evaluation"]').click();
    const doneL = await waitEvalState(ctx, runL, (v) => v.run.status === "COMPLETED");
    ok(doneL.json?.view?.run?.status === "COMPLETED" && doneL.json.view.candidates[0].mandatoryGateResult === "PASS", "L9：重算后可完成 → COMPLETED / PASS");
    await page.screenshot({ path: `${OUT}/flow-l-stale-gate.png` });

    console.log("\n== FLOW I：完成后修改 live 数据，历史界面不漂移 ==");
    const patchOff = await ctx.request.get(`${BASE}/api/supplier-intel/suppliers/${SUP}/capability?orgId=${encodeURIComponent(ORG)}`);
    const offAView = (await patchOff.json()).view.offerings.find((o) => o.id === S4A.offeringAId);
    const pr = await ctx.request.patch(`${BASE}/api/supplier-intel/suppliers/${SUP}/offerings/${S4A.offeringAId}?orgId=${encodeURIComponent(ORG)}`, { data: { attributes: { 承重: "100 lb" }, expectedUpdatedAt: offAView.updatedAt } });
    ok(pr.status() === 200, "I1：live 产品属性改为 100 lb");
    const ex = await ctx.request.patch(`${BASE}/api/supplier-intel/suppliers/${SUP}/certifications/${S4A.certBifmaAId}?orgId=${encodeURIComponent(ORG)}`, { data: { action: "expire" } });
    ok(ex.status() === 200, "I2：live 证书置为已过期");
    await page.goto(evidenceUrl(`&evaluationRunId=${runA}`), { waitUntil: "domcontentloaded" });
    await waitWorkspace(page); await waitRunView(page, runA);
    ok((await page.locator('[data-testid="evaluation-run"]').getAttribute("data-gate-result")) === "PASS", "I3：历史评估仍是 PASS");
    ok((await page.locator('[data-testid="requirement-row"][data-requirement-key="R-001"] [data-testid="requirement-evidence"]').innerText()).includes("评估时 VERIFIED"), "I4：历史证据显示「评估时 VERIFIED」");
    ok((await page.locator('[data-testid="evaluation-status"]').innerText()).includes("评估已完成"), "I5：状态「评估已完成」");
    const evI = await apiEval(ctx, runA);
    ok(evI.json.view.candidates[0].offeringSnapshot?.attributes?.承重 === "600 lb", "I6：候选快照仍是 600 lb");
    ok((await page.locator('[data-testid="compute-gate"]').count()) === 0 && (await page.locator('[data-testid="open-adjudicate"]').count()) === 0, "I7：已完成的评估没有任何写操作按钮");
    const runI = await startEvaluation(page, ctx, S4A.offeringAId);
    ok((await page.locator(`[data-testid="evaluation-run"][data-run-id="${runI}"] [data-testid="requirement-row"][data-requirement-key="R-002"] [data-testid="requirement-suggestion"]`).getAttribute("data-suggestion-verdict")) === "FAIL", "I8：新评估按新数据（100 lb）建议 FAIL——历史 PASS 与新 FAIL 并存");
    await page.screenshot({ path: `${OUT}/flow-i-history.png` });

    console.log("\n== 搜索记录：评估运行有自己的卡片，不冒充搜索 ==");
    await page.goto(`${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(PROJ)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    ok((await page.locator('[data-testid="run-recovery"]').count()) === 0, "R0：进行中的评估不显示成「搜索未收尾」");
    await page.getByRole("tab", { name: "搜索记录" }).click();
    const evCard = page.locator(`[data-testid="run-card"][data-run-id="${runA}"]`);
    await evCard.waitFor({ state: "visible", timeout: 90_000 });
    ok((await evCard.getAttribute("data-run-mode")) === "EVALUATION_ONLY", "R1：评估运行卡片");
    const cardText = await evCard.innerText();
    ok(cardText.includes("评估运行") && cardText.includes("评估已完成") && !cardText.includes("搜索已结束") && !cardText.includes("有结果"), "R2：显示「评估已完成」，不写「搜索已结束 / 外部来源成功」");
    await evCard.locator('[data-testid="view-evaluation"]').click();
    await page.waitForURL(/evaluationRunId=/, { timeout: 60_000 });
    await waitWorkspace(page); await waitRunView(page, runA);
    ok(true, "R3：「查看项目匹配」直接打开该评估");

    console.log("\n== 三个视口 ==");
    for (const vp of [{ name: "desktop-1440x900", width: 1440, height: 900 }, { name: "laptop-1024x768", width: 1024, height: 768 }, { name: "mobile-390x844", width: 390, height: 844 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      ok(!overflow, `V-${vp.name}：无横向溢出`);
      await page.screenshot({ path: `${OUT}/vp-${vp.name}.png` });
    }
    ok((await page.locator('[data-testid="requirement-verdict"]').first().isVisible()) && (await page.locator('[data-testid="requirement-evidence"]').first().isVisible()) && (await page.locator('[data-testid="mandatory-gate-label"]').isVisible()), "V-mobile：390px 能看到要求 / 判定 / 证据 / 硬门");
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log("\n== FLOW J：无项目写权限 → 不能创建 / 匹配 / 算门 ==");
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(vctx, EMAILS.viewer);
    const vpage = await vctx.newPage();
    await vpage.goto(evidenceUrl(`&evaluationRunId=${runD}`), { waitUntil: "domcontentloaded" });
    await waitWorkspace(vpage);
    ok((await vpage.locator('[data-testid="tab-evaluation"]').count()) === 1, "J1：只读成员能看到「项目匹配」");
    await openEvaluationTab(vpage);
    ok((await vpage.locator('[data-testid="evaluation-start-box"]').count()) === 0, "J2：没有「开始项目评估」（服务端 projectContext.canWrite=false）");
    await waitRunView(vpage, runD);
    ok((await vpage.locator('[data-testid="compute-gate"]').count()) === 0 && (await vpage.locator('[data-testid="open-adjudicate"]').count()) === 0, "J3：没有判定 / 算门按钮");
    const jc = await vctx.request.post(`${BASE}/api/supplier-intel/projects/${PROJ}/evaluations?orgId=${encodeURIComponent(ORG)}`, { data: { supplierId: SUP, offeringId: S4A.offeringAId } });
    ok(jc.status() === 403, "J4：API 创建评估 → 403", `实际 ${jc.status()}`);
    const candD = (await apiEval(ctx, runD)).json.view.candidates[0].id;
    const jm = await vctx.request.post(`${BASE}/api/supplier-intel/candidates/${candD}/matches?orgId=${encodeURIComponent(ORG)}`, { data: { requirementKey: "R-003", verdict: "UNKNOWN", evidence: [] } });
    ok(jm.status() === 403, "J5：API 写 Match → 403", `实际 ${jm.status()}`);
    const jg = await vctx.request.post(`${BASE}/api/supplier-intel/candidates/${candD}/mandatory-gate?orgId=${encodeURIComponent(ORG)}`, { data: {} });
    ok(jg.status() === 403, "J6：API 算门 → 403", `实际 ${jg.status()}`);
    await vctx.close();
    const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(octx, EMAILS.outsider);
    const opage = await octx.newPage();
    await opage.goto(evidenceUrl(), { waitUntil: "domcontentloaded" });
    await waitWorkspace(opage);
    ok((await opage.locator('[data-testid="tab-evaluation"]').count()) === 0, "J7：无项目权限的 org 成员看不到「项目匹配」（供应商可编辑 ≠ 可评估任意项目）");
    const oc = await octx.request.post(`${BASE}/api/supplier-intel/projects/${PROJ}/evaluations?orgId=${encodeURIComponent(ORG)}`, { data: { supplierId: SUP, offeringId: S4A.offeringAId } });
    ok(oc.status() === 403 || oc.status() === 404, "J8：API 创建评估被拒", `实际 ${oc.status()}`);
    await octx.close();
  } finally { await browser.close(); }
  console.log(`\nS4-A 浏览器验收：${pass} 通过 / ${fail} 失败`);
  console.log(`截图目录：${OUT}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); console.log(`\nS4-A 浏览器验收异常中断：${pass} 通过 / ${fail} 失败`); process.exit(1); });
