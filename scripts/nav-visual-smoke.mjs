/**
 * 导航视觉点验截图（本地 next + Playwright）
 * 前置：npm run dev；npx tsx scripts/nav-qa-prepare-user.ts
 * 运行：node scripts/nav-visual-smoke.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.NAV_QA_BASE || "http://localhost:3000";
const EMAIL = process.env.NAV_QA_EMAIL || "nav-qa@test.qingyan.ai";
const PASSWORD = process.env.NAV_QA_PASSWORD || "Qingyan@NavQA2026";
const OUT = path.join(process.cwd(), "docs/nav-ia-screenshots");

/** 主侧栏（排除右侧抽屉） */
function sidebar(page) {
  return page.locator('aside.bg-\\[\\#111b1d\\]').first();
}

async function loginViaApi(context) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const body = await res.json();
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${JSON.stringify(body)}`);
  }
  console.log("login ok", {
    activeOrgId: body.activeOrgId,
    orgs: (body.organizations || []).map((o) => o.code || o.name),
  });
  return body;
}

async function selectOrg(context, page, orgId) {
  const patch = await context.request.patch(`${BASE}/api/auth/active-org`, {
    data: { orgId },
  });
  if (!patch.ok()) {
    throw new Error(
      `selectOrg failed: ${patch.status()} ${await patch.text()}`,
    );
  }
  await page.addInitScript((id) => {
    try {
      localStorage.setItem("qy_active_org_id", id);
    } catch {
      /* ignore */
    }
  }, orgId);
  // 若页面已打开，同步一次
  try {
    await page.evaluate((id) => {
      localStorage.setItem("qy_active_org_id", id);
      window.dispatchEvent(new Event("qingyan-org-storage"));
    }, orgId);
  } catch {
    /* page 可能尚未导航 */
  }
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
}

async function assertSidebarText(page, expectedIncludes, expectedExcludes = []) {
  const text = await sidebar(page).innerText();
  for (const s of expectedIncludes) {
    if (!text.includes(s)) {
      throw new Error(`sidebar missing: ${s}\n---\n${text}`);
    }
  }
  for (const s of expectedExcludes) {
    if (text.includes(s)) {
      throw new Error(`sidebar unexpected: ${s}\n---\n${text}`);
    }
  }
  return text;
}

async function gotoReady(page, url, { expectMembership = true } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await sidebar(page).waitFor({ state: "visible", timeout: 15000 });
  if (expectMembership) {
    await page.waitForFunction(
      () => {
        const el = document.querySelector("aside.bg-\\[\\#111b1d\\]");
        return el && el.textContent && el.textContent.includes("企业经营");
      },
      { timeout: 15000 },
    );
  }
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const loginBody = await loginViaApi(context);
  const orgs = loginBody.organizations || [];
  const sunny = orgs.find((o) => (o.code || "").includes("sunny"));
  const mengxin = orgs.find((o) => (o.code || "").includes("mengxin"));
  if (!sunny?.id || !mengxin?.id) {
    throw new Error("缺少 Sunny / 梦馨组织 membership");
  }

  const page = await context.newPage();
  await selectOrg(context, page, sunny.id);

  await gotoReady(page, "/");
  await assertSidebarText(page, [
    "日常工作",
    "企业经营",
    "企业能力中台",
    "业务运营",
    "品牌增长",
    "企业管理",
  ]);
  // 一级顺序：经营中心 → 企业能力中台 → … → 品牌增长
  {
    const text = await sidebar(page).innerText();
    const iOps = text.indexOf("经营中心");
    const iCap = text.indexOf("企业能力中台");
    const iGrowth = text.indexOf("品牌增长");
    if (!(iOps >= 0 && iCap > iOps && iGrowth > iCap)) {
      throw new Error(`一级顺序不正确\n${text}`);
    }
  }
  await shot(page, "01-desktop-1440-home-sidebar");

  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoReady(page, "/");
  await shot(page, "02-desktop-1280-home-sidebar");

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, url, must, mustNot = []] of [
    ["03-capabilities-overview", "/capabilities", ["企业能力中台", "运行中心"], []],
    [
      "04-capabilities-governance",
      "/capabilities/governance",
      ["治理中心", "企业能力中台"],
      [],
    ],
    ["05-operations-center", "/operations/center", ["经营中心"], []],
    [
      "06-growth-no-capabilities-under-growth",
      "/operations/growth",
      ["品牌增长"],
      [],
    ],
    ["07-management-orgs", "/organizations", ["企业管理"], []],
  ]) {
    await gotoReady(page, url);
    await assertSidebarText(page, must, mustNot);
    await shot(page, name);
  }

  // Sunny：销售/项目，不出现外贸专属
  await selectOrg(context, page, sunny.id);
  await gotoReady(page, "/");
  await page.waitForFunction(() => {
    const t = document.querySelector("aside.bg-\\[\\#111b1d\\]")?.textContent || "";
    return t.includes("商机中心") && !t.includes("海外业务");
  }, { timeout: 15000 });
  await assertSidebarText(
    page,
    ["企业能力中台", "业务运营", "商机中心"],
    ["海外业务", "线索资产", "展会导入"],
  );
  // 滚到底确认品牌增长/企业管理
  await sidebar(page).locator("nav").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  await assertSidebarText(page, ["品牌增长", "企业管理"]);
  await shot(page, "08-sunny-nav");

  // 梦馨：外贸/供应链，不残留 Sunny 投标专属（项目入口可因 supply_chain 出现，以外贸为准）
  await selectOrg(context, page, mengxin.id);
  await gotoReady(page, "/");
  await page.waitForFunction(() => {
    const t = document.querySelector("aside.bg-\\[\\#111b1d\\]")?.textContent || "";
    return t.includes("海外业务") && t.includes("梦馨");
  }, { timeout: 15000 });
  await assertSidebarText(
    page,
    ["企业能力中台", "业务运营", "海外业务", "线索资产"],
    [],
  );
  await shot(page, "09-mengxin-nav");

  // 移动端（桌面 aside 在 md 以下隐藏，不能再用 sidebar wait）
  await page.setViewportSize({ width: 390, height: 844 });
  await selectOrg(context, page, sunny.id);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const more = page.getByRole("button", { name: "打开完整导航" });
  await more.first().click();
  const drawer = page.locator(".fixed.inset-0.z-50");
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  // 等 active-org modules 就绪后，「业务」分类才会出现
  await page.waitForFunction(() => {
    const t = document.querySelector(".fixed.inset-0.z-50")?.textContent || "";
    return (
      t.includes("工作台") &&
      t.includes("经营") &&
      t.includes("能力中台") &&
      t.includes("业务") &&
      t.includes("增长") &&
      t.includes("管理")
    );
  }, { timeout: 15000 });
  await page.waitForTimeout(300);
  await shot(page, "10-mobile-390-l1");

  await page.getByRole("button", { name: /能力中台/ }).first().click();
  await page.waitForTimeout(500);
  const l2 = await drawer.innerText();
  if (!l2.includes("中台总览") && !l2.includes("运行中心")) {
    throw new Error(`mobile L2 capabilities missing\n${l2}`);
  }
  if (!l2.includes("返回分类")) {
    throw new Error("mobile L2 missing back action");
  }
  await shot(page, "11-mobile-390-capabilities-l2");

  await browser.close();
  console.log("visual smoke done →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
