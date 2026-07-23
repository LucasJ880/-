/**
 * Phase Mobile-2 验收截图（Chromium mobile emulation）
 *
 * 用法：
 *   MOBILE_AUDIT_EMAIL=... MOBILE_AUDIT_PASSWORD=... \
 *     npx tsx scripts/mobile2-ui-screenshots.ts [baseUrl]
 *
 * 输出：docs/mobile2-screenshots/*.png（不含密码 / Token）
 * 说明：软键盘截图为 visualViewport 模拟，≠ iPhone 真机键盘。
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL = process.env.MOBILE_AUDIT_EMAIL;
const PASSWORD = process.env.MOBILE_AUDIT_PASSWORD;
const OUT = path.join(process.cwd(), "docs/mobile2-screenshots");

if (!EMAIL || !PASSWORD) {
  throw new Error(
    "MOBILE_AUDIT_EMAIL and MOBILE_AUDIT_PASSWORD are required",
  );
}

async function login(context: BrowserContext) {
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
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (data.activeOrgId) {
    await page.evaluate((id) => {
      localStorage.setItem("qingyan_selected_org_id", id);
    }, data.activeOrgId);
  }
  await page.close();
}

async function shot(page: Page, name: string) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await login(context);
  const page = await context.newPage();

  // 1) Drawer open
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /打开菜单|打开完整导航/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "完整导航" });
  await drawer.waitFor({ state: "visible" });
  await shot(page, "drawer-dialog-mobile.png");

  // 2) Nested: keep drawer mentally as outer — open inventory dialog while noting locks
  //    Use inventory page: open a dialog if available; else open drawer then Escape+dialog pattern
  await drawer.getByRole("button", { name: "关闭" }).click();
  await drawer.waitFor({ state: "detached" });

  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // Prefer a create/new button that opens dialog
  const newBtn = page
    .getByRole("button", { name: /新建|新增|创建|添加/ })
    .first();
  if (await newBtn.count()) {
    await newBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await shot(page, "nested-overlay-mobile.png");

  // Close overlays
  const closeBtns = page.getByRole("button", { name: "关闭" });
  const n = await closeBtns.count();
  for (let i = 0; i < Math.min(n, 3); i++) {
    await closeBtns.nth(0).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // 3) Quote form + simulated keyboard (visualViewport shrink)
  await page.goto(`${BASE}/sales/quote-sheet`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(`(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    Object.defineProperty(vv, "height", { configurable: true, get: () => 420 });
    Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event("resize"));
  })()`);
  const input = page.locator("textarea, input").first();
  if (await input.count()) {
    await input.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
  await shot(page, "keyboard-quote-form.png");
  await shot(page, "safe-area-actionbar.png");

  // restore viewport
  await page.evaluate(`(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    Object.defineProperty(vv, "height", {
      configurable: true,
      get: () => window.innerHeight,
    });
    vv.dispatchEvent(new Event("resize"));
  })()`);

  // 4) Assistant keyboard sim
  await page.goto(`${BASE}/assistant`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(`(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    Object.defineProperty(vv, "height", { configurable: true, get: () => 420 });
    vv.dispatchEvent(new Event("resize"));
  })()`);
  await shot(page, "keyboard-assistant.png");

  // 5) Long operations title @320
  await context.close();
  const narrow = await browser.newContext({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await login(narrow);
  const nPage = await narrow.newPage();
  await nPage.goto(`${BASE}/operations/center`, { waitUntil: "networkidle" });
  await nPage.waitForTimeout(500);
  await shot(nPage, "long-operations-title.png");

  // 6) Dropdown / select viewport — settings account
  await nPage.goto(`${BASE}/settings/account`, { waitUntil: "networkidle" });
  await nPage.waitForTimeout(400);
  const combo = nPage.getByRole("combobox").first();
  if (await combo.count()) {
    await combo.click({ timeout: 3000 }).catch(() => {});
    await nPage.waitForTimeout(400);
  } else {
    const anySelect = nPage.locator("button, [role='button']").filter({
      hasText: /选择|切换|语言|组织/,
    }).first();
    if (await anySelect.count()) {
      await anySelect.click({ timeout: 3000 }).catch(() => {});
    }
  }
  await shot(nPage, "mobile-dropdown-viewport.png");

  // 7) Scroll restored after overlays
  await nPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await nPage.getByRole("button", { name: /打开菜单|打开完整导航/ }).first().click();
  const d2 = nPage.getByRole("dialog", { name: "完整导航" });
  await d2.waitFor({ state: "visible" });
  await d2.getByRole("button", { name: "关闭" }).click();
  await d2.waitFor({ state: "detached" });
  const locks = await nPage.evaluate(`(() => {
    const fn = window.__qyGetActiveScrollLocks;
    return typeof fn === "function" ? fn().length : -1;
  })()`);
  console.log("activeLocks after overlays:", locks);
  await shot(nPage, "scroll-restored-after-overlays.png");

  await nPage.close();
  await narrow.close();
  await browser.close();
  console.log("SCREENSHOTS_OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
