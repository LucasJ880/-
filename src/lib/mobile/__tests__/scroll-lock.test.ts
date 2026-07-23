/**
 * 引用计数 Scroll Lock 单测
 * 运行：npx tsx src/lib/mobile/__tests__/scroll-lock.test.ts
 */

import {
  acquireAppScrollLock,
  releaseAppScrollLock,
  lockAppScroll,
  getActiveScrollLocks,
  __resetScrollLockForTests,
} from "../scroll-lock";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ✓", msg);
}

class FakeEl {
  style = { overflow: "" };
}

function installDom() {
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
  return { body, html, mainEl };
}

function main() {
  console.log("mobile scroll-lock (refcount)");

  // SSR 安全
  const prevDoc = (globalThis as { document?: unknown }).document;
  // @ts-expect-error delete for ssr
  delete (globalThis as { document?: unknown }).document;
  __resetScrollLockForTests();
  const ssrUnlock = lockAppScroll("ssr");
  ssrUnlock();
  ssrUnlock();
  assert(true, "SSR lock/unlock no throw");
  (globalThis as { document?: unknown }).document = prevDoc;

  const { body, html, mainEl } = installDom();
  __resetScrollLockForTests();
  body.style.overflow = "auto";
  html.style.overflow = "";
  mainEl.style.overflow = "scroll";

  // 单锁
  const t1 = acquireAppScrollLock("nav");
  assert(body.style.overflow === "hidden", "single lock body");
  assert(html.style.overflow === "hidden", "single lock html");
  assert(mainEl.style.overflow === "hidden", "single lock main");
  assert(getActiveScrollLocks().length === 1, "one active lock");
  releaseAppScrollLock(t1);
  assert(body.style.overflow === "auto", "single release restores body");
  assert(html.style.overflow === "", "single release restores html");
  assert(mainEl.style.overflow === "scroll", "single release restores main");
  assert(getActiveScrollLocks().length === 0, "no active locks");

  // 双锁嵌套
  body.style.overflow = "auto";
  mainEl.style.overflow = "scroll";
  const a = acquireAppScrollLock("outer");
  const b = acquireAppScrollLock("inner");
  assert(getActiveScrollLocks().length === 2, "two active locks");
  releaseAppScrollLock(a);
  assert(body.style.overflow === "hidden", "after outer release still locked");
  assert(getActiveScrollLocks().length === 1, "one lock remains");
  releaseAppScrollLock(b);
  assert(body.style.overflow === "auto", "last release restores body");
  assert(mainEl.style.overflow === "scroll", "last release restores main");

  // 重复 release
  body.style.overflow = "auto";
  const c = acquireAppScrollLock("dup");
  releaseAppScrollLock(c);
  releaseAppScrollLock(c);
  releaseAppScrollLock(Symbol("unknown"));
  assert(body.style.overflow === "auto", "dup/unknown release safe");
  assert(getActiveScrollLocks().length === 0, "still empty after dup release");

  // 兼容 lockAppScroll + Strict Mode 双 cleanup
  body.style.overflow = "auto";
  mainEl.style.overflow = "scroll";
  const unlock = lockAppScroll("compat");
  assert(body.style.overflow === "hidden", "compat lock");
  unlock();
  unlock();
  assert(body.style.overflow === "auto", "compat double unlock safe");

  // Strict Mode 模拟：mount-unmount-mount
  const u1 = lockAppScroll("strict");
  u1();
  const u2 = lockAppScroll("strict");
  assert(body.style.overflow === "hidden", "strict remount locked");
  u2();
  assert(body.style.overflow === "auto", "strict remount restored");

  // main 不存在
  (globalThis as unknown as { document: unknown }).document = {
    body,
    documentElement: html,
    querySelector: () => null,
  };
  __resetScrollLockForTests();
  body.style.overflow = "auto";
  const noMain = acquireAppScrollLock("no-main");
  assert(body.style.overflow === "hidden", "no-main still locks body");
  releaseAppScrollLock(noMain);
  assert(body.style.overflow === "auto", "no-main restores body");

  console.log("结果: passed");
}

main();
