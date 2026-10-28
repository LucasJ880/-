/**
 * INSTALL-2b：装完待收尾款（纯函数）
 *
 * 尾款确认记录 = AuditLog 行：action "install.balance.confirmed"，targetType "blinds_order"，targetId = 工艺单 id，
 * afterData JSON { quoteId, expected, received, method, receivedAt, note, byUserId }（design D1）。
 * "已确认"只看记录是否存在，不看工艺单状态（design D2）。
 */

export const INSTALL_BALANCE_CONFIRMED = "install.balance.confirmed" as const;
export const BALANCE_TARGET_TYPE = "blinds_order" as const;

/** 收款方式沿用定金四种；e-transfer 已在定金登记有意下线，不加回（design D10） */
export const BALANCE_METHODS = ["cash", "visa", "check", "finance"] as const;
export type BalanceMethod = (typeof BALANCE_METHODS)[number];
export const BALANCE_METHOD_LABEL: Record<BalanceMethod, string> = {
  cash: "Cash（现金）",
  visa: "Visa",
  check: "支票（Cheque）",
  finance: "Finance（融资）",
};

/** 站内通知类型与实体 */
export const NOTIFY_INSTALL_COMPLETED = "install_completed" as const;
export const NOTIFY_BALANCE_CONFIRMED = "install_balance_confirmed" as const;
/** 发给持 install.balance.confirm 者的通知实体：落到会计"待收尾款"页签 */
export const ENTITY_INSTALL_BALANCE = "install_balance" as const;

export const BALANCE_NOTE_MAX = 500;
const AMOUNT_MAX = 10_000_000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type QuoteMoney = {
  grandTotal: number | null;
  agreedBalanceAmount: number | null;
  depositAmount: number | null;
};

/**
 * 应收尾款（design D3）：有约定尾款取约定尾款；否则 总价 − 已登记定金（未登记按 0），不小于 0。
 * 没有关联报价 → null。会计页与销售首页共用。
 */
export function quoteBalanceDue(q: QuoteMoney | null | undefined): number | null {
  if (!q) return null;
  if (finite(q.agreedBalanceAmount)) return round2(Math.max(0, q.agreedBalanceAmount));
  const total = finite(q.grandTotal) ? q.grandTotal : 0;
  const deposit = finite(q.depositAmount) ? q.depositAmount : 0;
  return round2(Math.max(0, total - deposit));
}

/** 实收与应收相差 0.01 及以上（应收为空时不比较） */
export function balanceMismatch(expected: number | null, received: number): boolean {
  if (expected === null) return false;
  return Math.abs(round2(received) - round2(expected)) >= 0.01 - 1e-9;
}

/** 某时区的当天 YYYY-MM-DD（en-CA 格式即 ISO 日期） */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type BalanceConfirmValue = {
  amount: number;
  method: BalanceMethod;
  receivedAt: string;
  note: string;
};

export type BalanceConfirmCheck =
  | { ok: true; value: BalanceConfirmValue; mismatch: boolean }
  | { ok: false; code: "INVALID" | "NOTE_REQUIRED"; error: string };

/** 确认入参校验（spec「确认收到尾款」「差额必须说明」）；today = 企业时区当天 */
export function validateBalanceConfirm(raw: unknown, ctx: { expected: number | null; today: string }): BalanceConfirmCheck {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const amount = typeof o.amount === "string" && o.amount.trim() !== "" ? Number(o.amount) : o.amount;
  if (!finite(amount) || amount <= 0 || amount > AMOUNT_MAX) {
    return { ok: false, code: "INVALID", error: "实收金额须大于 0" };
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return { ok: false, code: "INVALID", error: "实收金额最多两位小数" };
  }
  const method = typeof o.method === "string" ? o.method : "";
  if (!(BALANCE_METHODS as readonly string[]).includes(method)) {
    return { ok: false, code: "INVALID", error: "收款方式只能是 Cash / Visa / 支票 / Finance" };
  }
  const receivedAt = typeof o.receivedAt === "string" ? o.receivedAt.trim() : "";
  if (!validDate(receivedAt)) return { ok: false, code: "INVALID", error: "收款日期格式应为 YYYY-MM-DD" };
  if (receivedAt > ctx.today) return { ok: false, code: "INVALID", error: "收款日期不能晚于今天" };
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note.length > BALANCE_NOTE_MAX) return { ok: false, code: "INVALID", error: `备注不超过 ${BALANCE_NOTE_MAX} 字` };
  const mismatch = balanceMismatch(ctx.expected, amount);
  if (mismatch && !note) {
    return { ok: false, code: "NOTE_REQUIRED", error: "实收与应收不一致，请写明差额原因" };
  }
  return { ok: true, value: { amount: round2(amount), method: method as BalanceMethod, receivedAt, note }, mismatch };
}

export type BalanceRecord = {
  quoteId: string | null;
  expected: number | null;
  received: number;
  method: string;
  receivedAt: string;
  note: string;
  byUserId: string;
  confirmedAt: string;
};

/** 解析尾款确认审计行；坏数据 → null */
export function parseBalanceRecord(row: { afterData: string | null; createdAt: Date | string; userId: string }): BalanceRecord | null {
  if (!row.afterData) return null;
  try {
    const d = JSON.parse(row.afterData) as Record<string, unknown>;
    if (!finite(d.received)) return null;
    return {
      quoteId: typeof d.quoteId === "string" ? d.quoteId : null,
      expected: finite(d.expected) ? d.expected : null,
      received: d.received,
      method: typeof d.method === "string" ? d.method : "",
      receivedAt: typeof d.receivedAt === "string" ? d.receivedAt : "",
      note: typeof d.note === "string" ? d.note : "",
      byUserId: typeof d.byUserId === "string" ? d.byUserId : row.userId,
      confirmedAt: new Date(row.createdAt).toISOString(),
    };
  } catch {
    return null;
  }
}

/** 销售首页待收尾款（spec「销售首页待收尾款」）：逐单应收之和，剔除已确认的报价 */
export function sumBalanceDue(quotes: Array<QuoteMoney & { id: string }>, confirmedQuoteIds: ReadonlySet<string>): number {
  return round2(
    quotes.filter((q) => !confirmedQuoteIds.has(q.id)).reduce((s, q) => s + (quoteBalanceDue(q) ?? 0), 0),
  );
}

/**
 * INSTALL-2b 通知落点（design D6）：头部通知下拉与通知页在既有分支之前先调这里。
 * 发给持 install.balance.confirm 者 → 会计"待收尾款"页签；发给销售 → 工艺单详情（创建人可读）。
 * 不是 INSTALL-2b 的通知 → null（走既有分支）。
 */
export function installNotificationHref(item: {
  type?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): string | null {
  if (!item.entityId) return null;
  const id = encodeURIComponent(item.entityId);
  if (item.entityType === ENTITY_INSTALL_BALANCE) return `/accounting?tab=balance&order=${id}`;
  if (
    item.entityType === "blinds_order" &&
    (item.type === NOTIFY_INSTALL_COMPLETED || item.type === NOTIFY_BALANCE_CONFIRMED)
  ) {
    return `/blinds-orders/${id}`;
  }
  return null;
}
