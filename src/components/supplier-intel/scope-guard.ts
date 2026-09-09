"use client";

/**
 * FR2：异步上下文隔离。
 *
 * 采购工作台上同时存在多路在途请求：首屏加载、状态轮询、写后刷新、身份核对、
 * 供应商检索、抽屉内的每个动作。它们回来的顺序**不等于**发出的顺序，而用户随时会
 * 切组织、切项目、换一条线索、关抽屉。没有隔离时会出现：
 *
 *   打开线索 A → 点「核对身份」→ 打开线索 B → A 的结果回来 → B 的抽屉里显示 A 的候选供应商。
 *
 * 这类串台在采购场景里是会出事的：人看到的是 B，点下去关联的是 A 算出来的那家。
 *
 * 这里用**值**（scope 字符串）而不是自增计数器判定归属：计数器在 React StrictMode
 * 的重复执行下会错位，值比较不会。同一 scope 内再用 ticket 实现「后发者胜」，
 * 并让 finally 只能清掉自己那一轮的忙碌态（FR2-E）。
 */

export interface ScopedTicket {
  readonly scope: string | null;
  readonly signal: AbortSignal;
  /** 响应回来时：是否仍属于当前作用域**且**仍是该槽位最新的一次请求 */
  isCurrent(): boolean;
  /** 仅作用域仍然一致（用于「刷新列表可以，但别动当前选择」这类判断） */
  isSameScope(): boolean;
  /** finally 用：仅当自己仍是最新一轮时才允许清理忙碌态 */
  shouldSettle(): boolean;
  done(): void;
}

export class ScopeGuard {
  private scope: string | null = null;
  private readonly tickets = new Map<string, number>();
  private controllers = new Set<AbortController>();

  /** 当前作用域（org+project、或抽屉里的 signalId）。变化时放弃全部在途请求。 */
  setScope(next: string | null): boolean {
    if (next === this.scope) return false;
    this.scope = next;
    this.abortAll();
    this.tickets.clear();
    return true;
  }

  currentScope(): string | null {
    return this.scope;
  }

  /** 开一轮请求。slot 用于区分「同一作用域下的不同状态槽」，各自独立后发者胜。 */
  begin(slot: string): ScopedTicket {
    const scope = this.scope;
    const seq = (this.tickets.get(slot) ?? 0) + 1;
    this.tickets.set(slot, seq);
    const ctrl = new AbortController();
    this.controllers.add(ctrl);
    let finished = false;
    // 箭头函数天然捕获实例，不需要把 this 另存一份
    return {
      scope,
      signal: ctrl.signal,
      isSameScope: () => this.scope === scope,
      isCurrent: () =>
        this.scope === scope && this.tickets.get(slot) === seq && !ctrl.signal.aborted,
      shouldSettle: () => this.scope === scope && this.tickets.get(slot) === seq,
      done: () => {
        if (finished) return;
        finished = true;
        this.controllers.delete(ctrl);
      },
    };
  }

  abortAll(): void {
    const ctrls = this.controllers;
    this.controllers = new Set();
    for (const c of ctrls) c.abort();
  }
}
