/**
 * Capture AR2-1 Inline Approval UX fixture screenshots.
 * Usage: node scripts/ar2-ui-p1-screenshots.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

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
  await shot(desktop, "ar2-1-inline-approval-panel.png");
  await desktop.locator('[data-testid="sticky-approval-bar"]').screenshot({
    path: path.join(outDir, "ar2-1-sticky-approval-bar.png"),
  });
  await desktop.locator('[data-testid="inline-approval-panel"]').screenshot({
    path: path.join(outDir, "ar2-1-multi-action-select.png"),
  });

  // 模拟确认后执行态
  await desktop.evaluate(() => {
    const exec = document.getElementById("exec-state");
    if (exec) exec.style.display = "flex";
  });
  await shot(desktop, "ar2-1-post-confirm-executing.png");

  // Verifier completed
  await desktop.evaluate(() => {
    const c = document.getElementById("completed-card");
    if (c) c.style.display = "block";
    const sticky = document.querySelector('[data-testid="sticky-approval-bar"]');
    if (sticky) sticky.style.display = "none";
  });
  await shot(desktop, "ar2-1-verifier-completed.png");

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await mobile.goto(`file://${html}`);
  await shot(mobile, "ar2-1-ui-p1-375-mobile.png");
} finally {
  await browser.close();
}

console.log(
  "files",
  fs.readdirSync(outDir).filter((f) => f.startsWith("ar2-1-")),
);
