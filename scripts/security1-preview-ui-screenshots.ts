/**
 * Security-1 Preview UI 截图（Playwright，本地 next start）
 * 用法：npx tsx scripts/security1-preview-ui-screenshots.ts [baseUrl]
 */
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE = process.argv[2] || "http://127.0.0.1:3015";
const PASSWORD = process.env.SECURITY1_QA_PASSWORD;
if (!PASSWORD) {
  throw new Error("SECURITY1_QA_PASSWORD is required");
}
const OUT = path.join(process.cwd(), "docs/security1-screenshots");

async function login(page: import("playwright").Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByPlaceholder("至少 6 位").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), {
    timeout: 20000,
  });
  await page.waitForTimeout(1500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // —— Sales A ——
  await login(page, "alex@sunnyshutter.ca");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUT, "sunny-sales-fixed-left-header.png"),
    fullPage: false,
  });

  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const custTab = page.getByRole("button", { name: "客户列表" });
  if (await custTab.count()) {
    await custTab.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({
    path: path.join(OUT, "sunny-sales-own-customers.png"),
    fullPage: false,
  });

  await page.goto(`${BASE}/settings/account`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "sunny-sales-settings-no-switch.png"),
    fullPage: false,
  });

  // —— Admin ——
  await context.clearCookies();
  await login(page, "security1-admin@test.qingyan.ai");
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  // 尝试点客户列表；若 403 页面会提示无权
  const adminCust = page.getByRole("button", { name: "客户列表" });
  if (await adminCust.count()) {
    await adminCust.click();
    await page.waitForTimeout(2000);
  }
  const bodyText = await page.locator("body").innerText();
  // 若仍显示客户，再导航到 API 错误可见处；截当前销售页
  await page.screenshot({
    path: path.join(OUT, "sunny-admin-no-sales-access.png"),
    fullPage: false,
  });
  console.log("admin sales page snippet:", bodyText.slice(0, 200).replace(/\n/g, " "));

  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUT, "sunny-admin-no-platform-users.png"),
    fullPage: false,
  });

  // —— Owner ——
  await context.clearCookies();
  await login(page, "security1-owner@test.qingyan.ai");
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const ownerCust = page.getByRole("button", { name: "客户列表" });
  if (await ownerCust.count()) {
    await ownerCust.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({
    path: path.join(OUT, "sunny-owner-org-sales-access.png"),
    fullPage: false,
  });

  // —— Trade ——
  await context.clearCookies();
  await login(page, "security1-trade@test.qingyan.ai");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(OUT, "mengxin-trade-no-sales-access.png"),
    fullPage: false,
  });
  await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "mengxin-trade-sales-blocked.png"),
    fullPage: false,
  });

  // —— MULTI_ORG ——
  await context.clearCookies();
  await login(page, "security1-multi@test.qingyan.ai");
  // 确保从 Sunny 开始
  await page.request.post(`${BASE}/api/auth/switch-org`, {
    data: { orgId: "cmrtcnz1c0001sbjcy87hemyl" },
  });
  await page.goto(`${BASE}/settings/account`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "multi-org-settings-switcher.png"),
    fullPage: false,
  });

  // 切换到梦馨：点击对应行的「切换」
  const mengxinRow = page.locator("li", { hasText: "梦馨家纺" });
  if (await mengxinRow.count()) {
    await mengxinRow.getByRole("button", { name: "切换" }).click();
    await page.waitForTimeout(3000);
  }
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "multi-org-after-switch.png"),
    fullPage: false,
  });

  await browser.close();
  console.log("screenshots written to", OUT);
  console.log(fs.readdirSync(OUT).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
