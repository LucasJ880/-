/**
 * BIDPAGE-6「定报价只点一次」——契约、主按钮矩阵与中文（纯函数，零 DB；前后端共用）
 * openspec change quote-one-step-confirm，spec tender/quote-one-step-confirm。
 *
 * - 主按钮按报价状态与看的人的权限决定（design D2）；不可点的原因由编辑器的状态算。
 * - 确认框、通知、结果说明的文字都在这里；通知里不放任何金额、成本、供应商（spec「通知与审计不带金额与成本」）。
 * - 金额一律两位小数、千分位、币种写中文名（与「下一步」同一个 formatMoneyZh）。
 */
import { z } from "zod";
import { formatMoneyZh } from "../next-step";
import { QUOTE_STATUS_ZH } from "../quote-line/contract";

/* ------------------------------ 主按钮 ------------------------------ */

export type QuoteActionButton = "confirm" | "approve" | "return" | "submit";

export const QUOTE_ACTION_LABELS_ZH: Record<QuoteActionButton, string> = {
  confirm: "定为我方报价",
  approve: "批准并定为我方报价",
  return: "退回",
  submit: "提交给负责人",
};

export const QUOTE_ACTION_TEXT = {
  submitted: "已提交，等负责人批准",
  decided: "已定为我方报价",
  approvedNotOurBid: "已批准，还没定为我方报价",
  dirty: "有修改还没保存：先保存或放弃修改",
  invalid: "报价算不出，先按上面的提示改好",
  unpriced: "还有计入但没填数的行，填完才能提交、批准",
  reviewEditable: "待批准时还能改；负责人批准时以那一刻的内容为准，改过以后要重新打开再批准",
  confirming: "正在定…",
  submitting: "正在提交…",
  returning: "正在退回…",
  cancel: "取消",
  ok: "确定",
  returnNotePlaceholder: "退回原因（可不填，最多 500 字），例如：海运费要重新问",
  confirmed: "已定为我方报价",
  returned: "已退回，报价回到草稿",
  networkError: "没有成功（网络问题），请稍后再试",
} as const;

export type ActionBarInput = {
  status: string;
  isOurBid: boolean;
  canEdit: boolean;
  canApprove: boolean;
  /** 现在的我方报价是另一份、并且已中标（这里不改选，design D4） */
  otherOurBidAwarded: boolean;
};

export type ActionBarView = { buttons: QuoteActionButton[]; statusZh: string | null };

/** 主按钮矩阵（spec「主按钮按状态与权限」） */
export function actionBarOf(input: ActionBarInput): ActionBarView {
  const { status, canApprove, canEdit } = input;
  if (status === "draft") {
    if (canApprove) return input.otherOurBidAwarded ? { buttons: [], statusZh: awardedOtherNoteZh() } : { buttons: ["confirm"], statusZh: null };
    if (canEdit) return { buttons: ["submit"], statusZh: null };
    return { buttons: [], statusZh: null };
  }
  if (status === "review") {
    if (canApprove) return input.otherOurBidAwarded ? { buttons: ["return"], statusZh: awardedOtherNoteZh() } : { buttons: ["approve", "return"], statusZh: null };
    return { buttons: [], statusZh: QUOTE_ACTION_TEXT.submitted };
  }
  if (status === "approved") {
    if (input.isOurBid) return { buttons: [], statusZh: QUOTE_ACTION_TEXT.decided };
    if (canApprove && !input.otherOurBidAwarded) return { buttons: ["confirm"], statusZh: null };
    return { buttons: [], statusZh: input.otherOurBidAwarded && canApprove ? awardedOtherNoteZh() : QUOTE_ACTION_TEXT.approvedNotOurBid };
  }
  return { buttons: [], statusZh: QUOTE_STATUS_ZH[status] ?? status };
}

/** 主按钮不可点的原因（spec「主按钮不可点的情况」）；可点时为 null */
export function blockReasonZh(input: { dirty: boolean; computedOk: boolean; unpricedCount: number }): string | null {
  if (input.dirty) return QUOTE_ACTION_TEXT.dirty;
  if (!input.computedOk) return QUOTE_ACTION_TEXT.invalid;
  if (input.unpricedCount > 0) return QUOTE_ACTION_TEXT.unpriced;
  return null;
}

/* ------------------------------ 确认框 ------------------------------ */

export type ConfirmPromptInput = {
  /** 逐行表叫「报价合计」，总价表叫「税前报价」，都是引擎的税前报价（design D5） */
  label: "报价合计" | "税前报价";
  amount: number;
  currency: string;
  /** 要改选时现在的我方报价 */
  current: { version: number; amount: number | null; currency: string } | null;
};

export function confirmPromptZh(input: ConfirmPromptInput): string[] {
  const lines = [`${input.label} ${formatMoneyZh(input.amount, input.currency)}，定了以后内容锁定，要改需另起新版。`];
  if (input.current) {
    const amt = input.current.amount != null ? `（${formatMoneyZh(input.current.amount, input.current.currency)}）` : "";
    lines.push(`现在的我方报价是第 ${input.current.version} 版${amt}，定了以后改成这一份。`);
  }
  return lines;
}

/* ------------------------------ 请求体 ------------------------------ */

const baseUpdatedAt = z.string().min(1).max(64);

export const confirmRequestSchema = z.object({ baseUpdatedAt, expectedSellingPrice: z.number().finite() });
export const submitRequestSchema = z.object({ baseUpdatedAt });
export const returnRequestSchema = z.object({ baseUpdatedAt, note: z.string().max(5000).nullish() });
export const reviseRequestSchema = z.object({ reason: z.string().max(5000) });

export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
export type SubmitRequest = z.infer<typeof submitRequestSchema>;
export type ReturnRequest = z.infer<typeof returnRequestSchema>;
export type ReviseRequest = z.infer<typeof reviseRequestSchema>;

export const RETURN_NOTE_MAX = 500;
export const REVISE_REASON_MAX = 2000;

/** 去掉控制字符（保留换行与制表符）、首尾空白，截到上限；空串为 null */
export function cleanNoteText(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

/* ------------------------------ 中文错误 ------------------------------ */

export const QUOTE_CONFIRM_ERRORS_ZH = {
  changed: "这份报价刚被别人改过或处理过，这次没有定；请收起后重新打开再看",
  changedSubmit: "这份报价刚被别人改过或处理过，这次没有提交；请收起后重新打开再看",
  changedReturn: "这份报价刚被别人改过或处理过，这次没有退回；请收起后重新打开再看",
  syncFailed: "没有定成：同步我方报价时出错，已经全部撤回，请稍后再试",
  invalid: "报价算不出，先按页面上的提示改好",
  notBidQuote: "这份不是投标报价，不能定为我方报价",
  proModeQuote: "这份报价是在专业模式里做的：提交、批准、定为我方报价、另起新版请在专业模式里做",
  reasonRequired: "请写一句为什么要另起新版",
} as const;

export const unpricedZh = (n: number) => `还有 ${n} 行计入但没填数，填完才能提交、批准`;
export const awardedOtherZh = (version: number) => `现在的我方报价第 ${version} 版已中标，这里不改选；要改请在专业模式里做`;
export function awardedOtherNoteZh(): string {
  return "现在的我方报价已中标，这里不改选；要改请在专业模式里做";
}
export const cannotFromStatusZh = (status: string, actionZh: string) => `这份报价「${QUOTE_STATUS_ZH[status] ?? status}」，不能${actionZh}`;

/* ------------------------------ 冻结提示 ------------------------------ */

/** 锁定的报价：已批准的写「另起新版」，已中标的写去专业模式，其余只写状态（spec tender/quote-line-mode） */
export function frozenNoteZh(status: string): string {
  const head = `这份报价「${QUOTE_STATUS_ZH[status] ?? status}」，内容锁定`;
  if (status === "approved") return `${head}；要改请点「另起新版」`;
  if (status === "awarded") return `${head}；中标以后的事在专业模式里做`;
  return head;
}

/* ------------------------------ 通知 ------------------------------ */

/** 负责人收到的站内通知：没有金额、成本、供应商（design D7） */
export function reviewNotificationZh(input: { projectName: string; submitterName: string; quoteName: string; version: number }): { title: string; summary: string } {
  return {
    title: `报价等你批准：${input.projectName}`,
    summary: `${input.submitterName} 提交了「${input.quoteName}」第 ${input.version} 版，请到「标书与报价」② 批准并定为我方报价，或退回。`,
  };
}

export type NotifyOutcome =
  | { kind: "notified"; ownerName: string }
  | { kind: "gated" }
  | { kind: "no_recipient" }
  | { kind: "self" }
  | { kind: "failed" };

export function notifyOutcomeZh(o: NotifyOutcome): string {
  switch (o.kind) {
    case "notified":
      return `已提交，已通知负责人 ${o.ownerName}`;
    case "gated":
      return "已提交；负责人关掉了站内通知或这类通知，没有收到，请直接告诉负责人";
    case "no_recipient":
      return "已提交；项目负责人不是本组织的在职成员，没有人收到通知，请直接联系有批准权限的同事";
    case "self":
      return "已提交；你就是项目负责人，没有发通知";
    case "failed":
      return "已提交；通知没发出去，请直接告诉负责人";
  }
}

/** 通知点开的去处（与 `notifications/href.ts` 的 bid_quote 对上） */
export const BID_QUOTE_HASH_PREFIX = "bid-quote-";
export function bidQuoteHref(projectId: string, quoteId: string): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=bid#${BID_QUOTE_HASH_PREFIX}${encodeURIComponent(quoteId)}`;
}
/** 地址里的 #bid-quote-{id} → 报价 id（#bid-quote-area 不是） */
export function quoteIdFromHash(hash: string | null | undefined): string | null {
  let id = (hash ?? "").replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    /* 写坏了就按原样 */
  }
  if (!id.startsWith(BID_QUOTE_HASH_PREFIX)) return null;
  const q = id.slice(BID_QUOTE_HASH_PREFIX.length).trim();
  return q && q !== "area" ? q : null;
}

/* ------------------------------ 我方报价一行 ------------------------------ */

export type OurBidLine =
  | {
      status: "AUTHORITATIVE";
      quoteId: string;
      version: number;
      quoteStatus: string;
      sellingPrice: number | null;
      currency: string;
      decidedBy: string | null;
      /** ISO 时间 */
      decidedAt: string | null;
      entryMode: "LINE" | "LUMP_SUM" | null;
    }
  | { status: "QUOTE_REVISION_PENDING"; quoteId: string; version: number; pending: { id: string; version: number; status: string } | null }
  | { status: "NONE"; approvedCount: number };

/** 多伦多时间 YYYY-MM-DD HH:mm */
export function formatDecidedAtZh(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function ourBidLineZh(line: OurBidLine): string {
  if (line.status === "AUTHORITATIVE") {
    const amount = line.sellingPrice != null ? `，${formatMoneyZh(line.sellingPrice, line.currency)}` : "";
    const when = line.decidedAt ? formatDecidedAtZh(line.decidedAt) : "";
    const who = [line.decidedBy, when].filter((x) => !!x).join(" ");
    return `我方报价：第 ${line.version} 版${amount}${who ? `，${who} 定的` : ""}`;
  }
  if (line.status === "QUOTE_REVISION_PENDING") {
    const next = line.pending ? `，新版第 ${line.pending.version} 版是${QUOTE_STATUS_ZH[line.pending.status] ?? line.pending.status}` : "";
    return `我方报价第 ${line.version} 版已另起新版${next}，定了以后才是我方报价`;
  }
  return line.approvedCount > 0 ? `还没有我方报价；已批准 ${line.approvedCount} 份，还没定为我方报价` : "还没有我方报价";
}

/* ------------------------------ 另起新版 ------------------------------ */

export const REVISE_TEXT = {
  button: "另起新版",
  prompt: "另起新版：把这份报价复制成新一版草稿，这一版改成「已被新版替代」，新版定了以后才是我方报价。请写一句为什么要改：",
  placeholder: "例如：招标方要求降价",
  submitting: "正在另起新版…",
} as const;

/* ------------------------------ 接口结果 ------------------------------ */

export type ConfirmResult = {
  id: string;
  status: "approved";
  version: number;
  isOurBid: true;
  /** 改选前的我方报价（改选了才有） */
  reselectedFrom: { id: string; version: number } | null;
  /** 本来就是我方报价，什么都没做 */
  alreadyOurBid: boolean;
};
export type SubmitResult = { id: string; status: "review"; version: number; notify: NotifyOutcome; messageZh: string };
export type ReturnResult = { id: string; status: "draft"; version: number };
export type ReviseResult = { id: string; version: number; entryMode: "LINE" | "LUMP_SUM" | null; proModeHref: string };
