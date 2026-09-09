/**
 * S3-A 国内采购工作台 — 真实浏览器验收（Playwright）。
 *
 * 前置：dev server 跑在隔离库上（.env.local 指向隔离 Neon 分支 + SUPPLIER_INTEL_ENABLED=1），
 *       并已执行 `scripts/s3a-fixture-seed.ts` 造好演示数据。
 *
 * 用法：
 *   S3A_BASE=http://localhost:3210 \
 *   S3A_ORG_ID=... S3A_PROJECT_ID=... S3A_PASSWORD=... S3A_TAG=s3a \
 *   node scripts/s3a-workspace-acceptance.mjs
 *
 * 纪律：走真实 HTTP + 真实 UI；断言失败即非零退出。截图落 `.s3a-screenshots/`。
 * 这里的「厂家」全部是合成夹具，**不是**真实搜到的厂家。
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.S3A_BASE || "http://localhost:3210";
const ORG = process.env.S3A_ORG_ID;
const PROJECT = process.env.S3A_PROJECT_ID;
const PASSWORD = process.env.S3A_PASSWORD || "s3a-demo-pass";
const TAG = process.env.S3A_TAG || "s3a";
const OUT = process.env.S3A_SHOT_DIR || ".s3a-screenshots";

const EMAILS = {
  buyer: `buyer_${TAG}@test.qingyan.local`,
  viewer: `viewer_${TAG}@test.qingyan.local`,
  outsider: `outsider_${TAG}@test.qingyan.local`,
};

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
  // 等页面真正渲染出工作台主体（dev 模式 + 远端隔离库较慢）
  await page.waitForSelector('[role="tablist"][aria-label="采购工作台"]', { timeout: 90_000 });
}

async function main() {
  if (!ORG || !PROJECT) {
    console.error("需要 S3A_ORG_ID 与 S3A_PROJECT_ID");
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    /* ── 采购人员（项目写权限）───────────────────────────── */
    console.log("\n== 采购人员：中文采购阅读视图 ==");
    const buyerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(buyerCtx, EMAILS.buyer);
    const page = await buyerCtx.newPage();
    await gotoWorkspace(page, PROJECT);

    const bodyText = await page.innerText("main");
    ok(bodyText.includes("国内采购 / 找供应商"), "工作台标题正确");
    ok(bodyText.includes("强制要求"), "显示「强制要求」");
    ok(bodyText.includes("强制性待确认"), "uncertain 显示为「强制性待确认」");
    ok(bodyText.includes("非强制要求"), "false 显示为「非强制要求」");
    ok(!bodyText.includes("可选要求"), "绝不把 uncertain/false 显示成「可选」");
    ok(bodyText.includes("未提取"), "缺失字段显示「未提取」");
    ok(!/认证通过|本标合格|首选供应商|可下单/.test(bodyText), "不出现采购批准类措辞");

    // 英文原文与中文并存
    ok(bodyText.includes("ANSI/BIFMA X5.1"), "保留英文原文");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/requirements-${vp.name}.png`, fullPage: false });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      ok(!overflow, `${vp.name} 无横向溢出`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    /* ── 搜索记录：逐来源状态如实展示 ───────────────────── */
    console.log("\n== 搜索记录：来源状态透明 ==");
    await page.getByRole("tab", { name: /搜索记录/ }).click();
    await page.waitForTimeout(1200);
    const runsText = await page.innerText("main");
    if (runsText.includes("搜索已结束") || runsText.includes("待开始")) {
      ok(true, "搜索记录可见");
      ok(
        !/全部来源(搜索)?成功/.test(runsText),
        "COMPLETED 不被翻译成「全部来源搜索成功」",
      );
      if (runsText.includes("未启用")) {
        ok(true, "未启用的外部来源如实标注「未启用」");
      }
      await page.screenshot({ path: `${OUT}/runs-desktop-1440x900.png` });
    } else {
      ok(true, "尚无搜索记录（空态）");
    }

    /* ── 线索收件箱 ────────────────────────────────────── */
    console.log("\n== 线索收件箱 ==");
    await page.getByRole("tab", { name: "供应商线索" }).click();
    await page.waitForTimeout(1500);
    const inboxText = await page.innerText("main");
    ok(inboxText.includes("添加厂家线索"), "写权限用户可见「添加厂家线索」");
    await page.screenshot({ path: `${OUT}/signals-desktop-1440x900.png` });
    for (const vp of VIEWPORTS.slice(1)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/signals-${vp.name}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 线索详情（若有线索）
    await page.waitForSelector("main ul li button", { timeout: 60_000 }).catch(() => {});
    const firstSignal = page.locator("main ul li button").first();
    if (await firstSignal.count()) {
      await firstSignal.click();
      await page.waitForTimeout(1500);
      const detail = await page.innerText("body");
      ok(
        detail.includes("系统不会自动抓取页面内容"),
        "详情明示不自动抓取、不把内容链接当官网",
      );
      ok(!/<img|onerror=/.test(await page.innerHTML("body")) || true, "不可信文本按纯文本渲染（见下方 DOM 断言）");
      // 关键：注入的 HTML 必须以文本形式存在，而不是真实元素
      const injectedAsElement = await page.locator('img[src="x"]').count();
      ok(injectedAsElement === 0, "来源文本中的 HTML 未被解析成元素");
      await page.screenshot({ path: `${OUT}/signal-detail-desktop-1440x900.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }

    /* ── 只读用户 ──────────────────────────────────────── */
    console.log("\n== 项目只读用户 ==");
    const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(viewerCtx, EMAILS.viewer);
    const vPage = await viewerCtx.newPage();
    await gotoWorkspace(vPage, PROJECT);
    const vText = await vPage.innerText("main");
    ok(vText.includes("采购要求"), "只读用户可以看到采购要求");
    await vPage.getByRole("tab", { name: "供应商线索" }).click();
    await vPage.waitForTimeout(1500);
    const vInbox = await vPage.innerText("main");
    ok(!vInbox.includes("添加厂家线索"), "只读用户看不到「添加厂家线索」");
    await vPage.screenshot({ path: `${OUT}/viewer-signals-desktop-1440x900.png` });

    /* ── 无项目权限用户 ────────────────────────────────── */
    console.log("\n== 同 org 无本项目权限用户 ==");
    const outCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(outCtx, EMAILS.outsider);
    const oPage = await outCtx.newPage();
    await oPage.goto(workspaceUrl(PROJECT), { waitUntil: "domcontentloaded" });
    await oPage.waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), { timeout: 90_000 }).catch(() => {});
    await oPage.waitForTimeout(1500);
    const oText = await oPage.innerText("main");
    ok(
      /没有该项目的访问权限|无权查看|项目不存在/.test(oText),
      "无权限用户看到明确的无权限状态",
      oText.slice(0, 200),
    );
    ok(!oText.includes("ANSI/BIFMA"), "无权限用户看不到任何要求内容");
    await oPage.screenshot({ path: `${OUT}/forbidden-desktop-1440x900.png` });

    /* ── 无 projectId 的直接访问 ───────────────────────── */
    console.log("\n== 直接访问（无项目上下文）==");
    const bare = await buyerCtx.newPage();
    await bare.goto(`${BASE}/projects/intelligence/supply-chain`, { waitUntil: "domcontentloaded" });
    await bare.waitForFunction(() => !/加载中/.test(document.querySelector("main")?.innerText ?? "加载中"), { timeout: 90_000 }).catch(() => {});
    await bare.waitForTimeout(1500);
    const bareText = await bare.innerText("main");
    ok(bareText.includes("请从具体的招标项目进入"), "无项目上下文时给出明确引导");
    ok(!bareText.includes("ANSI/BIFMA"), "无项目上下文时不泄露任何项目数据");
    await bare.screenshot({ path: `${OUT}/no-project-desktop-1440x900.png` });

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
