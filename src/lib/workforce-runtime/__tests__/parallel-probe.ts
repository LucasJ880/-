/**
 * Phase 2B-2 测试专用 —— Prisma delegate 插桩（并发观测 / barrier 注入）
 *
 * 只在测试进程内 monkey-patch `db.<model>.findMany`：按 orgId 过滤记录
 * 每次匹配调用的 [start, end] interval 与并发峰值，并按 (model, take)
 * 匹配规则注入受控行为（barrier / sleep / fail / gate）。生产代码零改动
 * ——真实 overlap 证明（任务书 §25：barrier / controlled promise）在
 * 工具执行的 DB 调用层完成。
 *
 * 匹配点选择依据（adapters.ts 实际查询形态）：
 *   sales_get_pipeline               → salesOpportunity.findMany take:40
 *   sales_list_opportunities         → salesOpportunity.findMany take:30
 *   sales_customer_followup_analysis → (grader 无 key 降级) salesOpportunity.findMany take:20
 *   sales_quote_risk_analysis        → (grader 无 key 降级) salesQuote.findMany take:15
 */

export type ProbeInterval = {
  model: string;
  take: number | undefined;
  start: number;
  end: number;
};

export type ProbeGate = {
  open: () => void;
  readonly opened: Promise<void>;
};

export function createGate(): ProbeGate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

export type ProbeBehavior =
  | { kind: "sleep"; ms: number }
  | { kind: "barrier"; expected: number; timeoutMs?: number }
  | { kind: "fail"; message: string }
  | { kind: "gate"; gate: ProbeGate };

export type ProbeRule = {
  model: "salesOpportunity" | "salesQuote";
  /** 匹配 findMany args.take（缺省匹配任意 take） */
  take?: number;
  behavior: ProbeBehavior;
};

export type DbProbe = {
  intervals: ProbeInterval[];
  calls: () => number;
  maxActive: () => number;
  restore: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** interval 扫描线并发峰值（重叠证明的事后判定） */
export function maxConcurrentIntervals(intervals: ProbeInterval[]): number {
  const events: Array<[number, number]> = [];
  for (const iv of intervals) {
    events.push([iv.start, 1], [iv.end, -1]);
  }
  // 同一时刻先结束后开始（保守估计，不虚增并发）
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let max = 0;
  for (const [, delta] of events) {
    active += delta;
    if (active > max) max = active;
  }
  return max;
}

export function intervalsOverlap(a: ProbeInterval, b: ProbeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 安装插桩。只拦截 where.orgId === orgId 的 findMany；其余调用原样透传。
 * 每条规则的 barrier 状态独立（arrived 计数 + 全体释放）。
 */
export function installDbProbe(
  db: Record<string, unknown>,
  orgId: string,
  rules: ProbeRule[] = [],
): DbProbe {
  const intervals: ProbeInterval[] = [];
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const barrierState = new Map<
    ProbeRule,
    { arrived: number; resolvers: Array<() => void> }
  >();

  async function applyBehavior(rule: ProbeRule): Promise<void> {
    const b = rule.behavior;
    if (b.kind === "sleep") {
      await sleep(b.ms);
      return;
    }
    if (b.kind === "fail") {
      throw new Error(b.message);
    }
    if (b.kind === "gate") {
      await b.gate.opened;
      return;
    }
    // barrier：等待 expected 个参与者全部到达（或超时兜底释放——
    // 超时时并发断言自然失败，测试不会 hang）
    let state = barrierState.get(rule);
    if (!state) {
      state = { arrived: 0, resolvers: [] };
      barrierState.set(rule, state);
    }
    state.arrived++;
    if (state.arrived >= b.expected) {
      for (const r of state.resolvers) r();
      state.resolvers = [];
      return;
    }
    await new Promise<void>((resolve) => {
      state!.resolvers.push(resolve);
      setTimeout(resolve, b.timeoutMs ?? 8000);
    });
  }

  const restores: Array<() => void> = [];
  const models: Array<"salesOpportunity" | "salesQuote"> = [
    "salesOpportunity",
    "salesQuote",
  ];
  for (const model of models) {
    const delegate = (db as Record<string, { findMany: (a?: unknown) => Promise<unknown> }>)[
      model
    ];
    const orig = delegate.findMany.bind(delegate);
    restores.push(() => {
      delegate.findMany = orig;
    });
    delegate.findMany = async (args?: unknown) => {
      const a = (args ?? {}) as {
        where?: { orgId?: unknown };
        take?: number;
      };
      if (a.where?.orgId !== orgId) return orig(args);
      const entry: ProbeInterval = {
        model,
        take: a.take,
        start: Date.now(),
        end: 0,
      };
      calls++;
      active++;
      if (active > maxActive) maxActive = active;
      try {
        const rule = rules.find(
          (r) => r.model === model && (r.take === undefined || r.take === a.take),
        );
        if (rule) await applyBehavior(rule);
        return await orig(args);
      } finally {
        active--;
        entry.end = Date.now();
        intervals.push(entry);
      }
    };
  }

  return {
    intervals,
    calls: () => calls,
    maxActive: () => maxActive,
    restore: () => {
      for (const r of restores) r();
    },
  };
}
