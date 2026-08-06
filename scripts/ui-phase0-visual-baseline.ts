/**
 * UI/UX Phase 0 visual baseline.
 *
 * Usage:
 * UI_AUDIT_EMAIL=... UI_AUDIT_PASSWORD=... \
 *   npx tsx scripts/ui-phase0-visual-baseline.ts [baseUrl]
 *
 * Output (no credentials are written):
 * docs/ui-ux-baseline/<viewport>/*.png
 * docs/ui-ux-baseline/results.json
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL = process.env.UI_AUDIT_EMAIL;
const PASSWORD = process.env.UI_AUDIT_PASSWORD;
const OUTPUT_ROOT = path.join(process.cwd(), "docs", "ui-ux-baseline");
const SYSTEM_CHROMIUM = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// This QA fixture is visible to the sales test account. Override via
// UI_AUDIT_PROJECT_ROUTE when validating a different tenant/role.
const PROJECT_DETAIL_FALLBACK = "/projects/cmsf8dlyw002lju04ixjtsyln";

if (!EMAIL || !PASSWORD) {
  throw new Error("UI_AUDIT_EMAIL and UI_AUDIT_PASSWORD are required");
}

const ALL_VIEWPORTS = [
  { name: "1440", width: 1440, height: 1024, mobile: false },
  { name: "1024", width: 1024, height: 900, mobile: false },
  { name: "768", width: 768, height: 1024, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
] as const;
const requestedViewports = new Set(
  (process.env.UI_AUDIT_VIEWPORTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const VIEWPORTS = requestedViewports.size
  ? ALL_VIEWPORTS.filter((viewport) => requestedViewports.has(viewport.name))
  : ALL_VIEWPORTS;

if (VIEWPORTS.length === 0) {
  throw new Error("UI_AUDIT_VIEWPORTS does not match a supported viewport");
}

const ROUTES = [
  { name: "home", route: "/" },
  { name: "projects", route: "/projects" },
  { name: "project-detail", route: "__PROJECT_DETAIL__" },
  { name: "sales", route: "/sales" },
  { name: "assistant", route: "/assistant" },
  { name: "capabilities", route: "/capabilities" },
  { name: "pending-actions", route: "/capabilities/approvals" },
  { name: "quote-sheet", route: "/sales/quote-sheet" },
] as const;

type BaselineRow = {
  viewport: string;
  route: string;
  screenshot: string;
  status: number | null;
  horizontalOverflow: boolean | null;
  mainOverflow: boolean | null;
  h1: string | null;
  error?: string;
};

async function login(context: BrowserContext) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`login failed (${response.status})`);
  }

  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) throw new Error("login returned no session cookie");
  const host = new URL(BASE).hostname;
  await context.addCookies(
    cookies.map((raw) => {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      return {
        name: pair.slice(0, index),
        value: pair.slice(index + 1),
        domain: host,
        path: "/",
        httpOnly: /httponly/i.test(raw),
        secure: BASE.startsWith("https://"),
        sameSite: "Lax" as const,
      };
    }),
  );

  const data = (await response.json()) as { activeOrgId?: string | null };
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (data.activeOrgId) {
    await page.evaluate((orgId) => {
      localStorage.setItem("qingyan_selected_org_id", orgId);
    }, data.activeOrgId);
  }
  await page.close();
}

async function resolveProjectDetailRoute(page: Page) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const href = await page
    .locator('a[href^="/projects/"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .find((value) => value && /^\/projects\/[^/?#]+$/.test(value)),
    );
  if (!href) throw new Error("could not resolve a project detail fixture");
  return href;
}

async function capturePage(
  page: Page,
  route: string,
  outputPath: string,
  viewport: string,
): Promise<BaselineRow> {
  const row: BaselineRow = {
    viewport,
    route,
    screenshot: path.relative(process.cwd(), outputPath),
    status: null,
    horizontalOverflow: null,
    mainOverflow: null,
    h1: null,
  };
  try {
    const response = await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    row.status = response?.status() ?? null;
    await page.waitForTimeout(900);
    Object.assign(
      row,
      await page.evaluate(() => {
        const main = document.querySelector("main");
        return {
          horizontalOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 2,
          mainOverflow: main
            ? main.scrollWidth > main.clientWidth + 2
            : null,
          h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        };
      }),
    );
    await page.screenshot({ path: outputPath, fullPage: false });
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

async function captureMobileDrawer(page: Page, outputPath: string) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const primaryTrigger = page.getByRole("button", {
    name: /打开完整导航|打开菜单|菜单/,
  }).first();
  const trigger = (await primaryTrigger.count())
    ? primaryTrigger
    : page.locator("header button").first();
  if (!(await trigger.count())) throw new Error("mobile navigation trigger missing");
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "完整导航" });
  await drawer.waitFor({ state: "visible", timeout: 5_000 });
  const state = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow,
      main: main instanceof HTMLElement ? main.style.overflow : null,
    };
  });
  await page.screenshot({ path: outputPath, fullPage: false });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached", timeout: 5_000 });
  const restored = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      body: document.body.style.overflow,
      html: document.documentElement.style.overflow,
      main: main instanceof HTMLElement ? main.style.overflow : null,
    };
  });
  return { open: state, closed: restored };
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  // CI uses Playwright-managed Chromium. Local macOS can reuse an installed
  // Chrome when the managed browser is intentionally not present.
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (fs.existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined),
  });
  const rows: BaselineRow[] = [];
  let drawer: Awaited<ReturnType<typeof captureMobileDrawer>> | null = null;

  for (const viewport of VIEWPORTS) {
    const outputDir = path.join(OUTPUT_ROOT, viewport.name);
    fs.mkdirSync(outputDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
    });
    await login(context);
    const page = await context.newPage();
    const projectRoute = process.env.UI_AUDIT_PROJECT_ROUTE ||
      (await resolveProjectDetailRoute(page).catch(() => PROJECT_DETAIL_FALLBACK));

    for (const item of ROUTES) {
      const route = item.route === "__PROJECT_DETAIL__" ? projectRoute : item.route;
      console.log(`[${viewport.name}] ${item.name}`);
      rows.push(
        await capturePage(
          page,
          route,
          path.join(outputDir, `${item.name}.png`),
          viewport.name,
        ),
      );
    }

    if (viewport.name === "390") {
      console.log("[390] mobile navigation drawer");
      drawer = await captureMobileDrawer(
        page,
        path.join(outputDir, "mobile-nav-drawer-open.png"),
      );
    }

    await context.close();
  }

  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const results = {
    generatedAt: new Date().toISOString(),
    commit,
    base: BASE,
    browser: "Chromium / Playwright",
    safariVerified: false,
    viewports: VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
    pages: rows,
    drawer,
  };
  const resultName = VIEWPORTS.length === ALL_VIEWPORTS.length
    ? "results.json"
    : `results-${VIEWPORTS.map((viewport) => viewport.name).join("-")}.json`;
  fs.writeFileSync(
    path.join(OUTPUT_ROOT, resultName),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await browser.close();
  console.log(`UI baseline complete: ${rows.length} screenshots`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
