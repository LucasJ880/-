/**
 * S3-B 供应商证据工作台 — 真实浏览器验收（Playwright）。
 *
 * 前置：dev server 跑在隔离库上（.env.local 指向隔离 Neon 分支 + SUPPLIER_INTEL_ENABLED=1），
 *       并已执行 `scripts/s3a-fixture-seed.ts`（它同时产出 S3-B 夹具：已关联线索 + 档案依据 + 他组织账号）。
 *
 * 用法：
 *   S3B_BASE=http://localhost:3212 S3B_IDS=<seed 输出的 json> S3B_PASSWORD=... \
 *   node scripts/s3b-evidence-acceptance.mjs
 *
 * 纪律（沿用 S3-A FR4）：
 *   - 没有 `|| true`、没有 `ok(true, ...)`；夹具缺失 / 期望元素缺失一律 FAIL；
 *   - 每个关键写操作都用 API 从服务端读回来确认，不只看界面；
 *   - 「厂家」全部是合成夹具，不是真实搜到的厂家。
 *
 * 八条流程：
 *   F1 Tender → S3-A 线索 → 已关联供应商 → 查看产品与资质
 *   F2 新建产品 → 价格待确认 → 保存 → 刷新仍在（+ 编辑带版本号，旧版本被 409）
 *   F3 登记资质 → CLAIMED → 无依据核验被拒 → 合法档案依据 → VERIFIED（含核验依据可见）
 *   F4 有效期已过 → 界面「按日期已过期」→ GET 不改库里状态
 *   F5 从已关联线索记录能力 → 出处可回溯
 *   F6 有供应商权限但无项目写权限 → 能力录入 403（界面也不给该出处）
 *   F7 他组织 → 404 且不泄露
 *   F8 返回路径正确（两个入口各自回到来源项目）
 *   + 三个视口无横向溢出，390px 能完成核心录入；资料缺口只有事实状态，没有分数
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.S3B_BASE || "http://localhost:3212";
const IDS_FILE = process.env.S3B_IDS;
const PASSWORD = process.env.S3B_PASSWORD || "s3a-demo-pass";
const OUT = process.env.S3B_SHOT_DIR || ".s3b-screenshots";

let ids;
try {
  ids = JSON.parse(readFileSync(IDS_FILE, "utf8"));
} catch (e) {
  console.error(`无法读取夹具清单 ${IDS_FILE}：${e?.message}`);
  process.exit(2);
}
const ORG = ids.orgId;
const EMAILS = ids.users;
const S3B = ids.s3b;

let pass = 0;
let fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function requireFixture(value, name) {
  if (value === undefined || value === null || value === "") {
    fail += 1; console.log(`  ✗ [夹具缺失] ${name} —— 验收无法进行`); return false;
  }
  pass += 1; console.log(`  ✓ [夹具就绪] ${name}`); return true;
}

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "laptop-1024x768", width: 1024, height: 768 },
  { name: "mobile-390x844", width: 390, height: 844 },
];
const FORBIDDEN_SCORE_WORDS = /评分|得分|合格率|Supplier Score|Compliance Score|Tender Fit|系统推荐|已认证/;
/**
 * 页面**必须**写「身份关联 ≠ 已认证」「不是系统推荐」这类否定句——那是任务书要求的四态分离。
 * 断言要抓的是把「已认证 / 系统推荐」当成**陈述**来用；先把已知的否定形式剥掉再匹配。
 */
function stripNegatedClaims(t) {
  return t.replace(/不代表(供应商)?已认证|≠\s*已认证|不等于已认证|不是已认证|不是系统推荐|不代表系统推荐/g, "");
}

async function login(context, email) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email} failed ${res.status()}`);
  const body = await res.json();
  await context.addInitScript((orgId) => { try { localStorage.setItem("qy_active_org_id", orgId); } catch {} }, body.activeOrgId ?? ORG);
  return body;
}

const evidenceUrl = (supplierId, extra = "") =>
  `${BASE}/projects/intelligence/supply-chain/supplier?supplierId=${encodeURIComponent(supplierId)}${extra}`;
const workspaceUrl = (projectId) => `${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`;

async function waitEvidence(page) {
  await page.waitForSelector('[data-testid="supplier-evidence-workspace"], [data-testid="workspace-fatal"]', { timeout: 120_000 });
}
async function openEvidenceTab(page, key) {
  await page.locator(`[data-testid="tab-${key}"]`).click();
  await page.waitForSelector(`[data-testid="${key === "gaps" ? "gaps-section" : `${key}-section`}"]`, { timeout: 30_000 });
}
async function waitNotLoading(page) {
  await page.waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), { timeout: 90_000 }).catch(() => {});
}

/** 轮询服务端直到条件成立（或超时返回最后一次结果）；dev 模式首次命中路由会先编译，固定 sleep 不可靠 */
async function waitApi(ctx, supplierId, predicate, { timeoutMs = 90_000, stepMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await apiView(ctx, supplierId);
    if (last.view && predicate(last.view)) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last;
}

/**
 * 服务端读回：写操作必须能从 API 读回来。
 * 只对 5xx 重试（最多 3 次）：隔离 Neon 分支的计算节点偶发 P1001「无法连接数据库」，
 * 那是环境抖动，不是被测行为；4xx（权限 / 不存在 / 校验）一律不重试，如实返回。
 */
async function apiView(ctx, supplierId, orgId = ORG, extra = "") {
  let res, text;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await ctx.request.get(`${BASE}/api/supplier-intel/suppliers/${supplierId}/capability?orgId=${encodeURIComponent(orgId)}${extra}`);
    text = await res.text();
    if (res.status() < 500) break;
    console.log(`  · apiView 5xx（第 ${attempt} 次，环境抖动）：${res.status()}`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  let view = null;
  try { view = JSON.parse(text).view ?? null; } catch {}
  return { status: res.status(), view, text };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("\n== 夹具门 ==");
  requireFixture(ORG, "orgId");
  requireFixture(EMAILS?.buyer, "采购员（项目写权限）");
  requireFixture(EMAILS?.viewer, "只读成员（项目只读）");
  requireFixture(S3B?.supplierId, "已关联的供应商");
  requireFixture(S3B?.linkedSignalId, "已关联线索");
  requireFixture(S3B?.projectId, "线索所属项目");
  requireFixture(S3B?.archiveItemId, "项目档案（核验依据）");
  requireFixture(S3B?.internalCandidateRunId, "内部候选所在的搜索");
  requireFixture(S3B?.internalCandidateProjectId, "内部候选所在的项目");
  requireFixture(S3B?.otherOrgId, "他组织");
  requireFixture(S3B?.strangerEmail, "他组织账号");
  if (fail > 0) { console.log(`\n夹具不完整，终止：${pass} 通过 / ${fail} 失败`); process.exit(1); }

  const SUP = S3B.supplierId;
  const PROJ = S3B.projectId;
  const browser = await chromium.launch();
  try {
    const buyerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(buyerCtx, EMAILS.buyer);
    const page = await buyerCtx.newPage();

    /* ═════════ F1 ═════════ */
    console.log("\n== F1：Tender → 线索 → 已关联供应商 → 查看产品与资质 ==");
    await page.goto(workspaceUrl(PROJ), { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "供应商线索" }).click();
    const linkedRow = page.locator(`[data-testid="signal-row"][data-signal-id="${S3B.linkedSignalId}"]`);
    await linkedRow.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
    ok((await linkedRow.count()) === 1, "F1a：已关联线索在收件箱可见");
    if ((await linkedRow.count()) !== 1) throw new Error("F1 中断：夹具线索不可见");
    await linkedRow.click();
    await page.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
    const box = page.locator('[data-testid="linked-supplier-box"]');
    ok((await box.count()) === 1, "F1b：抽屉里出现「已人工关联到此供应商」区块");
    ok((await box.innerText()).includes("不代表已认证"), "F1c：明说身份关联 ≠ 已认证");
    const link = page.locator('[data-testid="view-supplier-evidence"]');
    ok((await link.count()) === 1, "F1d：有「查看供应商产品与资质」入口");
    const href = await link.getAttribute("href");
    const hu = new URL(href, BASE);
    ok(hu.searchParams.get("supplierId") === SUP, "F1e：入口携带 supplierId", href);
    ok(hu.searchParams.get("projectId") === PROJ, "F1f：入口携带 projectId");
    ok(hu.searchParams.get("signalId") === S3B.linkedSignalId, "F1g：入口携带 signalId");
    await link.click();
    await page.waitForURL(/supply-chain\/supplier/, { timeout: 60_000 });
    await waitEvidence(page);
    await waitNotLoading(page);
    ok((await page.locator('[data-testid="supplier-evidence-workspace"]').count()) === 1, "F1h：进入 canonical 证据工作台");
    ok((await page.locator('[data-testid="supplier-name"]').innerText()).includes(S3B.supplierName), "F1i：显示供应商名称");
    const pc = page.locator('[data-testid="project-context"]');
    ok((await pc.count()) === 1 && (await pc.innerText()).includes("当前用于"), "F1j：顶部显示「当前用于：项目」");
    const els = page.locator('[data-testid="entry-linked-signal"]');
    ok((await els.count()) === 1 && (await els.innerText()).includes("已人工关联到此供应商"), "F1k：入口语义：该线索已人工关联到此供应商");
    ok((await page.locator('[data-testid="identity-status"]').innerText()).includes("已人工关联"), "F1l：身份状态是「已人工关联」");
    const headText = await page.innerText("main");
    ok(!FORBIDDEN_SCORE_WORDS.test(stripNegatedClaims(headText)), "F1m：页面没有把「已认证 / 系统推荐 / 评分」当陈述使用（否定句除外）", (stripNegatedClaims(headText).match(FORBIDDEN_SCORE_WORDS) ?? [])[0]);
    await page.screenshot({ path: `${OUT}/f1-entry-from-signal.png` });

    /* ═════════ F2 ═════════ */
    console.log("\n== F2：新建产品 → 价格待确认 → 保存 → 刷新仍在 ==");
    await openEvidenceTab(page, "offerings");
    const offName = `[演示] 网布办公椅 ${Date.now()}`;
    await page.locator('[data-testid="offering-add"]').click();
    await page.locator('[data-testid="offering-name"]').fill(offName);
    await page.locator('[data-testid="offering-sku"]').fill("MC-2201");
    await page.locator('[data-testid="offering-moq"]').fill("200");
    await page.locator('[data-testid="offering-attributes"]').fill("材质: 钢架+网布\n承重: 136kg");
    ok((await page.locator('[data-testid="offering-price-status"]').inputValue()) === "UNKNOWN", "F2a：价格状态默认「待确认」");
    ok((await page.locator('[data-testid="offering-unit-price"]').inputValue()) === "", "F2b：单价留空");
    await page.locator('[data-testid="offering-submit"]').click();
    const offCard = page.locator('[data-testid="offering-card"]').filter({ hasText: offName });
    await offCard.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await offCard.count()) === 1, "F2c：产品卡片出现（缺价没有阻止保存）");
    if ((await offCard.count()) !== 1) throw new Error("F2 中断：产品未出现");
    ok((await offCard.locator('[data-testid="offering-price"]').innerText()).includes("价格待确认"), "F2d：显示「价格待确认」");
    ok(!(await page.innerText("main")).includes("资料不完整"), "F2e：不出现「资料不完整，无法保存」");
    ok((await offCard.locator('[data-testid="offering-source"]').innerText()).includes("人工登记"), "F2f：来源显示「人工登记」（服务端固定）");
    const v2 = await apiView(buyerCtx, SUP);
    const offRow = v2.view?.offerings?.find((o) => o.name === offName);
    ok(Boolean(offRow), "F2g：服务端读回产品存在");
    ok(offRow?.priceStatus === "UNKNOWN" && offRow?.unitPrice === null, "F2h：服务端 priceStatus=UNKNOWN、unitPrice=null");
    ok(offRow?.sourceKind === "MANUAL", "F2i：服务端 sourceKind=MANUAL");
    ok(offRow?.attributes?.["材质"] === "钢架+网布", "F2j：规格属性落库");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitEvidence(page); await waitNotLoading(page);
    await openEvidenceTab(page, "offerings");
    ok((await page.locator('[data-testid="offering-card"]').filter({ hasText: offName }).count()) === 1, "F2k：刷新后产品仍在");

    // 编辑：带版本号 → 落库；再用旧版本号提交 → 409 不覆盖
    const card2 = page.locator(`[data-testid="offering-card"][data-offering-id="${offRow.id}"]`);
    await card2.locator('[data-testid="offering-edit"]').click();
    await page.locator('[data-testid="offering-form-edit"] [data-testid="offering-moq"]').fill("350");
    await page.locator('[data-testid="offering-form-edit"] [data-testid="offering-submit"]').click();
    await page.locator('[data-testid="offering-form-edit"]').waitFor({ state: "detached", timeout: 90_000 }).catch(() => {});
    const v2b = await waitApi(buyerCtx, SUP, (v) => v.offerings?.find((o) => o.id === offRow.id)?.moq === 350);
    const offAfter = v2b.view?.offerings?.find((o) => o.id === offRow.id);
    ok(offAfter?.moq === 350, "F2l：编辑后 MOQ 落库", `实际 ${offAfter?.moq}`);
    ok(offAfter?.updatedAt !== offRow.updatedAt, "F2m：版本号（updatedAt）前进");
    const staleRes = await buyerCtx.request.patch(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/offerings/${offRow.id}?orgId=${encodeURIComponent(ORG)}`,
      { data: { moq: 1, expectedUpdatedAt: offRow.updatedAt } },
    );
    ok(staleRes.status() === 409, "F2n：基于旧版本提交 → 409（不静默覆盖）", `实际 ${staleRes.status()}`);
    const v2c = await apiView(buyerCtx, SUP);
    ok(v2c.view?.offerings?.find((o) => o.id === offRow.id)?.moq === 350, "F2o：旧版本提交没有覆盖新值");
    const noVer = await buyerCtx.request.patch(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/offerings/${offRow.id}?orgId=${encodeURIComponent(ORG)}`,
      { data: { moq: 1 } },
    );
    ok(noVer.status() === 400, "F2p：不带版本号 → 400", `实际 ${noVer.status()}`);
    await page.screenshot({ path: `${OUT}/f2-offering.png` });

    /* ═════════ F3 ═════════ */
    console.log("\n== F3：登记资质 → CLAIMED → 无依据核验被拒 → 合法依据 → VERIFIED ==");
    await openEvidenceTab(page, "certifications");
    await page.locator('[data-testid="cert-add"]').click();
    await page.selectOption('[data-testid="cert-type"]', "ISO_9001");
    await page.selectOption('[data-testid="cert-scope"]', "SUPPLIER");
    const certNo = `Q-${Date.now()}`;
    await page.locator('[data-testid="cert-number"]').fill(certNo);
    await page.locator('[data-testid="cert-expires"]').fill("2030-12-31");
    ok((await page.innerText('[data-testid="cert-form"]')).includes("没有任何登记选项能直接得到「已核验」"), "F3a：登记表单明说不能直接得到已核验");
    await page.locator('[data-testid="cert-submit"]').click();
    const certCard = page.locator('[data-testid="cert-card"]').filter({ hasText: certNo });
    await certCard.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await certCard.count()) === 1, "F3b：资质卡片出现");
    if ((await certCard.count()) !== 1) throw new Error("F3 中断：资质未出现");
    ok((await certCard.getAttribute("data-cert-status")) === "CLAIMED", "F3c：状态 CLAIMED");
    ok((await certCard.locator('[data-testid="cert-status"]').innerText()).includes("厂家声称 / 待核验"), "F3d：文案「厂家声称 / 待核验」");
    ok(!stripNegatedClaims(await certCard.innerText()).includes("已认证"), "F3e：不把「已认证」当陈述使用（「不等于已认证」这类否定句除外）");
    const v3 = await apiView(buyerCtx, SUP);
    const certRow = v3.view?.certifications?.find((c) => c.certificateNumber === certNo);
    ok(certRow?.status === "CLAIMED", "F3f：服务端读回 CLAIMED");
    // 客户端伪造 status=VERIFIED → 仍是 CLAIMED
    const forged = await buyerCtx.request.post(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/certifications?orgId=${encodeURIComponent(ORG)}`,
      { data: { scope: "SUPPLIER", certificationType: "CE", sourceKind: "SOCIAL", status: "VERIFIED", certificateNumber: `forged-${Date.now()}` } },
    );
    const forgedBody = await forged.json();
    ok(forged.status() === 201 && forgedBody?.certification?.status === "CLAIMED", "F3g：请求里硬塞 status=VERIFIED，落库仍是 CLAIMED", `实际 ${forged.status()} ${forgedBody?.certification?.status}`);
    // 无依据核验 → 422
    const noEv = await buyerCtx.request.patch(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/certifications/${certRow.id}?orgId=${encodeURIComponent(ORG)}`,
      { data: { action: "verify" } },
    );
    ok(noEv.status() === 422, "F3h：无依据核验 → 422", `实际 ${noEv.status()}`);
    ok((await apiView(buyerCtx, SUP)).view?.certifications?.find((c) => c.id === certRow.id)?.status === "CLAIMED", "F3i：被拒后仍是 CLAIMED");
    // 界面：打开核验面板，没有选依据时不能提交；选择项目档案 → 提交 → VERIFIED
    await certCard.locator('[data-testid="cert-verify-open"]').click();
    const vp = page.locator('[data-testid="verify-panel"]');
    await vp.waitFor({ state: "visible", timeout: 30_000 });
    ok((await vp.innerText()).includes("需要独立依据"), "F3j：核验面板明说需要独立依据");
    ok(await vp.locator('[data-testid="verify-submit"]').isDisabled(), "F3k：未选依据时不能提交（没有一键 VERIFIED）");
    const archiveOpt = vp.locator(`[data-testid="verify-archive-option"][data-archive-id="${S3B.archiveItemId}"]`);
    await archiveOpt.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await archiveOpt.count()) === 1, "F3l：项目档案选择器列出夹具档案");
    if ((await archiveOpt.count()) !== 1) throw new Error("F3 中断：档案选择器没有夹具档案");
    await archiveOpt.check();
    await vp.locator('[data-testid="verify-note"]').fill("已核对扫描件编号");
    await vp.locator('[data-testid="verify-submit"]').click();
    const v3b = await waitApi(buyerCtx, SUP, (v) => v.certifications?.find((c) => c.id === certRow.id)?.status === "VERIFIED");
    await page.locator(`[data-testid="cert-card"][data-cert-id="${certRow.id}"][data-cert-status="VERIFIED"]`).waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    const certV = v3b.view?.certifications?.find((c) => c.id === certRow.id);
    ok(certV?.status === "VERIFIED", "F3m：服务端 VERIFIED", `实际 ${certV?.status}`);
    ok(certV?.evidence?.kind === "ARCHIVE" && certV?.evidence?.viewable === true, "F3n：核验依据 = 项目档案，且可查看");
    const certCardV = page.locator(`[data-testid="cert-card"][data-cert-id="${certRow.id}"]`);
    ok((await certCardV.locator('[data-testid="cert-status"]').innerText()).includes("已独立核验"), "F3o：界面「已独立核验」");
    ok((await certCardV.locator('[data-testid="cert-evidence"]').innerText()).includes("核验依据"), "F3p：界面显示「核验依据」");
    await page.screenshot({ path: `${OUT}/f3-certification-verified.png` });

    /* ═════════ F4 ═════════ */
    console.log("\n== F4：有效期已过 → 界面按日期过期 → GET 不改库 ==");
    const pastNo = `P-${Date.now()}`;
    const pastCreate = await buyerCtx.request.post(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/certifications?orgId=${encodeURIComponent(ORG)}`,
      { data: { scope: "SUPPLIER", certificationType: "BIFMA", sourceKind: "USER_ENTRY", certificateNumber: pastNo, expiresAt: "2020-01-01T00:00:00.000Z" } },
    );
    const pastId = (await pastCreate.json())?.certification?.id;
    const pastVerify = await buyerCtx.request.patch(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/certifications/${pastId}?orgId=${encodeURIComponent(ORG)}`,
      { data: { action: "verify", archiveItemId: S3B.archiveItemId } },
    );
    ok(pastVerify.status() === 200, "F4a：核验成功（核验的是真伪，不是有效期）");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitEvidence(page); await waitNotLoading(page);
    await openEvidenceTab(page, "certifications");
    const pastCard = page.locator(`[data-testid="cert-card"][data-cert-id="${pastId}"]`);
    ok((await pastCard.count()) === 1, "F4b：卡片可见");
    ok((await pastCard.getAttribute("data-expired-by-date")) === "true", "F4c：expiredByDate=true");
    ok((await pastCard.locator('[data-testid="cert-expired-by-date"]').count()) === 1, "F4d：显示「按日期已过期」徽标");
    ok((await pastCard.locator('[data-testid="cert-status"]').innerText()).includes("按日期已过期"), "F4e：状态文案本身也带「按日期已过期」，不是只靠颜色");
    const v4 = await apiView(buyerCtx, SUP);
    ok(v4.view?.certifications?.find((c) => c.id === pastId)?.status === "VERIFIED", "F4f：GET 之后库里仍是 VERIFIED（没有偷偷改状态）");
    await page.screenshot({ path: `${OUT}/f4-expired-by-date.png` });

    /* ═════════ F5 ═════════ */
    console.log("\n== F5：从已关联线索记录能力 → 出处可回溯 ==");
    await openEvidenceTab(page, "capabilities");
    await page.locator('[data-testid="capability-add"]').click();
    const srcSel = page.locator('[data-testid="capability-source"]');
    const srcOpt = srcSel.locator(`option[value="${S3B.linkedSignalId}"]`);
    ok((await srcOpt.count()) === 1 && !(await srcOpt.isDisabled()), "F5a：出处下拉里有已关联线索且可选");
    await srcSel.selectOption(S3B.linkedSignalId);
    await page.selectOption('[data-testid="capability-type"]', "CNC_CAPABILITY");
    const evOpts = await page.locator('[data-testid="capability-evidence-status"] option').allTextContents();
    ok(!evOpts.some((t) => t.includes("已独立核验")), "F5b：证据程度里没有「已独立核验」可选", evOpts.join("/"));
    await page.locator('[data-testid="capability-value"]').fill("3 轴 CNC × 6 台（厂家自述）");
    await page.locator('[data-testid="capability-submit"]').click();
    const capCard = page.locator(`[data-testid="capability-card"][data-source-signal-id="${S3B.linkedSignalId}"]`);
    await capCard.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await capCard.count()) >= 1, "F5c：能力卡片出现");
    ok((await capCard.first().locator('[data-testid="capability-source-box"]').innerText()).includes("出处线索"), "F5d：卡片显示出处线索");
    ok((await capCard.first().locator('[data-testid="capability-evidence"]').innerText()).includes("厂家声称"), "F5e：证据程度「厂家声称」");
    const v5 = await apiView(buyerCtx, SUP);
    const capRow = v5.view?.capabilities?.find((c) => c.source?.signalId === S3B.linkedSignalId && c.type === "CNC_CAPABILITY");
    ok(Boolean(capRow), "F5f：服务端读回能力，且回溯到该线索");
    ok(capRow?.extractedBy === "HUMAN" && capRow?.evidenceStatus === "CLAIMED", "F5g：extractedBy=HUMAN、evidenceStatus=CLAIMED");
    ok(typeof capRow?.source?.rawTextExcerpt === "string" && capRow.source.rawTextExcerpt.includes("CNC"), "F5h：出处带原文摘录");
    // 直接尝试 VERIFIED → 422
    const capForged = await buyerCtx.request.post(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/capability-signals?orgId=${encodeURIComponent(ORG)}`,
      { data: { discoverySignalId: S3B.linkedSignalId, type: "OEM_SUPPORT", evidenceStatus: "VERIFIED" } },
    );
    ok(capForged.status() === 422, "F5i：social 写路径直接 VERIFIED → 422", `实际 ${capForged.status()}`);
    await page.screenshot({ path: `${OUT}/f5-capability.png` });

    /* ═════════ 资料缺口 / 无分数 ═════════ */
    console.log("\n== 资料缺口：只有事实状态，没有分数 ==");
    await openEvidenceTab(page, "gaps");
    const gapRows = page.locator('[data-testid="gap-row"]');
    ok((await gapRows.count()) >= 8, "G1：至少 8 行资料状态", `实际 ${await gapRows.count()}`);
    const gapText = await page.innerText('[data-testid="gaps-section"]');
    ok(gapText.includes("不是评分"), "G2：明说不是评分、不是合规判定");
    const gapClaims = gapText.replace(/不是评分|不是合规判定|不是排名/g, "");
    ok(!/\d+\s*%|\d+\s*\/\s*100|评分|得分|合格率|红|黄|绿/.test(gapClaims), "G3：没有百分比 / 0–100 / 合格率 / 红黄绿（「不是评分」这类否定句除外）", (gapClaims.match(/\d+\s*%|\d+\s*\/\s*100|评分|得分|合格率|红|黄|绿/) ?? [])[0]);
    const priceRow = page.locator('[data-testid="gap-row"][data-gap-key="price"]');
    ok(["PENDING", "PARTIAL"].includes(await priceRow.getAttribute("data-gap-status")), "G4：价格行按事实是「待确认 / 部分」");
    ok((await page.locator('[data-testid="gap-row"][data-gap-key="cert"]').getAttribute("data-gap-status")) === "VERIFIED", "G5：认证行「已核验」（有一项未过期的核验）");
    ok((await page.locator('[data-testid="gap-row"][data-gap-key="certVerify"]').getAttribute("data-gap-status")) === "PENDING", "G6：认证核验行「待确认」（仍有厂家声称项）");
    await page.screenshot({ path: `${OUT}/gaps.png` });

    /* ═════════ 三个视口 ═════════ */
    console.log("\n== 三个视口：无横向溢出，390px 能完成核心录入 ==");
    for (const vpz of VIEWPORTS) {
      await page.setViewportSize({ width: vpz.width, height: vpz.height });
      for (const key of ["offerings", "certifications", "gaps"]) {
        await openEvidenceTab(page, key);
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        ok(!overflow, `V-${vpz.name}-${key}：无横向溢出`);
        await page.screenshot({ path: `${OUT}/vp-${vpz.name}-${key}.png` });
      }
    }
    // 390px：真的能录一个产品
    await page.setViewportSize({ width: 390, height: 844 });
    await openEvidenceTab(page, "offerings");
    const mobileName = `[演示] 窄屏录入 ${Date.now()}`;
    await page.locator('[data-testid="offering-add"]').click();
    await page.locator('[data-testid="offering-name"]').fill(mobileName);
    await page.locator('[data-testid="offering-submit"]').click();
    await page.locator('[data-testid="offering-card"]').filter({ hasText: mobileName }).first().waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
    const mobileSaved = await waitApi(buyerCtx, SUP, (v) => Boolean(v.offerings?.find((o) => o.name === mobileName)));
    ok(Boolean(mobileSaved.view?.offerings?.find((o) => o.name === mobileName)), "V-mobile：390px 完成产品录入并落库");
    await page.setViewportSize({ width: 1440, height: 900 });

    /* ═════════ F8（入口 A 的返回）═════════ */
    console.log("\n== F8：返回路径 ==");
    const back = page.locator('[data-testid="back-to-workspace"]');
    ok((await back.innerText()).includes("返回采购工作台"), "F8a：有「返回采购工作台」");
    const backHref = new URL(await back.getAttribute("href"), BASE);
    ok(backHref.pathname.endsWith("/supply-chain") && backHref.searchParams.get("projectId") === PROJ, "F8b：返回链接指向来源项目的采购工作台");
    await back.click();
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    ok(new URL(page.url()).searchParams.get("projectId") === PROJ, "F8c：实际回到来源项目");

    /* ═════════ 入口 B：内部候选 ═════════ */
    console.log("\n== 入口 B：搜索记录 → 内部候选 → 查看产品与资质 → 返回 ==");
    await page.goto(workspaceUrl(S3B.internalCandidateProjectId), { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 120_000 });
    await page.getByRole("tab", { name: "搜索记录" }).click();
    const runCard = page.locator(`[data-testid="run-card"][data-run-id="${S3B.internalCandidateRunId}"]`);
    await runCard.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
    ok((await runCard.count()) === 1, "B1：内部候选所在的搜索卡片可见");
    if ((await runCard.count()) !== 1) throw new Error("入口 B 中断：搜索卡片不可见");
    await runCard.locator('[data-testid="internal-candidates"] summary').click();
    const candLink = runCard.locator('[data-testid="view-candidate-evidence"]');
    await candLink.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await candLink.count()) >= 1, "B2：内部候选有「查看产品与资质」入口", `实际 ${await candLink.count()}`);
    if ((await candLink.count()) < 1) throw new Error("入口 B 中断：没有内部候选入口");
    const candSupplierId = await candLink.first().getAttribute("data-supplier-id");
    const candHref = new URL(await candLink.first().getAttribute("href"), BASE);
    ok(candHref.searchParams.get("searchRunId") === S3B.internalCandidateRunId, "B3：入口携带 searchRunId");
    ok(candHref.searchParams.get("projectId") === S3B.internalCandidateProjectId, "B4：入口携带 projectId");
    await candLink.first().click();
    await page.waitForURL(/supply-chain\/supplier/, { timeout: 60_000 });
    await waitEvidence(page); await waitNotLoading(page);
    ok((await page.locator('[data-testid="supplier-evidence-workspace"]').getAttribute("data-supplier-id")) === candSupplierId, "B5：进入同一个 canonical 证据页（对应候选供应商）");
    const eic = page.locator('[data-testid="entry-internal-candidate"]');
    ok((await eic.count()) === 1, "B6：入口语义：内部候选来源（服务端核实）");
    const eicText = (await eic.count()) === 1 ? await eic.innerText() : "";
    ok(eicText.includes("内部候选来源") && !stripNegatedClaims(eicText).includes("系统推荐"), "B7：写的是「内部候选来源」，不把「系统推荐」当陈述", eicText);
    ok((await page.locator('[data-testid="entry-linked-signal"]').count()) === 0, "B8：没有从线索进入，就不显示线索入口语义");
    const back2 = new URL(await page.locator('[data-testid="back-to-workspace"]').getAttribute("href"), BASE);
    ok(back2.searchParams.get("projectId") === S3B.internalCandidateProjectId, "B9：返回链接指向内部候选所在的项目");
    await page.screenshot({ path: `${OUT}/entry-internal-candidate.png` });

    // 伪造上下文：URL 里塞一个未关联的 signalId → 服务端不确认
    await page.goto(evidenceUrl(SUP, `&projectId=${encodeURIComponent(PROJ)}&signalId=not-a-real-signal`), { waitUntil: "domcontentloaded" });
    await waitEvidence(page); await waitNotLoading(page);
    ok((await page.locator('[data-testid="entry-linked-signal"]').count()) === 0, "B10：URL 里伪造 signalId → 不显示「已关联」语义（服务端核实）");

    /* ═════════ F6 ═════════ */
    console.log("\n== F6：有供应商权限、无项目写权限 → 能力录入 403 ==");
    const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(viewerCtx, EMAILS.viewer);
    const vpage = await viewerCtx.newPage();
    await vpage.goto(evidenceUrl(SUP, `&projectId=${encodeURIComponent(PROJ)}`), { waitUntil: "domcontentloaded" });
    await waitEvidence(vpage); await waitNotLoading(vpage);
    ok((await vpage.locator('[data-testid="supplier-name"]').count()) === 1, "F6a：只读成员能打开供应商页（org 级资源）");
    await openEvidenceTab(vpage, "capabilities");
    const vAdd = vpage.locator('[data-testid="capability-add"]');
    if ((await vAdd.count()) === 1 && !(await vAdd.isDisabled())) {
      await vAdd.click();
      const vOpt = vpage.locator(`[data-testid="capability-source"] option[value="${S3B.linkedSignalId}"]`);
      // Playwright 的 locator.isDisabled() 对 <option> 返回 false（实测），按 DOM 属性断言
      const vOptDisabled = (await vOpt.count()) === 1 ? await vOpt.evaluate((o) => o.disabled) : null;
      ok(vOptDisabled === true, "F6b：界面里该线索作为出处被禁用（无该项目写权限）", `count=${await vOpt.count()} disabled=${vOptDisabled}`);
      ok((await vOpt.count()) === 1 && (await vOpt.textContent()).includes("无该项目写权限"), "F6b2：并明说原因「无该项目写权限」");
    } else {
      ok(false, "F6b：只读成员应能看到录入按钮但出处被禁用", "按钮不可用或不存在");
    }
    const vPost = await viewerCtx.request.post(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/capability-signals?orgId=${encodeURIComponent(ORG)}`,
      { data: { discoverySignalId: S3B.linkedSignalId, type: "WAREHOUSE", evidenceStatus: "CLAIMED" } },
    );
    ok(vPost.status() === 403, "F6c：直接调 API 仍是 403（供应商权限不替代项目权限）", `实际 ${vPost.status()}`);
    const vView = await apiView(viewerCtx, SUP);
    ok(vView.view?.linkedSignals?.find((s) => s.id === S3B.linkedSignalId)?.canAttachCapability === false, "F6d：服务端 canAttachCapability=false");
    await vpage.screenshot({ path: `${OUT}/f6-viewer.png` });
    await viewerCtx.close();

    /* ═════════ F7 ═════════ */
    console.log("\n== F7：他组织 → 404，不泄露 ==");
    const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(strangerCtx, S3B.strangerEmail);
    const sView = await apiView(strangerCtx, SUP, S3B.otherOrgId);
    ok(sView.status === 404, "F7a：他组织读本组织供应商 → 404", `实际 ${sView.status}`);
    ok(!sView.text.includes(S3B.supplierName) && !sView.text.includes(offName), "F7b：响应零业务内容（无供应商名、无产品名）");
    const sPage = await strangerCtx.newPage();
    await sPage.goto(evidenceUrl(SUP), { waitUntil: "domcontentloaded" });
    await waitEvidence(sPage);
    const sFatal = sPage.locator('[data-testid="workspace-fatal"]');
    ok((await sFatal.count()) === 1, "F7c：页面显示访问失败态而不是供应商内容");
    ok(!(await sPage.innerText("main")).includes(S3B.supplierName), "F7d：页面不含供应商名称");
    const sWrite = await strangerCtx.request.post(
      `${BASE}/api/supplier-intel/suppliers/${SUP}/offerings?orgId=${encodeURIComponent(S3B.otherOrgId)}`,
      { data: { name: "越权产品" } },
    );
    ok(sWrite.status() === 404, "F7e：他组织写入 → 404", `实际 ${sWrite.status()}`);
    await sPage.screenshot({ path: `${OUT}/f7-cross-org.png` });
    await strangerCtx.close();
  } finally {
    await browser.close();
  }
  console.log(`\nS3-B 浏览器验收：${pass} 通过 / ${fail} 失败`);
  console.log(`截图目录：${OUT}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  console.log(`\nS3-B 浏览器验收异常中断：${pass} 通过 / ${fail} 失败`);
  process.exit(1);
});
