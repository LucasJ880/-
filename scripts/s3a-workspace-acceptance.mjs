/**
 * S3-A 国内采购工作台 — 真实浏览器验收（Playwright）。
 *
 * 前置：dev server 跑在隔离库上（.env.local 指向隔离 Neon 分支 + SUPPLIER_INTEL_ENABLED=1），
 *       并已执行 `scripts/s3a-fixture-seed.ts` 造好演示数据（含 FR4 场景 Run）。
 *
 * 用法：
 *   S3A_BASE=http://localhost:3210 S3A_IDS=/tmp/s3a-ids.json \
 *   S3A_PASSWORD=... S3A_TAG=frwave \
 *   node scripts/s3a-workspace-acceptance.mjs
 *
 * FR4 纪律（这一版的重点）：
 *   - **没有** `|| true`，**没有** `ok(true, ...)`；
 *   - 夹具缺失 / 期望元素缺失 / 期望 Run 缺失 / 期望线索缺失 一律 FAIL，不静默跳过；
 *   - 断言走真实 UI + 真实 HTTP；写操作用 API 回读确认落库。
 *
 * 诚实声明：这里的「厂家」全部是合成夹具，**不是**真实搜到的厂家；
 * 外部搜索 provider 在本环境未接线，任何「外部来源」状态都应显示为未启用。
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.S3A_BASE || "http://localhost:3210";
const IDS_FILE = process.env.S3A_IDS || "/tmp/s3a-ids.json";
const PASSWORD = process.env.S3A_PASSWORD || "s3a-demo-pass";
const OUT = process.env.S3A_SHOT_DIR || ".s3a-screenshots";

let ids;
try {
  ids = JSON.parse(readFileSync(IDS_FILE, "utf8"));
} catch (e) {
  console.error(`无法读取夹具清单 ${IDS_FILE}：${e.message}`);
  console.error("先运行 scripts/s3a-fixture-seed.ts，并把它输出的 JSON 存到该路径。");
  process.exit(2);
}

const ORG = ids.orgId;
const EMAILS = ids.users;
const PROJECT_BY_KEY = Object.fromEntries(ids.projects.map((p) => [p.key, p.projectId]));
const RUN_BY_STATE = {};
for (const r of ids.scenarioRuns ?? []) {
  (RUN_BY_STATE[r.state] ??= []).push(r);
}

let pass = 0;
let fail = 0;
function ok(cond, name, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 夹具门：缺了就是**验收失败**，不是「跳过」。
 * 旧版本用 `if (await x.count())` 包住关键断言，夹具一坏整段静默变成绿色——这次不允许。
 */
function requireFixture(value, name) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    fail += 1;
    console.log(`  ✗ [夹具缺失] ${name} —— 验收无法进行`);
    return false;
  }
  pass += 1;
  console.log(`  ✓ [夹具就绪] ${name}`);
  return true;
}

async function requireCount(locator, name, min = 1) {
  const n = await locator.count();
  ok(n >= min, name, `实际 ${n} 个，至少需要 ${min}`);
  return n >= min;
}

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "laptop-1024x768", width: 1024, height: 768 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

async function login(context, email) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`login ${email} failed ${res.status()}`);
  const body = await res.json();
  await context.addInitScript((orgId) => {
    try {
      localStorage.setItem("qy_active_org_id", orgId);
    } catch {
      /* ignore */
    }
  }, body.activeOrgId ?? ORG);
  return body;
}

function workspaceUrl(projectId) {
  return `${BASE}/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`;
}

async function gotoWorkspace(page, projectId) {
  await page.goto(workspaceUrl(projectId), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
}

async function openTab(page, name) {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(300);
  // dev 模式 + 远端隔离库很慢：等「加载中」消失，而不是等一个猜出来的毫秒数。
  await page
    .waitForFunction(
      () => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"),
      { timeout: 90_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}

/** 等线索列表真正就位（有行 或 明确空态），而不是靠固定 sleep */
async function waitSignalList(page, timeout = 90_000) {
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("main");
        if (!main) return false;
        if (document.querySelector('[data-testid="signal-row"]')) return true;
        const t = main.innerText;
        return t.includes("还没有线索") || t.includes("当前筛选下没有线索");
      },
      { timeout },
    )
    .catch(() => {});
}

/** 直接查 API：写操作必须能在服务端读回来，不能只看界面 */
async function apiSignal(context, signalId) {
  const res = await context.request.get(
    `${BASE}/api/supplier-intel/signals/${signalId}?orgId=${encodeURIComponent(ORG)}`,
  );
  if (!res.ok()) return null;
  return (await res.json()).signal;
}

async function apiRun(context, runId) {
  const res = await context.request.get(
    `${BASE}/api/supplier-intel/runs/${runId}?orgId=${encodeURIComponent(ORG)}`,
  );
  if (!res.ok()) return null;
  return await res.json();
}

async function apiSuppliers(context, search) {
  const res = await context.request.get(
    `${BASE}/api/suppliers?orgId=${encodeURIComponent(ORG)}&search=${encodeURIComponent(search)}&pageSize=50`,
  );
  if (!res.ok()) return [];
  return (await res.json()).data ?? [];
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  console.log("\n== 夹具门（缺任何一项都直接失败）==");
  requireFixture(ORG, "orgId");
  requireFixture(EMAILS?.buyer, "采购员账号");
  requireFixture(EMAILS?.viewer, "只读账号");
  requireFixture(EMAILS?.outsider, "无本项目权限账号");
  requireFixture(PROJECT_BY_KEY.standard, "standard 项目");
  requireFixture(PROJECT_BY_KEY.custom, "custom 项目（来源多态 / 历史快照）");
  requireFixture(PROJECT_BY_KEY.install, "install 项目（恢复态）");
  requireFixture(RUN_BY_STATE.MIXED_SOURCES, "来源混合态 Run（SUCCESS+EMPTY+FAILED）");
  requireFixture(RUN_BY_STATE.EXTERNAL_DISABLED, "外部未启用 Run（全 DISABLED）");
  requireFixture(RUN_BY_STATE.V1_SNAPSHOT, "历史快照 Run（V1 需求）");
  requireFixture(RUN_BY_STATE.IDLE_PLANNED, "未执行 Run（PLANNED）");
  requireFixture(RUN_BY_STATE.RECOVERY_REQUIRED, "执行结果未知 Run（声明过期）");
  requireFixture(ids.xssSignalId, "不可信文本线索（XSS 载荷）");
  if (fail > 0) {
    console.log(`\n夹具不完整，终止验收：${pass} 通过 / ${fail} 失败`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    const buyerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(buyerCtx, EMAILS.buyer);
    const page = await buyerCtx.newPage();

    /* ═════════ E1：Tender 入口 ═════════ */
    console.log("\n== E1：从招标项目进入采购工作台 ==");
    await page.goto(`${BASE}/projects/${PROJECT_BY_KEY.standard}?tab=bid`, {
      waitUntil: "domcontentloaded",
    });
    const entry = page.locator('[data-testid="tender-sourcing-entry"]');
    await entry.waitFor({ state: "visible", timeout: 90_000 });
    ok(await entry.isVisible(), "E1a：标书与报价里有「国内采购 / 找供应商」入口");
    await entry.click();
    await page.waitForURL(/supply-chain/, { timeout: 60_000 });
    const entryUrl = new URL(page.url());
    ok(
      entryUrl.searchParams.get("projectId") === PROJECT_BY_KEY.standard,
      "E1b：入口带上了正确的 projectId",
      `实际 ${entryUrl.searchParams.get("projectId")}`,
    );
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });

    /* ═════════ E2：采购要求的真实呈现 ═════════ */
    console.log("\n== E2：中文 / 英文 / 来源 / 三值 ==");
    const reqText = await page.innerText("main");
    ok(reqText.includes("强制要求"), "E2a：显示「强制要求」");
    ok(reqText.includes("强制性待确认"), "E2b：uncertain 显示为「强制性待确认」");
    ok(reqText.includes("非强制要求"), "E2c：false 显示为「非强制要求」");
    ok(!reqText.includes("可选要求"), "E2d：uncertain / false 都不得显示成「可选」");
    ok(reqText.includes("未提取"), "E2e：缺失字段显示「未提取」");
    ok(reqText.includes("ANSI/BIFMA X5.1"), "E2f：保留英文原文");
    ok(!/认证通过|本标合格|首选供应商|可下单/.test(reqText), "E2g：不出现采购批准类措辞");
    await requireCount(page.locator("text=来源"), "E2h：要求带来源定位");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/requirements-${vp.name}.png` });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      ok(!overflow, `E2i：${vp.name} 无横向溢出`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    /* ═════════ E11：FR3-F 复核入口可点，且能回来 ═════════ */
    console.log("\n== E11：招标要求复核入口（FR3-F）==");
    const gotoReq = page.locator('[data-testid="goto-requirements"]');
    ok(await gotoReq.count() === 1, "E11a：工作台上有真实可点的复核入口");
    await gotoReq.click();
    await page.waitForURL(/tab=requirements/, { timeout: 60_000 });
    ok(page.url().includes("from=supply-chain"), "E11b：带上了来处标记");
    const backBtn = page.locator('[data-testid="back-to-supply-chain"]');
    await backBtn.waitFor({ state: "visible", timeout: 60_000 });
    ok(await backBtn.isVisible(), "E11c：招标要求页给出「返回国内采购工作台」");
    await backBtn.click();
    await page.waitForURL(/supply-chain/, { timeout: 60_000 });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    const backUrl = new URL(page.url());
    ok(
      backUrl.searchParams.get("projectId") === PROJECT_BY_KEY.standard,
      "E11d：回到的是同一个项目的工作台",
    );

    /* ═════════ E10：不可信文本 ═════════ */
    console.log("\n== E10：不可信文本按字面渲染 ==");
    const xssSignal = await apiSignal(buyerCtx, ids.xssSignalId);
    ok(Boolean(xssSignal), "E10a：XSS 夹具线索可读取");
    ok(
      typeof xssSignal?.rawText === "string" && /<img\s+src=x\s+onerror=/.test(xssSignal.rawText),
      "E10b：夹具里确实存着 <img src=x onerror=…> 载荷（先证明测试有料）",
      `实际 rawText=${String(xssSignal?.rawText).slice(0, 80)}`,
    );
    await openTab(page, "供应商线索");
    await waitSignalList(page);
    const xssRow = page.locator(`[data-testid="signal-row"][data-signal-id="${ids.xssSignalId}"]`);
    const xssVisible = await xssRow.count();
    ok(xssVisible === 1, "E10c：该线索出现在收件箱里", `实际 ${xssVisible} 条`);
    if (xssVisible === 1) {
      await xssRow.click();
      await page.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
      await page.locator('[data-testid="signal-rawtext"] summary').click();
      await page.waitForTimeout(300);
      const drawerText = await page.locator('[data-testid="signal-drawer"]').innerText();
      ok(drawerText.includes("<img src=x onerror="), "E10d：载荷以字面文本显示出来");
      ok((await page.locator('img[src="x"]').count()) === 0, "E10e：DOM 里没有被解析出的 img[src=x]");
      ok(
        (await page.evaluate(() => document.querySelectorAll("script:not([src])").length === 0 ||
          ![...document.querySelectorAll("script:not([src])")].some((s) => s.textContent?.includes("alert(2)")))),
        "E10f：载荷里的 <script> 没有变成真的脚本节点",
      );
      ok(
        drawerText.includes("系统不会自动抓取页面内容"),
        "E10g：明示不自动抓取、不把内容链接当官网",
      );
      await page.screenshot({ path: `${OUT}/signal-untrusted-text.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    /* ═════════ E5：手工线索 → 人工检索 → 明确 LINK ═════════ */
    console.log("\n== E5：添加线索 → 已查看 → 人工找供应商 → 关联 ==");
    const leadTag = `E5-${Date.now()}`;
    await page.locator('[data-testid="add-signal-open"]').click();
    await page.locator('[data-testid="add-signal-text"]').fill(`${leadTag} 佛山演示厂家，做过办公椅。`);
    await page.locator('[data-testid="add-signal-submit"]').click();
    const newRow = page.locator('[data-testid="signal-row"]').filter({ hasText: leadTag });
    await newRow.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    const newRowCount = await newRow.count();
    ok(newRowCount === 1, "E5a：新线索出现在收件箱", `实际 ${newRowCount} 条`);
    if (newRowCount !== 1) throw new Error("E5 中断：新建线索未出现，后续断言无意义");
    const leadSignalId = await newRow.first().getAttribute("data-signal-id");
    const leadFresh = await apiSignal(buyerCtx, leadSignalId);
    ok(leadFresh?.status === "NEW", "E5b：服务端确认状态 NEW", `实际 ${leadFresh?.status}`);

    await newRow.first().click();
    await page.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
    await page.locator('[data-testid="signal-review"]').click();
    await page.waitForTimeout(4000);
    const afterReview = await apiSignal(buyerCtx, leadSignalId);
    ok(afterReview?.status === "REVIEWED", "E5c：标记已查看后服务端为 REVIEWED", `实际 ${afterReview?.status}`);

    // FR3-B：人工按名字找——不依赖 AI 能否猜出公司名
    const existingSuppliers = await apiSuppliers(buyerCtx, "演示家具");
    ok(existingSuppliers.length > 0, "E5d：供应商库里有可供关联的既有记录（夹具）");
    const targetSupplier = existingSuppliers[0];
    await page.locator('[data-testid="manual-search-input"]').fill("演示家具");
    await page.locator('[data-testid="manual-search-go"]').click();
    const results = page.locator('[data-testid="manual-search-results"] li');
    await results.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    const okResults = await requireCount(results, "E5e：人工检索有结果");
    if (!okResults) throw new Error("E5 中断：人工检索没有结果");
    const linkBtn = page
      .locator(`[data-testid="link-supplier"][data-supplier-id="${targetSupplier.id}"]`)
      .first();
    ok((await linkBtn.count()) >= 1, "E5f：检索结果里能点「关联这家供应商」");
    await linkBtn.click();
    await page.waitForTimeout(4500);
    const afterLink = await apiSignal(buyerCtx, leadSignalId);
    ok(afterLink?.status === "LINKED", "E5g：服务端确认 LINKED", `实际 ${afterLink?.status}`);
    ok(
      afterLink?.linkedSupplierId === targetSupplier.id,
      "E5h：关联到的是人工选中的那一家",
      `实际 ${afterLink?.linkedSupplierId}`,
    );

    // 刷新后仍然 LINKED（不是只在内存里）
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    await openTab(page, "供应商线索");
    await waitSignalList(page);
    const relinked = page.locator(`[data-testid="signal-row"][data-signal-id="${leadSignalId}"]`);
    ok((await relinked.count()) === 1, "E5i：刷新后线索仍在列表");
    ok(
      (await relinked.first().getAttribute("data-signal-status")) === "LINKED",
      "E5j：刷新后状态仍是 LINKED",
    );
    await page.screenshot({ path: `${OUT}/signal-linked.png` });

    /* ═════════ E6：库里没有 → 新建 → 回到线索 → 人工关联（含失败重试）═════════ */
    console.log("\n== E6：新建供应商 → 回到本线索 → 人工关联 ==");
    const createTag = `E6-${Date.now()}`;
    await page.locator('[data-testid="add-signal-open"]').click();
    await page.locator('[data-testid="add-signal-text"]').fill(`${createTag} 库里没有的新厂家。`);
    await page.locator('[data-testid="add-signal-submit"]').click();
    const createRow = page.locator('[data-testid="signal-row"]').filter({ hasText: createTag });
    await createRow.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    ok((await createRow.count()) === 1, "E6a：新线索已建立");
    if ((await createRow.count()) !== 1) throw new Error("E6 中断：新建线索未出现");
    const createSignalId = await createRow.first().getAttribute("data-signal-id");
    await createRow.first().click();
    await page.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });

    const newSupplierName = `E6 新建演示供应商 ${createTag}`;
    await page.locator('[data-testid="create-supplier-open"]').click();
    await page.locator('[data-testid="create-supplier-name"]').fill(newSupplierName);

    // 先让第一次 link 失败一次，验证「建档保留 + 重试关联不会重复建档」
    let failNextLink = true;
    await page.route(`**/api/supplier-intel/signals/${createSignalId}?**`, async (route) => {
      if (route.request().method() === "PATCH" && failNextLink) {
        failNextLink = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "演示：关联时网络中断" }),
        });
        return;
      }
      await route.continue();
    });

    await page.locator('[data-testid="create-supplier-go"]').click();
    await page.locator('[data-testid="created-supplier"]').waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    const createdBox = page.locator('[data-testid="created-supplier"]');
    ok((await createdBox.count()) === 1, "E6b：建档后停留在本线索，且直接可选");
    const createdAfterCreate = await apiSuppliers(buyerCtx, newSupplierName);
    ok(createdAfterCreate.length === 1, "E6c：canonical 供应商已建档 1 家", `实际 ${createdAfterCreate.length}`);
    const linkedAtCreate = await apiSignal(buyerCtx, createSignalId);
    ok(
      linkedAtCreate?.status !== "LINKED",
      "E6d：建档**不会**自动关联（关联仍需人点）",
      `实际 ${linkedAtCreate?.status}`,
    );

    // 第一次关联：被拦成 503
    await createdBox.locator('[data-testid="link-supplier"]').click();
    await page.waitForTimeout(4000);
    const afterFailedLink = await apiSignal(buyerCtx, createSignalId);
    ok(afterFailedLink?.status !== "LINKED", "E6e：关联失败时状态未变");
    ok((await createdBox.count()) === 1, "E6f：失败后仍保留刚建的供应商（不需要重新建档）");

    // 重试：这次放行
    await createdBox.locator('[data-testid="link-supplier"]').click();
    await page.waitForTimeout(4500);
    const afterRetry = await apiSignal(buyerCtx, createSignalId);
    ok(afterRetry?.status === "LINKED", "E6g：重试后成功关联", `实际 ${afterRetry?.status}`);
    const suppliersAfterRetry = await apiSuppliers(buyerCtx, newSupplierName);
    ok(
      suppliersAfterRetry.length === 1,
      "E6h：重试关联没有第二次建档（无重复 Supplier）",
      `实际 ${suppliersAfterRetry.length} 家`,
    );
    ok(
      afterRetry?.linkedSupplierId === createdAfterCreate[0]?.id,
      "E6i：关联到的正是刚建的那一家",
    );
    await page.unroute(`**/api/supplier-intel/signals/${createSignalId}?**`);
    await page.screenshot({ path: `${OUT}/signal-create-then-link.png` });

    /* ═════════ E3 / E4：来源五态 + 内部候选可见 ═════════ */
    console.log("\n== E3/E4：来源状态与内部候选（custom 项目）==");
    await gotoWorkspace(page, PROJECT_BY_KEY.custom);
    await openTab(page, "搜索记录");
    await page.waitForSelector('[data-testid="run-card"]', { timeout: 60_000 });

    const mixedRunId = RUN_BY_STATE.MIXED_SOURCES[0].runId;
    const mixedCard = page.locator(`[data-testid="run-card"][data-run-id="${mixedRunId}"]`);
    ok((await mixedCard.count()) === 1, "E3a：混合来源 Run 卡片可见");
    const mixedText = await mixedCard.innerText();
    ok(mixedText.includes("搜索已结束"), "E3b：COMPLETED 说「搜索已结束」");
    ok(!/全部来源(搜索)?成功/.test(mixedText), "E3c：不把「结束」翻译成「全部成功」");
    ok(/部分来源失败/.test(mixedText), "E3d：有失败来源时明确说「部分来源失败」");
    ok(mixedText.includes("有结果"), "E3e：SUCCESS 来源可辨认", mixedText.slice(0, 200));
    ok(mixedText.includes("无结果"), "E3f：EMPTY 来源可辨认");
    ok(mixedText.includes("该来源失败"), "E3g：FAILED 来源可辨认");
    ok(
      mixedText.includes("有结果") &&
        mixedText.includes("无结果") &&
        mixedText.includes("该来源失败"),
      "E3g2：SUCCESS / EMPTY / FAILED 三态同时可区分，没有被合并成一句",
    );

    const disabledRunId = RUN_BY_STATE.EXTERNAL_DISABLED[0].runId;
    const disabledCard = page.locator(`[data-testid="run-card"][data-run-id="${disabledRunId}"]`);
    ok((await disabledCard.count()) === 1, "E3h：外部未启用 Run 卡片可见");
    const disabledText = await disabledCard.innerText();
    ok(disabledText.includes("未启用"), "E3i：DISABLED 如实标注「未启用」");

    // FR3-E：计划词 ≠ 实发词
    const qDetails = disabledCard.locator('[data-testid="run-queries"]');
    if ((await qDetails.count()) === 1) {
      ok(
        (await qDetails.innerText()).includes("计划搜索词"),
        "E3j：搜索词标题是「计划搜索词」，不是「实际使用的搜索词」",
      );
      await qDetails.locator("summary").click();
      await page.waitForTimeout(300);
      ok(
        (await qDetails.innerText()).includes("一条都没有真的发出去"),
        "E3k：外部未执行时明说这些词没发出去",
      );
    } else {
      ok(
        (await disabledCard.innerText()).includes("没有记录到计划搜索词"),
        "E3j：没有计划词时如实说明（不留空白）",
      );
    }

    // E4：内部候选必须点得开、看得见是哪几家
    const mixedDetail = await apiRun(buyerCtx, mixedRunId);
    ok((mixedDetail?.counts?.candidates ?? 0) > 0, "E4a：这次搜索确实有内部候选（夹具前提）");
    const internalBox = mixedCard.locator('[data-testid="internal-candidates"]');
    ok((await internalBox.count()) === 1, "E4b：卡片上有「内部找到的供应商」");
    await internalBox.locator("summary").click();
    const candItems = internalBox.locator('[data-testid="internal-candidate"]');
    await candItems.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    const candOk = await requireCount(candItems, "E4c：能列出具体的候选供应商");
    if (candOk) {
      const firstCandText = await candItems.first().innerText();
      ok(firstCandText.trim().length > 0, "E4d：候选带名字");
      const apiNames = (mixedDetail.candidates ?? []).map((c) => c.name);
      ok(
        apiNames.some((n) => n && firstCandText.includes(n)),
        "E4e：界面上的名字与 SupplierCandidate 真表一致",
        `界面「${firstCandText.slice(0, 40)}」 vs API ${JSON.stringify(apiNames)}`,
      );
      const boxText = await internalBox.innerText();
      ok(
        !/推荐供应商|合格供应商|首选/.test(boxText),
        "E4f：不称其为推荐 / 合格 / 首选",
      );
    }
    // 内部候选不得被复制成假线索
    const runSignalsRes = await buyerCtx.request.get(
      `${BASE}/api/supplier-intel/signals?orgId=${encodeURIComponent(ORG)}&projectId=${encodeURIComponent(PROJECT_BY_KEY.custom)}&searchRunId=${encodeURIComponent(mixedRunId)}`,
    );
    const runSignals = runSignalsRes.ok() ? (await runSignalsRes.json()).signals ?? [] : [];
    const candidateNames = new Set((mixedDetail.candidates ?? []).map((c) => c.name));
    ok(
      !runSignals.some((s) => candidateNames.has(s.accountName) || candidateNames.has(s.title)),
      "E4g：内部候选没有被复制成 Signal（两张表语义不混）",
    );
    await page.screenshot({ path: `${OUT}/runs-sources-and-candidates.png` });

    /* ═════════ E7：历史快照 ═════════ */
    console.log("\n== E7：历史 Run 只显示它自己的快照 ==");
    const v1RunId = RUN_BY_STATE.V1_SNAPSHOT[0].runId;
    const v1Card = page.locator(`[data-testid="run-card"][data-run-id="${v1RunId}"]`);
    ok((await v1Card.count()) === 1, "E7a：历史 Run 卡片可见");
    const snapBox = v1Card.locator('[data-testid="run-requirement-snapshot"]');
    ok((await snapBox.count()) === 1, "E7b：可以查看当时的采购要求");
    await snapBox.locator("summary").click();
    await page.waitForTimeout(500);
    const snapText = await snapBox.innerText();
    ok(snapText.length > 0, "E7c：快照内容非空");
    ok(
      !snapText.includes("仅 V2 才有的新要求"),
      "E7d：不混入当前最新需求（V2 的新要求不得出现在旧 Run 里）",
    );
    ok(
      (await v1Card.innerText()).includes("基于旧版需求"),
      "E7e：明确提示这次搜索基于旧版需求",
    );
    const briefBox = v1Card.locator('[data-testid="run-brief-snapshot"]');
    ok((await briefBox.count()) === 1, "E7f：可以查看当时的搜索简报");
    await page.screenshot({ path: `${OUT}/run-historical-snapshot.png` });

    /* ═════════ E8：FR1 恢复 / 取消 / 不重复执行 ═════════ */
    console.log("\n== E8：未收尾搜索的恢复出口 ==");
    await gotoWorkspace(page, PROJECT_BY_KEY.install);
    await openTab(page, "搜索记录");
    await page.waitForSelector('[data-testid="run-card"]', { timeout: 60_000 });

    const staleRunId = RUN_BY_STATE.RECOVERY_REQUIRED[0].runId;
    const staleCard = page.locator(`[data-testid="run-card"][data-run-id="${staleRunId}"]`);
    ok((await staleCard.count()) === 1, "E8a：结果未知的 Run 卡片可见");
    ok(
      (await staleCard.getAttribute("data-exec-state")) === "RECOVERY_REQUIRED",
      "E8b：执行态判定为 RECOVERY_REQUIRED",
      `实际 ${await staleCard.getAttribute("data-exec-state")}`,
    );
    const staleText = await staleCard.innerText();
    ok(staleText.includes("结果无法确认"), "E8c：明说结果无法确认（不谎称还在跑）");
    ok(
      (await staleCard.locator('[data-testid="card-resume"]').count()) === 0,
      "E8d：结果未知时**不给**「继续执行」（不自动接管）",
    );
    ok(
      (await staleCard.locator('[data-testid="card-cancel"]').count()) === 1,
      "E8e：给出「取消」这条明确出路",
    );

    const plannedRunId = RUN_BY_STATE.IDLE_PLANNED[0].runId;
    const plannedCard = page.locator(`[data-testid="run-card"][data-run-id="${plannedRunId}"]`);
    ok((await plannedCard.count()) === 1, "E8f：未执行的 Run 卡片可见");
    ok(
      (await plannedCard.getAttribute("data-exec-state")) === "IDLE",
      "E8g：未执行的 Run 是 IDLE",
    );
    ok(
      (await plannedCard.locator('[data-testid="card-resume"]').count()) === 1,
      "E8h：未执行时给「继续执行」",
    );
    await page.screenshot({ path: `${OUT}/run-recovery-states.png` });

    // 取消结果未知的那次
    await staleCard.locator('[data-testid="card-cancel"]').click();
    let staleAfter = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1500);
      staleAfter = await apiRun(buyerCtx, staleRunId);
      if (staleAfter?.run?.status === "CANCELLED") break;
    }
    ok(staleAfter?.run?.status === "CANCELLED", "E8i：取消后服务端为 CANCELLED", `实际 ${staleAfter?.run?.status}`);
    ok(staleAfter?.executionState === "TERMINAL", "E8j：终态不可重入");

    // 继续执行未执行的那次，并验证不会重复执行
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    await openTab(page, "搜索记录");
    const plannedCard2 = page.locator(`[data-testid="run-card"][data-run-id="${plannedRunId}"]`);
    await plannedCard2.locator('[data-testid="card-resume"]').click();

    // 执行期间**立刻**重复提交一次：此时声明仍然有效，必须被 409 挡住（不会跑两轮 provider）
    await page.waitForTimeout(1500);
    const dupDuringRes = await buyerCtx.request.post(
      `${BASE}/api/supplier-intel/runs/${plannedRunId}/discover?orgId=${encodeURIComponent(ORG)}`,
      { data: {} },
    );
    ok(
      dupDuringRes.status() === 409,
      "E8l：执行进行中时重复提交被拒（409）",
      `实际 ${dupDuringRes.status()}`,
    );

    let resumed = null;
    for (let i = 0; i < 60; i++) {
      resumed = await apiRun(buyerCtx, plannedRunId);
      if (["COMPLETED", "FAILED"].includes(resumed?.run?.status)) break;
      await page.waitForTimeout(2000);
    }
    ok(
      ["COMPLETED", "FAILED"].includes(resumed?.run?.status),
      "E8k：继续执行后收口到终态",
      `实际 ${resumed?.run?.status}`,
    );
    const candidatesAfterFirst = resumed?.counts?.candidates ?? 0;

    // 收口之后再发一次——终态不可重入
    const dupRes = await buyerCtx.request.post(
      `${BASE}/api/supplier-intel/runs/${plannedRunId}/discover?orgId=${encodeURIComponent(ORG)}`,
      { data: {} },
    );
    ok(dupRes.status() === 409, "E8l2：收口后重复执行被拒（409）", `实际 ${dupRes.status()}`);
    const afterDup = await apiRun(buyerCtx, plannedRunId);
    ok(
      (afterDup?.counts?.candidates ?? 0) === candidatesAfterFirst,
      "E8m：重复请求没有产生第二轮结果",
      `${afterDup?.counts?.candidates} vs ${candidatesAfterFirst}`,
    );

    /* ═════════ E9：FR2 竞态 ═════════ */
    console.log("\n== E9：慢响应 + 切换上下文，旧响应不得污染新界面 ==");
    // ① 同一挂载内的乱序响应：切到「待查看」（慢）→ 立刻切到「已关联」（快）→ 慢响应后到。
    //    关键是**面板不卸载**：切页签会卸载 SignalsPanel，卸载时的 abort 会顺手掩盖归属判定，
    //    那样写出来的用例即使把 FR2 校验删掉也照样绿（已用负向控制验证过）。
    const filterPage = await buyerCtx.newPage();
    await filterPage.goto(workspaceUrl(PROJECT_BY_KEY.custom), { waitUntil: "domcontentloaded" });
    await filterPage.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    await openTab(filterPage, "供应商线索");
    await waitSignalList(filterPage);

    // 先证明这个用例有料：NEW 筛选确实有行，LINKED 确实没有
    const newCountRes = await buyerCtx.request.get(
      `${BASE}/api/supplier-intel/signals?orgId=${encodeURIComponent(ORG)}&projectId=${encodeURIComponent(PROJECT_BY_KEY.custom)}&status=NEW`,
    );
    const linkedCountRes = await buyerCtx.request.get(
      `${BASE}/api/supplier-intel/signals?orgId=${encodeURIComponent(ORG)}&projectId=${encodeURIComponent(PROJECT_BY_KEY.custom)}&status=LINKED`,
    );
    const newTotal = newCountRes.ok() ? (await newCountRes.json()).total ?? 0 : 0;
    const linkedTotal = linkedCountRes.ok() ? (await linkedCountRes.json()).total ?? 0 : 0;
    ok(newTotal > 0, "E9a：慢筛选（待查看）确实有结果", `实际 ${newTotal}`);
    ok(linkedTotal === 0, "E9a2：新筛选（已关联）本应为空", `实际 ${linkedTotal}`);

    await filterPage.route(
      (url) =>
        url.pathname === "/api/supplier-intel/signals" && url.searchParams.get("status") === "NEW",
      async (route) => {
        await new Promise((r) => setTimeout(r, 7000));
        await route.continue();
      },
    );
    await filterPage.getByRole("button", { name: "待查看", exact: true }).click();
    await filterPage.waitForTimeout(800);
    await filterPage.getByRole("button", { name: "已关联", exact: true }).click();
    await filterPage.waitForTimeout(20000); // dev 每个请求还要 3-4s，等慢响应确实回来

    const pressed = await filterPage
      .getByRole("button", { name: "已关联", exact: true })
      .getAttribute("aria-pressed");
    ok(pressed === "true", "E9b：界面停在「已关联」筛选");
    const contaminated = await filterPage.locator('[data-testid="signal-row"]').count();
    ok(
      contaminated === 0,
      "E9b2：旧筛选的慢响应没有污染新筛选的列表",
      `「已关联」本应为空，实际显示 ${contaminated} 条`,
    );
    await filterPage.screenshot({ path: `${OUT}/race-filter-switch.png` });
    await filterPage.close();

    // 整页跳转下的回归检查（不是竞态：整页导航会销毁旧上下文）
    const navPage = await buyerCtx.newPage();
    await navPage.goto(workspaceUrl(PROJECT_BY_KEY.custom), { waitUntil: "domcontentloaded" });
    await navPage.goto(workspaceUrl(PROJECT_BY_KEY.install), { waitUntil: "domcontentloaded" });
    await navPage.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    await openTab(navPage, "搜索记录");
    await navPage.waitForSelector('[data-testid="run-card"]', { timeout: 60_000 });
    const navRunIds = await navPage
      .locator('[data-testid="run-card"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-run-id")));
    const customRunIds = new Set(
      (ids.scenarioRuns ?? []).filter((r) => r.key === "custom").map((r) => r.runId),
    );
    ok(navRunIds.length > 0, "E9a3：切换后的项目渲染出自己的搜索记录");
    ok(
      !navRunIds.some((id) => customRunIds.has(id)),
      "E9a4：换项目后列表里没有上一个项目的 Run",
      `实际 ${JSON.stringify(navRunIds)}`,
    );
    await navPage.close();

    // ② 线索 A 的身份核对被拖慢 → 打开线索 B → A 的响应回来
    // 竞态验证需要两条**可处理**线索；自己造，不依赖前面用例留下的残留状态
    const raceTag = `E9-${Date.now()}`;
    for (const n of [1, 2]) {
      const created = await buyerCtx.request.post(
        `${BASE}/api/supplier-intel/signals?orgId=${encodeURIComponent(ORG)}`,
        {
          data: {
            rawText: `${raceTag}-${n} 竞态验证用合成线索`,
            manualEntry: true,
            projectId: PROJECT_BY_KEY.standard,
          },
        },
      );
      ok(created.ok(), `E9-pre${n}：竞态用线索已创建`, `HTTP ${created.status()}`);
    }

    const racePage = await buyerCtx.newPage();
    await racePage.goto(workspaceUrl(PROJECT_BY_KEY.standard), { waitUntil: "domcontentloaded" });
    await racePage.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
    await openTab(racePage, "供应商线索");
    await waitSignalList(racePage);
    // 只有未关联/未拒绝的线索才有「核对身份」按钮——竞态验证必须挑这类
    const rows = racePage.locator(
      '[data-testid="signal-row"][data-signal-status="NEW"], [data-testid="signal-row"][data-signal-status="REVIEWED"]',
    );
    const rowCount = await rows.count();
    ok(rowCount >= 2, "E9c：至少有两条可处理线索用于竞态验证", `实际 ${rowCount}`);
    if (rowCount >= 2) {
      const idA = await rows.nth(0).getAttribute("data-signal-id");
      const idB = await rows.nth(1).getAttribute("data-signal-id");
      await racePage.route(`**/api/supplier-intel/signals/${idA}/resolve**`, async (route) => {
        await new Promise((r) => setTimeout(r, 6000));
        await route.continue();
      });
      await rows.nth(0).click();
      await racePage.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
      const checkBtn = racePage.locator('[data-testid="check-identity"]');
      if ((await checkBtn.count()) === 1) {
        await checkBtn.click();
        await racePage.waitForTimeout(800);
        // 还没回来就切到 B
        await racePage.keyboard.press("Escape");
        await racePage.waitForTimeout(400);
        await rows.nth(1).click();
        await racePage.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
        const openedId = await racePage
          .locator('[data-testid="signal-drawer"]')
          .getAttribute("data-signal-id");
        ok(openedId === idB, "E9d：抽屉里现在是线索 B");
        await racePage.waitForTimeout(7000); // A 的慢响应此刻已经回来
        const stillId = await racePage
          .locator('[data-testid="signal-drawer"]')
          .getAttribute("data-signal-id");
        ok(stillId === idB, "E9e：A 的迟到响应没有把抽屉换回 A", `实际 ${stillId}`);
        ok(
          (await racePage.locator('[data-testid="resolution-box"]').count()) === 0,
          "E9f：A 的候选供应商没有出现在 B 的抽屉里",
        );
        await racePage.screenshot({ path: `${OUT}/race-signal-switch.png` });
      } else {
        ok(false, "E9d：线索 A 不可核对身份（夹具状态不符合竞态验证前提）");
      }

      // ③ 保存 → 立刻关抽屉 → 响应回来，抽屉不得自己弹回来
      await racePage.keyboard.press("Escape");
      await racePage.waitForTimeout(500);
      const openRows = racePage.locator('[data-testid="signal-row"][data-signal-status="NEW"]');
      if ((await openRows.count()) >= 1) {
        await openRows.first().click();
        await racePage.waitForSelector('[data-testid="signal-drawer"]', { timeout: 30_000 });
        const targetId = await racePage
          .locator('[data-testid="signal-drawer"]')
          .getAttribute("data-signal-id");
        await racePage.route(`**/api/supplier-intel/signals/${targetId}?**`, async (route) => {
          if (route.request().method() === "GET") {
            await new Promise((r) => setTimeout(r, 5000));
          }
          await route.continue();
        });
        await racePage.locator('[data-testid="signal-review"]').click();
        await racePage.waitForTimeout(500);
        await racePage.keyboard.press("Escape"); // 立刻关掉
        await racePage.waitForTimeout(6500);
        ok(
          (await racePage.locator('[data-testid="signal-drawer"]').count()) === 0,
          "E9g：写后刷新的迟到响应没有把已关闭的抽屉重新拉回来",
        );
      } else {
        ok(false, "E9g：没有 NEW 状态线索可用于「关抽屉」竞态验证");
      }
    }
    await racePage.close();

    /* ═════════ 权限：只读 / 无权限 / 无项目上下文 ═════════ */
    console.log("\n== 权限边界 ==");
    const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(viewerCtx, EMAILS.viewer);
    const vPage = await viewerCtx.newPage();
    await gotoWorkspace(vPage, PROJECT_BY_KEY.standard);
    const vText = await vPage.innerText("main");
    ok(vText.includes("采购要求"), "P1：只读用户能看到采购要求");
    await openTab(vPage, "供应商线索");
    const vInbox = await vPage.innerText("main");
    ok(!vInbox.includes("添加厂家线索"), "P2：只读用户看不到「添加厂家线索」");
    await openTab(vPage, "搜索记录");
    ok(
      (await vPage.locator('[data-testid="card-cancel"]').count()) === 0,
      "P3：只读用户看不到取消按钮",
    );
    await vPage.screenshot({ path: `${OUT}/viewer-readonly.png` });

    const outCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(outCtx, EMAILS.outsider);
    const oPage = await outCtx.newPage();
    await oPage.goto(workspaceUrl(PROJECT_BY_KEY.standard), { waitUntil: "domcontentloaded" });
    await oPage
      .waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), {
        timeout: 90_000,
      })
      .catch(() => {});
    await oPage.waitForTimeout(1500);
    const oText = await oPage.innerText("main");
    ok(
      /没有该项目的访问权限|无权查看|项目不存在/.test(oText),
      "P4：无权限用户看到明确的无权限状态",
      oText.slice(0, 200),
    );
    ok(!oText.includes("ANSI/BIFMA"), "P5：无权限用户看不到任何要求内容");
    await oPage.screenshot({ path: `${OUT}/forbidden.png` });

    const bare = await buyerCtx.newPage();
    await bare.goto(`${BASE}/projects/intelligence/supply-chain`, { waitUntil: "domcontentloaded" });
    await bare
      .waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), {
        timeout: 90_000,
      })
      .catch(() => {});
    await bare.waitForTimeout(1500);
    const bareText = await bare.innerText("main");
    ok(bareText.includes("请从具体的招标项目进入"), "P6：无项目上下文时给出明确引导");
    ok(!bareText.includes("ANSI/BIFMA"), "P7：无项目上下文时不泄露任何项目数据");
    await bare.screenshot({ path: `${OUT}/no-project.png` });

    console.log(`\nS3-A 浏览器验收：${pass} 通过 / ${fail} 失败`);
    console.log(`截图目录：${OUT}`);
  } finally {
    await browser.close();
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
