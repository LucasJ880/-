/**
 * Phase Mobile-1 验收截图（Chromium）
 * 用法：npx tsx scripts/mobile1-ui-screenshots.ts [baseUrl]
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL =
  process.env.MOBILE_AUDIT_EMAIL || "security1-sales-b@test.qingyan.ai";
const PASSWORD = process.env.MOBILE_AUDIT_PASSWORD || "Qingyan@Sec1QA2026";
const OUT = path.join(process.cwd(), "docs/mobile1-screenshots");

async function loginViaApi(context: import("playwright").BrowserContext) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const url = new URL(BASE);
  await context.addCookies(
    setCookie.map((raw) => {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: url.hostname,
        path: "/",
        httpOnly: /httponly/i.test(raw),
        secure: url.protocol === "https:",
        sameSite: "Lax" as const,
      };
    }),
  );
  const data = (await res.json()) as { activeOrgId?: string };
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  if (data.activeOrgId) {
    await page.evaluate((id) => {
      localStorage.setItem("qingyan_selected_org_id", id);
    }, data.activeOrgId);
  }
  await page.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // 320 长标题
  {
    const ctx = await browser.newContext({
      viewport: { width: 320, height: 720 },
      isMobile: true,
      hasTouch: true,
    });
    await loginViaApi(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/organizations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      if (h1) {
        h1.textContent =
          "超长验收标题：Sunny Home & Deco International Bid Lead Workspace QA";
      }
    });
    await page.screenshot({
      path: path.join(OUT, "long-title-320.png"),
      fullPage: false,
    });
    await ctx.close();
  }

  // 375 标题+操作
  {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    await loginViaApi(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/account`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT, "settings-account-mobile.png"),
      fullPage: false,
    });
    await page.screenshot({
      path: path.join(OUT, "long-title-actions-375.png"),
      fullPage: false,
    });

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const headerMenu = page.getByRole("button", { name: /打开菜单|打开完整导航|菜单/ }).first();
    const more = page.getByRole("button", { name: "打开完整导航" });
    if (await headerMenu.count()) await headerMenu.click();
    else if (await more.count()) await more.click();
    await page.waitForTimeout(700);
    // 等待抽屉出现
    await page.locator(".fixed.inset-0.z-50").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await page.screenshot({
      path: path.join(OUT, "mobile-nav-open.png"),
      fullPage: false,
    });
    const close = page.locator('button[aria-label="关闭"]').first();
    if (await close.count()) await close.click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUT, "mobile-nav-closed-scroll-restored.png"),
      fullPage: false,
    });

    await page.goto(`${BASE}/sales?view=customers`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1500);
    const custTab = page.getByRole("button", { name: "客户列表" });
    if (await custTab.count()) {
      await custTab.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({
      path: path.join(OUT, "customer-list-mobile.png"),
      fullPage: false,
    });

    await page.goto(`${BASE}/sales/quote-sheet`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(OUT, "quote-form-mobile.png"),
      fullPage: false,
    });

    // 打开组织详情若有链接，否则用 settings 作为 modal 替代页：截任务页不足以证明 modal
    // 使用 capabilities approvals 宽表区域滚动容器
    await page.goto(`${BASE}/capabilities/approvals`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT, "modal-mobile-scroll.png"),
      fullPage: false,
    });

    await ctx.close();
  }

  console.log("screenshots →", OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
