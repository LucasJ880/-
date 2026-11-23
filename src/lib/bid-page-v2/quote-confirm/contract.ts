/**
 * BIDPAGE-6「定报价只点一次」——契约、主按钮矩阵与中文（纯函数，零 DB；前后端共用）
 * openspec change quote-one-step-confirm，spec tender/quote-one-step-confirm。
 *
 * - 主按钮按报价状态与看的人的权限决定（design D2）；不可点的原因由编辑器的状态算。
 * - 确认框、通知、结果说明的文字都在这里；通知里不放任何金额、成本、供应商（spec「通知与审计不带金额与成本」）。
 * - 金额一律两位小数、千分位、币种写中文名（与「下一步」同一个 formatMoneyZh）。
 */
import { z } from "zod";
import { redactText } from "@/lib/notifications/collab/redact";
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
  approvedNotOurBid: "已批准，还没定为我方报价；要定请找负责人",
  dirty: "有修改还没保存：先保存或放弃修改",
  invalid: "报价算不出：先按下面「还算不出报价」那条提示改好",
  /** 提交以后还能改：有批准权限的人读的那一句 */
  reviewEditableApprover: "提交以后还能改；你打开以后如果有人又保存过，批准时会提示你重新打开看最新内容",
  /** 只有编辑权限的人读的那一句 */
  reviewEditableEditor: "等批准期间还能改，改完记得保存；负责人看到的是最后保存的内容",
  confirming: "正在定为我方报价…",
  submitting: "正在提交…",
  returning: "正在退回…",
  cancel: "取消",
  ok: "确定",
  returnNotePlaceholder: "退回原因（可不填，最多 500 字；只记在操作记录里，提交人不会收到通知），例如：海运费要重新问",
  returned: "已退回，报价回到草稿；退回不会通知提交人，请直接告诉他为什么退回",
  networkError: "没有成功（网络问题），请稍后再试",
} as const;

export type ActionBarInput = {
  status: string;
  isOurBid: boolean;
  canEdit: boolean;
  canApprove: boolean;
  /** 现在的我方报价是另一份、并且已中标（这里不改选，design D4） */
  otherOurBidAwarded: boolean;
  /** 那一份的版本（写进说明） */
  otherOurBidVersion?: number | null;
};

export type ActionBarView = { buttons: QuoteActionButton[]; statusZh: string | null };

/** 主按钮矩阵（spec「主按钮按状态与权限」） */
export function actionBarOf(input: ActionBarInput): ActionBarView {
  const { status, canApprove, canEdit } = input;
  if (status === "draft") {
    if (canApprove) return input.otherOurBidAwarded ? { buttons: [], statusZh: awardedOtherNoteZh(input.otherOurBidVersion) } : { buttons: ["confirm"], statusZh: null };
    if (canEdit) return { buttons: ["submit"], statusZh: null };
    return { buttons: [], statusZh: null };
  }
  if (status === "review") {
    if (canApprove) return input.otherOurBidAwarded ? { buttons: ["return"], statusZh: awardedOtherNoteZh(input.otherOurBidVersion) } : { buttons: ["approve", "return"], statusZh: null };
    return { buttons: [], statusZh: QUOTE_ACTION_TEXT.submitted };
  }
  if (status === "approved") {
    if (input.isOurBid) return { buttons: [], statusZh: QUOTE_ACTION_TEXT.decided };
    if (canApprove && !input.otherOurBidAwarded) return { buttons: ["confirm"], statusZh: null };
    return { buttons: [], statusZh: input.otherOurBidAwarded && canApprove ? awardedOtherNoteZh(input.otherOurBidVersion) : QUOTE_ACTION_TEXT.approvedNotOurBid };
  }
  return { buttons: [], statusZh: QUOTE_STATUS_ZH[status] ?? status };
}

/** 有没填数的行时界面上的原因：按钮名跟着看的人的按钮走（与 BIDPAGE-3 / 4 的「有的行还没填供应商报价」同一说法；不写行数，视图里的警告按种类去过重） */
export const unpricedBlockZh = (actionZh: string) => `有的行还没填供应商报价（或某项比例空着），填完才能${actionZh}`;

/** 主按钮不可点的原因（spec「主按钮不可点的情况」）；可点时为 null。hasUnpriced：视图里有「未定价」警告 */
export function blockReasonZh(input: { dirty: boolean; computedOk: boolean; hasUnpriced: boolean; actionZh: string }): string | null {
  if (input.dirty) return QUOTE_ACTION_TEXT.dirty;
  if (!input.computedOk) return QUOTE_ACTION_TEXT.invalid;
  if (input.hasUnpriced) return unpricedBlockZh(input.actionZh);
  return null;
}

/* ------------------------------ 确认框 ------------------------------ */

export type ConfirmPromptInput = {
  /** 逐行表叫「报价合计」，总价表叫「税前报价」，都是引擎的税前报价（design D5） */
  label: "报价合计" | "税前报价";
  amount: number;
  currency: string;
  /** 已批准、还没选上的报价：本来就锁着 */
  alreadyApproved?: boolean;
  /** 要改选时现在的我方报价（每份报价各自从第 1 版数起，所以带上名称） */
  current: { name: string; version: number; amount: number | null; currency: string } | null;
  /** 我方报价正在另起新版（新版还没定），这一份不是那份新版：定了以后同样换成这一份 */
  revisionPending?: { version: number } | null;
};

export function confirmPromptZh(input: ConfirmPromptInput): string[] {
  const money = formatMoneyZh(input.amount, input.currency);
  const lines = [input.alreadyApproved ? `${input.label} ${money}，这份已批准、内容已锁定；定为我方报价后，要改需另起新版。` : `${input.label} ${money}，定了以后内容锁定，要改需另起新版。`];
  if (input.current) {
    const amt = input.current.amount != null ? `（${formatMoneyZh(input.current.amount, input.current.currency)}）` : "";
    lines.push(`现在的我方报价是「${input.current.name}」第 ${input.current.version} 版${amt}，定了以后我方报价换成这一份。`);
  } else if (input.revisionPending) {
    lines.push(`现在的我方报价第 ${input.revisionPending.version} 版正在另起新版（新版还没定），定了以后我方报价换成这一份。`);
  }
  return lines;
}

/** 定好以后的一句：改选了写原来那份还在（或原来那份已被新版替代）；没改选不再多说（我方报价一行与锁定说明已经写了） */
export function confirmedNoteZh(previous: { name: string; version: number } | { superseded: true; version: number } | null): string | null {
  if (!previous) return null;
  if ("superseded" in previous) return `已定为我方报价；原来的我方报价第 ${previous.version} 版已另起新版，不再是我方报价`;
  return `已定为我方报价；原来的「${previous.name}」第 ${previous.version} 版仍是已批准，需要时可以再定回去`;
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
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

/* ------------------------------ 中文错误 ------------------------------ */

export const QUOTE_CONFIRM_ERRORS_ZH = {
  changed: "这份报价刚被改过或刚被处理过（也可能是你在别的窗口或专业模式里改的），这次没有定；点「收起」再「打开」看最新内容",
  changedSubmit: "这份报价刚被改过或刚被处理过（也可能是你在别的窗口或专业模式里改的），这次没有提交；点「收起」再「打开」看最新内容",
  changedReturn: "这份报价刚被改过或刚被处理过（也可能是你在别的窗口或专业模式里改的），这次没有退回；点「收起」再「打开」看最新内容",
  syncFailed: "没有定成：更新项目的我方报价时出错，这次的操作都已撤回（报价和我方报价都没变）。请稍后再试；还不行，可能是现在的我方报价算不出，请在专业模式里打开它看看",
  invalid: "报价算不出：先按下面「还算不出报价」那条提示改好",
  notBidQuote: "这份是旧版报价单（外贸标准报价），不能在这里提交、批准或定为我方报价",
  proModeQuote: "这份报价是在专业模式里做的：提交、批准、定为我方报价、另起新版请在专业模式里做",
  reasonRequired: "请写一句为什么要另起新版",
  lockConflict: "同一时间有别的操作在改这份报价或这个项目的我方报价，这次没有定、什么都没改；请再点一次",
} as const;

export const unpricedZh = (n: number, actionZh: string) => `还有 ${n} 行没填数（供应商报价或比例空着），填完才能${actionZh}`;
export const awardedOtherZh = (version: number) => `现在的我方报价第 ${version} 版已中标，这里不能把我方报价换成别的报价；确实要换，请在专业模式里做`;
export function awardedOtherNoteZh(version?: number | null): string {
  return `现在的我方报价${version != null ? `第 ${version} 版` : ""}已中标，这里不能把我方报价换成别的报价；确实要换，请在专业模式里做`;
}
/** 状态不对（界面只对与视图状态相符的报价发请求，所以多半是别人刚处理过） */
export const cannotFromStatusZh = (status: string, actionZh: string) => {
  const base = `这份报价现在是「${QUOTE_STATUS_ZH[status] ?? status}」，不能${actionZh}；可能刚被别人处理过，点「收起」再「打开」看最新状态`;
  return status === "superseded" ? `${base}（新版已经有了，请在列表里打开新版）` : base;
};

/* ------------------------------ 锁定说明 ------------------------------ */

/** 锁定的报价：已批准的写「另起新版」（没有编辑权限的写找人），已中标的写去专业模式，被替代的写打开新版（spec「锁定的报价怎么写」） */
export function frozenNoteZh(status: string, canEdit = true): string {
  const head = `这份报价「${QUOTE_STATUS_ZH[status] ?? status}」，内容锁定`;
  if (status === "approved") return canEdit ? `${head}；要改请点「另起新版」` : `${head}；要改请找有编辑权限的同事另起新版`;
  if (status === "awarded") return `${head}；要改或做中标后的事（建项目预算等），请在专业模式里做`;
  if (status === "superseded") return `${head}；请打开新版`;
  return head;
}

/* ------------------------------ 通知 ------------------------------ */

/** 通知标题里的项目名超过 24 个字截断加「…」（与询价进展通知同一写法） */
export const NOTIFY_PROJECT_NAME_MAX = 24;

/**
 * 负责人收到的站内通知：没有金额、成本、供应商（design D7）。
 * 项目名、报价名、提交人姓名是人填的：先过通知的脱敏（含金额、电话、地址等就整段换成「含敏感信息」），与询价进展通知同一做法。
 */
export function reviewNotificationZh(input: { projectName: string; submitterName: string; quoteName: string; version: number }): { title: string; summary: string } {
  const project = redactText(input.projectName.trim() || "未命名项目");
  const chars = Array.from(project);
  const projectLabel = chars.length > NOTIFY_PROJECT_NAME_MAX ? `${chars.slice(0, NOTIFY_PROJECT_NAME_MAX).join("")}…` : project;
  return {
    title: `报价等你批准 · ${projectLabel}`,
    summary: `${redactText(input.submitterName) || "一位同事"} 提交了「${redactText(input.quoteName)}」第 ${input.version} 版，点开可批准并定为我方报价，或退回。`,
  };
}

export type NotifyOutcome =
  | { kind: "notified"; ownerName: string }
  | { kind: "gated" }
  | { kind: "no_recipient" }
  | { kind: "self" }
  | { kind: "failed" };

/** 要提交的人自己去通知负责人的几种结果（界面上醒目显示） */
export const notifyNeedsFollowUp = (o: NotifyOutcome): boolean => o.kind === "gated" || o.kind === "no_recipient" || o.kind === "failed";

export function notifyOutcomeZh(o: NotifyOutcome): string {
  switch (o.kind) {
    case "notified":
      return `已提交，已通知负责人 ${o.ownerName}`;
    case "gated":
      return "已提交；负责人在通知设置里关掉了这类通知，系统没有提醒他，请直接告诉负责人";
    case "no_recipient":
      return "已提交；负责人的账号已停用或不在本组织里（比如导入数据用的系统账号），没人收到通知；请直接找有批准权限的同事，或请管理员给项目换一个负责人";
    case "self":
      return "已提交；你就是负责人，没有发通知";
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
      /** 报价名（与列表同一个写法）：每份报价各自从第 1 版数起，只写版本分不清是哪一份 */
      name: string;
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
    const awarded = line.quoteStatus === "awarded" ? "（已中标）" : "";
    return `我方报价：「${line.name}」第 ${line.version} 版${awarded}${amount}${who ? `，${who} 定的` : ""}`;
  }
  if (line.status === "QUOTE_REVISION_PENDING") {
    const next = line.pending ? `，新版第 ${line.pending.version} 版现在「${QUOTE_STATUS_ZH[line.pending.status] ?? line.pending.status}」` : "";
    return `我方报价第 ${line.version} 版已另起新版${next}，新版定为我方报价后才算数`;
  }
  return line.approvedCount > 0 ? `还没有我方报价：已批准 ${line.approvedCount} 份，打开要用的那一份点「定为我方报价」` : "还没有我方报价";
}

/* ------------------------------ 另起新版 ------------------------------ */

export const REVISE_TEXT = {
  button: "另起新版",
  /** 这一份就是我方报价时 */
  promptOurBid: "另起新版：把这份报价复制成新一版草稿，这一版改成「已被新版替代」。新版定为我方报价之前，项目暂时没有我方报价，也不能按价格表导出。请写一句为什么要改：",
  /** 不是我方报价时 */
  promptOther: "另起新版：把这份报价复制成新一版草稿，这一版改成「已被新版替代」，我方报价不变。请写一句为什么要改：",
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
