/**
 * 轻量单测：lockAppScroll 恢复 previous
 * 运行：npx tsx src/lib/mobile/__tests__/scroll-lock.test.ts
 */

import { lockAppScroll } from "../scroll-lock";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

class FakeEl {
  style = { overflow: "" };
}

function main() {
  console.log("mobile scroll-lock");

  const body = new FakeEl();
  const html = new FakeEl();
  const mainEl = new FakeEl();
  body.style.overflow = "auto";
  mainEl.style.overflow = "scroll";

  (globalThis as unknown as { document: unknown }).document = {
    body,
    documentElement: html,
    querySelector: (sel: string) => (sel === "main" ? mainEl : null),
  };

  const unlock = lockAppScroll();
  assert(body.style.overflow === "hidden", "body locked");
  assert(html.style.overflow === "hidden", "html locked");
  assert(mainEl.style.overflow === "hidden", "main locked");

  unlock();
  assert(body.style.overflow === "auto", "body restored to previous");
  assert(html.style.overflow === "", "html restored to previous");
  assert(mainEl.style.overflow === "scroll", "main restored to previous");

  console.log("结果: passed");
}

main();
