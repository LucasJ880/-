/**
 * Phase Mobile-1：移动端 UI 自检（Playwright + Chromium）
 *
 * 用法：
 *   npx tsx scripts/mobile-ui-audit.ts [baseUrl]
 *
 * 环境变量：
 *   MOBILE_AUDIT_EMAIL / MOBILE_AUDIT_PASSWORD（必填，无默认值）
 *
 * 输出：
 *   docs/mobile1-audit-results.json
 *   控制台摘要
 *
 * 说明：本环境仅跑 Chromium mobile emulation；Safari / 真机未验证。
 */

import { chromium, type Page, type BrowserContext } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const EMAIL = process.env.MOBILE_AUDIT_EMAIL;
const PASSWORD = process.env.MOBILE_AUDIT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error(
    "MOBILE_AUDIT_EMAIL and MOBILE_AUDIT_PASSWORD are required",
  );
}
const OUT_JSON = path.join(process.cwd(), "docs/mobile1-audit-results.json");

const WIDTHS = [320, 360, 375, 390, 430, 768] as const;

const ROUTES = [
  "/",
  "/settings",
  "/settings/account",
  "/sales",
  "/sales/quotes",
  "/sales/quote-sheet",
  "/sales/analytics",
  "/organizations",
  "/capabilities",
  "/capabilities/runs",
  "/capabilities/approvals",
  "/operations/center",
  "/projects",
  "/tasks",
] as const;

type OverflowHit = {
  tag: string;
  id: string;
  className: string;
  scrollWidth: number;
  clientWidth: number;
  path: string;
};

type PageAudit = {
  route: string;
  width: number;
  ok: boolean;
  status?: number;
  error?: string;
  mainOverflowY: string | null;
  contentExceedsMain: boolean | null;
  /** 内容超出但 overflow 不允许滚动 → 真问题 */
  scrollLocked: boolean | null;
  mainHorizontalOverflow: boolean | null;
  documentHorizontalOverflow: boolean | null;
  overflowCandidates: OverflowHit[];
  h1Count: number;
  h1Sample: string[];
  tableCount: number;
  hasPageHeader: boolean;
};

type NavAudit = {
  width: number;
  openBodyOverflow: string;
  openHtmlOverflow: string;
  openMainOverflowY: string | null;
  closedBodyOverflow: string;
  closedHtmlOverflow: string;
  closedMainOverflowY: string | null;
  afterCloseCanClickMain: boolean;
  note: string;
};

async function loginViaApi(context: BrowserContext) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login API ${res.status}: ${await res.text()}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const url = new URL(BASE);
  const cookies = setCookie.map((raw) => {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    return {
      name,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: /httponly/i.test(raw),
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    };
  });
  if (cookies.length === 0) {
    throw new Error("login API returned no Set-Cookie");
  }
  await context.addCookies(cookies);

  const data = (await res.json()) as {
    activeOrgId?: string | null;
  };
  // 预热页面并写入 localStorage org（与前端 hydrate 对齐）
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (data.activeOrgId) {
    await page.evaluate((orgId) => {
      try {
        // 与 src/lib/org-selection.ts SELECTED_ORG_STORAGE_KEY 对齐的常见键
        localStorage.setItem("qingyan_selected_org_id", orgId);
      } catch {
        /* ignore */
      }
    }, data.activeOrgId);
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  if (page.url().includes("/login")) {
    throw new Error("cookie login still on /login — session invalid");
  }
  await page.close();
}

async function ensureLoggedIn(page: Page) {
  if (page.url().includes("/login")) {
    throw new Error("session lost; still on /login");
  }
}

async function measurePage(page: Page, route: string, width: number): Promise<PageAudit> {
  const base: PageAudit = {
    route,
    width,
    ok: false,
    mainOverflowY: null,
    contentExceedsMain: null,
    scrollLocked: null,
    mainHorizontalOverflow: null,
    documentHorizontalOverflow: null,
    overflowCandidates: [],
    h1Count: 0,
    h1Sample: [],
    tableCount: 0,
    hasPageHeader: false,
  };

  try {
    const res = await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    base.status = res?.status();
    await page.waitForTimeout(900);

    const metrics = await page.evaluate(() => {
      const main = document.querySelector("main");
      const mainStyle = main ? getComputedStyle(main) : null;
      const contentExceedsMain = main
        ? main.scrollHeight > main.clientHeight + 4
        : null;
      const overflowAllows =
        mainStyle?.overflowY === "auto" ||
        mainStyle?.overflowY === "scroll" ||
        mainStyle?.overflowY === "overlay";
      const scrollLocked =
        contentExceedsMain === null
          ? null
          : contentExceedsMain && !overflowAllows;
      const mainHorizontalOverflow = main
        ? main.scrollWidth > main.clientWidth + 2
        : null;
      const documentHorizontalOverflow =
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 2;

      const candidates: OverflowHit[] = [];
      const all = Array.from(document.querySelectorAll("body *"));
      for (const el of all) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.scrollWidth <= el.clientWidth + 2) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 40) continue;
        const parts: string[] = [];
        let cur: Element | null = el;
        for (let i = 0; i < 5 && cur; i++) {
          const tag = cur.tagName.toLowerCase();
          const id = cur.id ? `#${cur.id}` : "";
          const cls =
            typeof cur.className === "string" && cur.className
              ? `.${cur.className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : "";
          parts.unshift(`${tag}${id}${cls}`);
          cur = cur.parentElement;
        }
        candidates.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          className:
            typeof el.className === "string"
              ? el.className.slice(0, 120)
              : "",
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          path: parts.join(" > "),
        });
        if (candidates.length >= 8) break;
      }

      const h1s = Array.from(document.querySelectorAll("h1")).map(
        (n) => (n.textContent || "").trim().slice(0, 80),
      );

      return {
        mainOverflowY: mainStyle?.overflowY ?? null,
        contentExceedsMain,
        scrollLocked,
        mainHorizontalOverflow,
        documentHorizontalOverflow,
        overflowCandidates: candidates,
        h1Count: h1s.length,
        h1Sample: h1s.slice(0, 3),
        tableCount: document.querySelectorAll("table").length,
        hasPageHeader: !!document.querySelector("h1"),
      };
    });

    Object.assign(base, metrics, { ok: true });
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  return base;
}

async function auditNav(context: BrowserContext, width: number): Promise<NavAudit> {
  await loginViaApi(context);
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await ensureLoggedIn(page);

  // 打开「更多」入口（MobileTabBar）
  const more = page.getByRole("button", { name: "打开完整导航" }).first();
  if (await more.count()) {
    await more.click();
  } else {
    const moreAlt = page.locator("button").filter({ hasText: /更多/ }).first();
    if (await moreAlt.count()) await moreAlt.click();
  }
  await page.waitForTimeout(400);

  const openState = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      openBodyOverflow: document.body.style.overflow || "(empty)",
      openHtmlOverflow: document.documentElement.style.overflow || "(empty)",
      openMainOverflowY: main ? getComputedStyle(main).overflowY : null,
    };
  });

  const drawerOpen = await page.locator(".fixed.inset-0.z-50").count();
  // 关闭：点关闭按钮 / Escape / 遮罩
  const closeBtn = page.locator('button[aria-label="关闭"]').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
  } else if (drawerOpen) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (await page.locator(".fixed.inset-0.z-50").count()) {
      await page.mouse.click(width - 10, 100);
    }
  }
  await page.waitForTimeout(400);

  const closedState = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      closedBodyOverflow: document.body.style.overflow || "(empty)",
      closedHtmlOverflow: document.documentElement.style.overflow || "(empty)",
      closedMainOverflowY: main ? getComputedStyle(main).overflowY : null,
      afterCloseCanClickMain: (() => {
        const el = document.elementFromPoint(
          Math.floor(window.innerWidth / 2),
          Math.floor(window.innerHeight / 2),
        );
        if (!el) return false;
        // 不应仍是全屏遮罩
        const cls = typeof (el as HTMLElement).className === "string"
          ? (el as HTMLElement).className
          : "";
        return !cls.includes("fixed inset-0") && !cls.includes("bg-black/50");
      })(),
    };
  });

  await page.close();

  return {
    width,
    ...openState,
    ...closedState,
    note:
      "AppShell 主滚动在 main，而非 body；仅检查 body.style.overflow 不足以判定抽屉是否锁住背景滚动。",
  };
}

async function main() {
  console.log("=== Phase Mobile-1 UI Audit ===");
  console.log("base:", BASE);
  console.log("email:", EMAIL);
  console.log("engine: Chromium (Playwright)");
  console.log("Safari / iPhone 真机: 未在本脚本验证");

  const browser = await chromium.launch({ headless: true });
  const pages: PageAudit[] = [];
  const nav: NavAudit[] = [];

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width >= 768 ? 1024 : 844 },
      deviceScaleFactor: width >= 768 ? 1 : 2,
      isMobile: width < 768,
      hasTouch: width < 768,
      userAgent:
        width < 768
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          : undefined,
    });
    await loginViaApi(context);
    const page = await context.newPage();

    for (const route of ROUTES) {
      const row = await measurePage(page, route, width);
      pages.push(row);
      const flag =
        row.mainHorizontalOverflow || row.documentHorizontalOverflow
          ? " H-OVERFLOW"
          : "";
      const scroll = row.scrollLocked
        ? " SCROLL-LOCKED"
        : row.contentExceedsMain
          ? " scroll-ok"
          : " fits";
      console.log(
        `[${width}] ${route} → ${row.ok ? "ok" : "FAIL"}${flag}${scroll}${row.error ? " " + row.error : ""}`,
      );
    }

    await page.close();
    await context.close();

    if (width < 768) {
      const navContext = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      try {
        nav.push(await auditNav(navContext, width));
        console.log(`[${width}] nav-drawer → audited`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[${width}] nav-drawer → FAIL ${msg}`);
        nav.push({
          width,
          openBodyOverflow: "n/a",
          openHtmlOverflow: "n/a",
          openMainOverflowY: null,
          closedBodyOverflow: "n/a",
          closedHtmlOverflow: "n/a",
          closedMainOverflowY: null,
          afterCloseCanClickMain: false,
          note: `nav audit failed: ${msg}`,
        });
      }
      await navContext.close();
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    email: EMAIL,
    engine: "chromium-playwright",
    safariVerified: false,
    widths: WIDTHS,
    routes: ROUTES,
    pageCount: pages.length,
    horizontalOverflowHits: pages.filter(
      (p) => p.mainHorizontalOverflow || p.documentHorizontalOverflow,
    ).length,
    loadFailures: pages.filter((p) => !p.ok),
    pages,
    nav,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
  console.log("\n写到", OUT_JSON);
  console.log(
    `横向溢出命中页次: ${summary.horizontalOverflowHits}/${pages.length}`,
  );
  console.log(`加载失败: ${summary.loadFailures.length}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
