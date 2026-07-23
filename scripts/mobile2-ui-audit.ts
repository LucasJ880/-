/**
 * Phase Mobile-2：Overlay / Scroll Lock / 多引擎自检
 *
 * 用法：
 *   MOBILE_AUDIT_EMAIL=... MOBILE_AUDIT_PASSWORD=... \
 *     npx tsx scripts/mobile2-ui-audit.ts [baseUrl]
 *
 * 可选：VERCEL_AUTOMATION_BYPASS_SECRET（Deployment Protection）
 *
 * 输出：docs/mobile2-audit-results.json（不含密码）
 * 失败时 process.exit(1)
 */

import {
  chromium,
  webkit,
  type Browser,
  type BrowserType,
  type BrowserContext,
  type Page,
} from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL = process.env.MOBILE_AUDIT_EMAIL;
const PASSWORD = process.env.MOBILE_AUDIT_PASSWORD;
const VERCEL_BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!EMAIL || !PASSWORD) {
  throw new Error(
    "MOBILE_AUDIT_EMAIL and MOBILE_AUDIT_PASSWORD are required",
  );
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (VERCEL_BYPASS) {
    headers["x-vercel-protection-bypass"] = VERCEL_BYPASS;
  }
  return headers;
}

const OUT = path.join(process.cwd(), "docs/mobile2-audit-results.json");

const WIDTHS = [320, 375, 390, 430, 768] as const;
const ROUTES = [
  "/",
  "/settings/account",
  "/sales",
  "/sales/quote-sheet",
  "/inventory",
  "/operations/center",
  "/capabilities/runs",
  "/assistant",
] as const;

type PageRow = {
  width: number;
  route: string;
  ok: boolean;
  hOverflow: boolean | null;
  error?: string;
};

type NavLockResult = {
  width: number;
  beforeMainInline: string;
  openMainInline: string;
  closedMainInline: string;
  drawerVisibleWhenOpen: boolean;
  drawerDetachedAfterClose: boolean;
  openLocked: boolean;
  closedRestored: boolean;
  activeLocksAfterClose: number | null;
  error?: string;
};

type EngineResult = {
  engine: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  available: boolean;
  error?: string;
  pageSuccessCount: number;
  pageTotal: number;
  pages: PageRow[];
  navLock?: NavLockResult;
};

function activeLockCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const fn = (
      window as unknown as {
        __qyGetActiveScrollLocks?: () => Array<{ reason: string }>;
      }
    ).__qyGetActiveScrollLocks;
    if (typeof fn !== "function") return null;
    return fn().length;
  });
}

async function loginOnce(
  browser: Browser,
): Promise<{ storageState: Awaited<ReturnType<BrowserContext["storageState"]>>; activeOrgId?: string }> {
  const context = await browser.newContext({
    ...(VERCEL_BYPASS ? { extraHTTPHeaders: authHeaders() } : {}),
  });
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    await context.close();
    throw new Error(`login failed: HTTP ${res.status}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const url = new URL(BASE);
  const cookies = setCookie.map((raw) => {
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
  });
  if (VERCEL_BYPASS) {
    cookies.push({
      name: "x-vercel-protection-bypass",
      value: VERCEL_BYPASS,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    });
  }
  await context.addCookies(cookies);
  const data = (await res.json()) as { activeOrgId?: string };
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (data.activeOrgId) {
    await page.evaluate((id) => {
      localStorage.setItem("qingyan_selected_org_id", id);
    }, data.activeOrgId);
  }
  const storageState = await context.storageState();
  await page.close();
  await context.close();
  return { storageState, activeOrgId: data.activeOrgId };
}

async function openAuthedContext(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  opts: {
    viewport: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
  },
): Promise<BrowserContext> {
  return browser.newContext({
    ...opts,
    storageState,
    ...(VERCEL_BYPASS ? { extraHTTPHeaders: authHeaders() } : {}),
  });
}

async function gotoStable(page: Page, route: string) {
  await page.goto(`${BASE}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function measureOverflow(page: Page): Promise<boolean | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return null;
        return main.scrollWidth > main.clientWidth + 2;
      });
    } catch {
      await page.waitForTimeout(200);
    }
  }
  return null;
}

async function auditNavLock(page: Page): Promise<NavLockResult> {
  const width = 375;
  const result: NavLockResult = {
    width,
    beforeMainInline: "",
    openMainInline: "",
    closedMainInline: "",
    drawerVisibleWhenOpen: false,
    drawerDetachedAfterClose: false,
    openLocked: false,
    closedRestored: false,
    activeLocksAfterClose: null,
  };

  try {
    await gotoStable(page, "/");
    result.beforeMainInline = await page.evaluate(
      () => document.querySelector("main")?.style.overflow || "",
    );

    const menu = page.getByRole("button", { name: /打开菜单|打开完整导航/ }).first();
    await menu.click({ timeout: 10000 });

    const drawer = page.getByRole("dialog", { name: "完整导航" });
    await drawer.waitFor({ state: "visible", timeout: 10000 });
    result.drawerVisibleWhenOpen = await drawer.isVisible();

    result.openMainInline = await page.evaluate(
      () => document.querySelector("main")?.style.overflow || "",
    );
    result.openLocked = result.openMainInline === "hidden";

    const close = drawer.getByRole("button", { name: "关闭" });
    await close.click();
    await drawer.waitFor({ state: "detached", timeout: 10000 });
    result.drawerDetachedAfterClose = true;

    result.closedMainInline = await page.evaluate(
      () => document.querySelector("main")?.style.overflow || "",
    );
    result.closedRestored =
      result.closedMainInline === result.beforeMainInline;

    result.activeLocksAfterClose = await activeLockCount(page);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

async function runEngine(
  name: string,
  type: BrowserType,
): Promise<EngineResult> {
  let browser: Browser;
  try {
    browser = await type.launch({ headless: true });
  } catch (e) {
    return {
      engine: name,
      status: "SKIPPED",
      available: false,
      error: e instanceof Error ? e.message : String(e),
      pageSuccessCount: 0,
      pageTotal: 0,
      pages: [],
    };
  }

  const pages: PageRow[] = [];
  let navLock: NavLockResult | undefined;
  let fatal: string | undefined;

  try {
    const { storageState } = await loginOnce(browser);

    for (const width of WIDTHS) {
      const context = await openAuthedContext(browser, storageState, {
        viewport: { width, height: width >= 768 ? 1024 : 844 },
        isMobile: width < 768,
        hasTouch: width < 768,
      });
      const page = await context.newPage();
      for (const route of ROUTES) {
        try {
          await gotoStable(page, route);
          const hOverflow = await measureOverflow(page);
          const overflowBad = hOverflow === true;
          pages.push({
            width,
            route,
            ok: !overflowBad && hOverflow !== null,
            hOverflow,
            error:
              hOverflow === null
                ? "overflow measure failed"
                : overflowBad
                  ? "main horizontal overflow"
                  : undefined,
          });
          console.log(
            `[${name}/${width}] ${route} ${
              overflowBad || hOverflow === null ? "FAIL" : "ok"
            }${overflowBad ? " h-overflow" : ""}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pages.push({
            width,
            route,
            ok: false,
            hOverflow: null,
            error: msg,
          });
          console.log(`[${name}/${width}] ${route} FAIL ${msg}`);
        }
      }
      await page.close();
      await context.close();
    }

    const navCtx = await openAuthedContext(browser, storageState, {
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    const navPage = await navCtx.newPage();
    navLock = await auditNavLock(navPage);
    console.log(`[${name}] navLock`, {
      openLocked: navLock.openLocked,
      closedRestored: navLock.closedRestored,
      drawerVisibleWhenOpen: navLock.drawerVisibleWhenOpen,
      drawerDetachedAfterClose: navLock.drawerDetachedAfterClose,
      activeLocksAfterClose: navLock.activeLocksAfterClose,
      error: navLock.error,
    });
    await navPage.close();
    await navCtx.close();
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
  } finally {
    await browser.close();
  }

  const pageSuccessCount = pages.filter((p) => p.ok).length;
  const pageFail = pages.some((p) => !p.ok);
  const navFail =
    !navLock ||
    !!navLock.error ||
    !navLock.openLocked ||
    !navLock.closedRestored ||
    !navLock.drawerVisibleWhenOpen ||
    !navLock.drawerDetachedAfterClose ||
    (navLock.activeLocksAfterClose !== null &&
      navLock.activeLocksAfterClose !== 0);

  let status: EngineResult["status"] = "PASS";
  if (fatal || pageFail || navFail) status = "FAIL";

  return {
    engine: name,
    status,
    available: true,
    error: fatal,
    pageSuccessCount,
    pageTotal: pages.length,
    pages,
    navLock,
  };
}

async function main() {
  console.log("=== Phase Mobile-2 UI Audit ===");
  console.log("base:", BASE);
  console.log("email set:", Boolean(EMAIL));
  console.log("vercel bypass set:", Boolean(VERCEL_BYPASS));
  console.log("note: WebKit automated ≠ iPhone Safari real device");

  const engines: EngineResult[] = [];
  engines.push(await runEngine("chromium", chromium));
  // 避免连续登录触发限流
  await new Promise((r) => setTimeout(r, 1500));
  engines.push(await runEngine("webkit", webkit));

  const chromiumEngine = engines.find((e) => e.engine === "chromium")!;
  const webkitEngine = engines.find((e) => e.engine === "webkit")!;

  const failedPages = engines.flatMap((e) =>
    e.pages
      .filter((p) => !p.ok)
      .map((p) => ({
        engine: e.engine,
        width: p.width,
        route: p.route,
        error: p.error,
      })),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    headHint: process.env.MOBILE_AUDIT_HEAD || null,
    emailPresent: true,
    mobile1Baseline: "aa81c08",
    safariRealDevice: "PENDING",
    chromium: {
      status: chromiumEngine.status,
      pageSuccessCount: chromiumEngine.pageSuccessCount,
      pageTotal: chromiumEngine.pageTotal,
      navLock: chromiumEngine.navLock
        ? {
            openLocked: chromiumEngine.navLock.openLocked,
            closedRestored: chromiumEngine.navLock.closedRestored,
            activeLocksAfterClose:
              chromiumEngine.navLock.activeLocksAfterClose,
          }
        : null,
    },
    webkit: {
      status: webkitEngine.status,
      pageSuccessCount: webkitEngine.pageSuccessCount,
      pageTotal: webkitEngine.pageTotal,
      skipReason:
        webkitEngine.status === "SKIPPED" ? webkitEngine.error : null,
      navLock: webkitEngine.navLock
        ? {
            openLocked: webkitEngine.navLock.openLocked,
            closedRestored: webkitEngine.navLock.closedRestored,
            activeLocksAfterClose: webkitEngine.navLock.activeLocksAfterClose,
          }
        : null,
    },
    failedPages,
    engines,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log("wrote", OUT);

  for (const e of engines) {
    console.log(
      `${e.engine}: ${e.status} pages=${e.pageSuccessCount}/${e.pageTotal}` +
        (e.error ? ` error=${e.error}` : ""),
    );
  }
  if (failedPages.length) {
    console.log("failedPages:", JSON.stringify(failedPages, null, 2));
  }

  const chromiumOk = chromiumEngine.status === "PASS";
  const webkitOk =
    webkitEngine.status === "PASS" || webkitEngine.status === "SKIPPED";

  if (!chromiumOk || !webkitOk || webkitEngine.status === "FAIL") {
    console.error("AUDIT_FAILED");
    process.exit(1);
  }
  console.log("AUDIT_OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
