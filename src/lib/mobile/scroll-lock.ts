/**
 * AppShell 主滚动锁（body / html / main）。
 * Token + 引用计数：仅第一个锁保存原始 overflow，最后一个释放才恢复。
 */

export type ScrollLockToken = symbol;

type OriginalState = {
  bodyOverflow: string;
  htmlOverflow: string;
  mainOverflow: string | null;
};

type LockRecord = {
  token: ScrollLockToken;
  reason: string;
  createdAt: number;
};

const activeLocks = new Map<ScrollLockToken, LockRecord>();
let originalState: OriginalState | null = null;

function asStyleHost(
  el: Element | null,
): { style: { overflow: string } } | null {
  if (!el || !("style" in el)) return null;
  const style = (el as { style?: { overflow?: string } }).style;
  if (!style || typeof style.overflow !== "string") return null;
  return el as { style: { overflow: string } };
}

function resolveMain() {
  if (typeof document === "undefined") return null;
  return asStyleHost(document.querySelector("main"));
}

function applyLockStyles() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;
  const main = resolveMain();

  if (!originalState) {
    originalState = {
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
      mainOverflow: main ? main.style.overflow : null,
    };
  }

  body.style.overflow = "hidden";
  html.style.overflow = "hidden";
  if (main) {
    main.style.overflow = "hidden";
  }
}

function restoreIfIdle() {
  if (activeLocks.size > 0) return;
  if (typeof document === "undefined") {
    originalState = null;
    return;
  }
  if (!originalState) return;

  const body = document.body;
  const html = document.documentElement;
  const main = resolveMain();

  body.style.overflow = originalState.bodyOverflow;
  html.style.overflow = originalState.htmlOverflow;
  if (main && originalState.mainOverflow !== null) {
    main.style.overflow = originalState.mainOverflow;
  }

  originalState = null;
}

/**
 * 获取一把滚动锁。重复 release 同一 token 安全；不影响其他锁。
 */
export function acquireAppScrollLock(reason = "anonymous"): ScrollLockToken {
  if (typeof document === "undefined") {
    return Symbol(`ssr-scroll-lock:${reason}`);
  }

  const token = Symbol(`scroll-lock:${reason}`);
  activeLocks.set(token, {
    token,
    reason,
    createdAt: Date.now(),
  });
  applyLockStyles();
  return token;
}

/**
 * 释放指定 token。未知 / 已释放 token 为 no-op。
 */
export function releaseAppScrollLock(token: ScrollLockToken): void {
  if (!activeLocks.has(token)) return;
  activeLocks.delete(token);
  restoreIfIdle();
}

/**
 * 兼容 Mobile-1 API：内部走引用计数。
 */
export function lockAppScroll(reason = "lockAppScroll"): () => void {
  const token = acquireAppScrollLock(reason);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAppScrollLock(token);
  };
}

/** 开发调试：当前持有的锁（生产可用，但不在 UI 展示） */
export function getActiveScrollLocks(): Array<{
  token: string;
  reason: string;
  createdAt: number;
}> {
  return Array.from(activeLocks.values()).map((r) => ({
    token: String(r.token),
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}

declare global {
  interface Window {
    __qyGetActiveScrollLocks?: typeof getActiveScrollLocks;
  }
}

if (typeof window !== "undefined") {
  window.__qyGetActiveScrollLocks = getActiveScrollLocks;
}

/** 测试辅助：重置模块状态（仅测试用） */
export function __resetScrollLockForTests(): void {
  activeLocks.clear();
  originalState = null;
  if (typeof document !== "undefined") {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    const main = resolveMain();
    if (main) main.style.overflow = "";
  }
}
