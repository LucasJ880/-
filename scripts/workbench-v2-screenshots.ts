/**
 * Workbench V2 验收截图（需本地 dev + 可登录账号）
 * 用法：
 *   MOBILE_AUDIT_EMAIL=... MOBILE_AUDIT_PASSWORD=... npx tsx scripts/workbench-v2-screenshots.ts
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { UI_THEME_STORAGE_KEY } from "../src/lib/theme/types";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL = process.env.MOBILE_AUDIT_EMAIL;
const PASSWORD = process.env.MOBILE_AUDIT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error("MOBILE_AUDIT_EMAIL and MOBILE_AUDIT_PASSWORD are required");
}

const OUT = path.join(process.cwd(), "docs/workbench-v2");

async function login(context: import("playwright").BrowserContext) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const url = new URL(BASE);
  await context.addCookies(
    setCookie.map((raw) => {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      return {
        name: pair.slice(0, eq).trim(),
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
  await page.evaluate(
    ({ orgId, themeKey }) => {
      if (orgId) localStorage.setItem("qingyan_selected_org_id", orgId);
      localStorage.setItem(themeKey, "glass");
    },
    { orgId: data.activeOrgId, themeKey: UI_THEME_STORAGE_KEY },
  );
  await page.close();
}

const viewports = [
  { name: "1440x900", width: 1440, height: 900, mobile: false },
  // 文件名按验收约定；宽度取 xl-1，确保 Inspector 走 Drawer 而非常驻栏
  { name: "1280x800", width: 1279, height: 800, mobile: false },
  { name: "390x844", width: 390, height: 844, mobile: true },
] as const;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      deviceScaleFactor: 1,
    });
    await login(ctx);
    const page = await ctx.newPage();
    await page.addInitScript((themeKey) => {
      localStorage.setItem(themeKey, "glass");
    }, UI_THEME_STORAGE_KEY);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
    if (page.url().includes("/login")) {
      throw new Error(`still on login for ${vp.name}`);
    }
    await page.waitForTimeout(1200);
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    console.log(vp.name, "url=", page.url(), "theme=", theme);
    const out = path.join(OUT, `${vp.name}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log("wrote", out, fs.statSync(out).size);
    await ctx.close();
  }

  await browser.close();
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
