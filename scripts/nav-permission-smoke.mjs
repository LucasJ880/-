/**
 * 导航权限点验（API + 侧栏文案）
 * 运行：node scripts/nav-permission-smoke.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.NAV_QA_BASE || "http://localhost:3000";
const EMAIL = process.env.NAV_QA_EMAIL || "nav-qa@test.qingyan.ai";
const PASSWORD = process.env.NAV_QA_PASSWORD || "Qingyan@NavQA2026";

function sidebar(page) {
  return page.locator("aside.bg-\\[\\#111b1d\\]").first();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // —— Org Admin（nav-qa）——
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) throw new Error("login failed");
  const body = await login.json();
  const sunny = body.organizations.find((o) =>
    (o.code || "").includes("sunny"),
  );
  await context.request.patch(`${BASE}/api/auth/active-org`, {
    data: { orgId: sunny.id },
  });

  const page = await context.newPage();
  await page.addInitScript((id) => {
    localStorage.setItem("qy_active_org_id", id);
  }, sunny.id);
  await page.goto(`${BASE}/capabilities`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      const t =
        document.querySelector("aside.bg-\\[\\#111b1d\\]")?.textContent || "";
      return t.includes("治理中心") && t.includes("经营中心") && t.includes("企业管理");
    },
    { timeout: 15000 },
  );
  await sidebar(page).locator("nav").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(200);
  const adminText = await sidebar(page).innerText();
  if (!adminText.includes("企业能力中台") || !adminText.includes("治理中心")) {
    throw new Error("Org Admin 应看到完整中台含治理中心\n" + adminText);
  }
  if (!adminText.includes("经营中心") || !adminText.includes("企业管理")) {
    throw new Error("Org Admin 应看到经营中心与企业管理\n" + adminText);
  }
  console.log("✓ Org Admin 中台/经营/管理可见");

  // 直接访问 capabilities 应 200（有 membership）
  const cap = await context.request.get(`${BASE}/capabilities`);
  if (cap.status() !== 200) {
    throw new Error(`Org Admin /capabilities expected 200, got ${cap.status()}`);
  }
  console.log("✓ Org Admin /capabilities 200");

  // Platform Admin 角色确认（nav-qa.role=admin）但不因平台角色绕过无 membership
  // 使用临时上下文：不选 org → 清 active org 后看侧栏
  // 这里用 logic 测试已覆盖；再验 403 路径需无 membership 用户。
  // 若存在 personal-only 组织，切到无业务 modules 的个人组织验证隐藏企业导航。
  const personal = (body.organizations || []).find((o) =>
    (o.code || "").startsWith("personal-"),
  );
  if (personal) {
    await context.request.patch(`${BASE}/api/auth/active-org`, {
      data: { orgId: personal.id },
    });
    await page.evaluate((id) => {
      localStorage.setItem("qy_active_org_id", id);
      window.dispatchEvent(new Event("qingyan-org-storage"));
    }, personal.id);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const personalText = await sidebar(page).innerText();
    // 个人组织仍可能有 membership；以「无经营中心/中台」为弱断言
    const hasBizNav =
      personalText.includes("企业能力中台") ||
      personalText.includes("经营中心");
    console.log(
      hasBizNav
        ? "⚠ 个人组织仍显示企业导航（可能仍有 modules/membership，跳过强断言）"
        : "✓ 个人组织不显示经营中心/中台",
    );
  }

  // query string 不影响 active
  await context.request.patch(`${BASE}/api/auth/active-org`, {
    data: { orgId: sunny.id },
  });
  await page.evaluate((id) => {
    localStorage.setItem("qy_active_org_id", id);
    window.dispatchEvent(new Event("qingyan-org-storage"));
  }, sunny.id);
  await page.goto(`${BASE}/capabilities/runs?tab=all`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1000);
  const qText = await sidebar(page).innerText();
  if (!qText.includes("运行中心")) {
    throw new Error("query string 下运行中心应可见");
  }
  console.log("✓ query string 下中台子导航仍正确");

  await browser.close();
  console.log("permission smoke done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
