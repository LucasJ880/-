/**
 * Capture AR2-1 UI P1 fixture screenshots (desktop + 375 mobile).
 * Usage: node scripts/ar2-ui-p1-screenshots.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const html = path.join(
  root,
  "docs/acceptance/screenshots/ar2-1-ui-p1-fixture.html",
);
const outDir = path.join(root, "docs/acceptance/screenshots");

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(`file://${html}`);
  await shot(desktop, "ar2-1-ui-p1-8-steps-desktop.png");
  await desktop.locator('[data-testid="runtime-v2-priority"]').screenshot({
    path: path.join(outDir, "ar2-1-ui-p1-priority-scores.png"),
  });
  await desktop.locator('[data-testid="pending-action-card"]').first().screenshot({
    path: path.join(outDir, "ar2-1-ui-p1-pending-action-card.png"),
  });

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await mobile.goto(`file://${html}`);
  await shot(mobile, "ar2-1-ui-p1-375-mobile.png");
  await shot(mobile, "ar2-1-ui-p1-refresh-same-runid.png");
} finally {
  await browser.close();
}
