/**
 * W-1 询价 Web 入口 — 纯函数（零 DB / 零 LLM / 零 Node 内置模块，前后端都可引用）
 *
 * 只做「查表」：入口能不能发、为什么不能发、去哪解决；错误码 → 人话；轮次状态行；耗时标签；预览白名单。
 * 判定所需的事实（轮次锁、要求条数、发件授权）由 web-entry.ts 从库里读好再传进来，
 * 与 prepareRfqRound / execTenderSendRfq 用的是同一套函数（decideRoundLock / buildRfqDocument / resolveSender）。
 */

/* ---------------------------------- 类型 ---------------------------------- */

export type EntryBlockReason =
  | "pending_approval"
  | "recently_sent"
  | "no_confirmed_requirements"
  | "sensitive_leak"
  | "sender_not_connected"
  | "sender_no_compose_scope"
  | "no_ready_suppliers";

export type EntryAction = { label: string; href: string };

export type RfqEntryState = {
  enabled: boolean;
  reason: EntryBlockReason | null;
  message: string;
  action: EntryAction | null;
  /** 不阻断的提醒（如缺读信权限） */
  warnings: string[];
};

export type RfqEntryLock =
  | { locked: false }
  | {
      locked: true;
      reason: "pending_approval" | "recently_sent";
      inquiryId: string;
      roundNumber: number;
      /** 该轮创建时间（ISO） */
      at: string;
      /** 组织轮次锁天数 */
      days: number;
    };

export type RfqEntryFacts = {
  projectId: string;
  lock: RfqEntryLock;
  confirmedRequirementCount: number;
  /** 有有效邮箱且 active 的供应商数（与 partitionSuppliers 同一规则） */
  readySupplierCount: number;
  /** buildRfqDocument 预构建的失败码（只关心这两种；其余视为可发） */
  buildError: "NO_CONFIRMED_REQUIREMENTS" | "SENSITIVE_LEAK" | null;
  sender: { ok: true } | { ok: false; errorCode: "SENDER_NOT_CONNECTED" | "SENDER_NO_COMPOSE_SCOPE" };
  hasReadScope: boolean;
  mailboxEmail: string;
  fromEmail: string;
  /** YYYY-MM-DD 或 null（没有截标日） */
  replyBy: string | null;
  timeZone: string;
};

/* ---------------------------------- 链接 ---------------------------------- */

const SETTINGS_EMAIL_HREF = "/settings/email";
export const RFQ_ROUNDS_ANCHOR = "#rfq-rounds";
export const rfqRoundAnchor = (inquiryId: string) => `#rfq-round-${inquiryId}`;
const requirementsHref = (projectId: string) => `/projects/${projectId}?tab=requirements`;

/* ---------------------------------- 日期 ---------------------------------- */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/;

function zonedParts(d: Date, timeZone: string): Record<string, string> {
  const make = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = make(timeZone);
  } catch {
    fmt = make("UTC");
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/**
 * 月-日。纯日期（YYYY-MM-DD）与「按日期存的 UTC 零点」（询价引擎把回复截止写成 new Date("YYYY-MM-DD")）直接取字面月日，
 * 不做时区换算——否则多伦多会显示成前一天；其余时间戳按组织时区换算。
 */
export function monthDay(value: string | Date, timeZone: string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  const literal = typeof value === "string" ? value : Number.isNaN(d.getTime()) ? "" : d.toISOString();
  const m = literal.match(DATE_ONLY) ?? literal.match(UTC_MIDNIGHT);
  if (m) return `${m[2]}-${m[3]}`;
  if (Number.isNaN(d.getTime())) return null;
  const p = zonedParts(d, timeZone);
  return `${p.month}-${p.day}`;
}

function monthDayTime(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/* ---------------------------------- 入口状态 ---------------------------------- */

const READ_SCOPE_WARNING = "授权邮箱缺少读信权限：回信不会自动进表，需要手工录入（重新授权 Gmail 即可恢复）。";

/** 不可发原因按优先级取第一个；全都没有 → 可发。 */
export function decideRfqEntryState(f: RfqEntryFacts): RfqEntryState {
  const warnings = f.sender.ok && !f.hasReadScope ? [READ_SCOPE_WARNING] : [];
  const block = (reason: EntryBlockReason, message: string, action: EntryAction | null): RfqEntryState => ({
    enabled: false,
    reason,
    message,
    action,
    warnings,
  });

  if (f.lock.locked && f.lock.reason === "pending_approval") {
    return block("pending_approval", `第 ${f.lock.roundNumber} 轮还有一张待批准的发送卡，批准或驳回后才能开新一轮。`, {
      label: "去批准",
      href: rfqRoundAnchor(f.lock.inquiryId),
    });
  }
  if (f.lock.locked && f.lock.reason === "recently_sent") {
    const md = monthDay(f.lock.at, f.timeZone) ?? "";
    return block("recently_sent", `第 ${f.lock.roundNumber} 轮（${md} 发起）已发出，${f.lock.days} 天内不开新轮。`, {
      label: `查看第 ${f.lock.roundNumber} 轮`,
      href: rfqRoundAnchor(f.lock.inquiryId),
    });
  }
  if (f.buildError === "NO_CONFIRMED_REQUIREMENTS" || f.confirmedRequirementCount <= 0) {
    return block("no_confirmed_requirements", "还没有已确认的要求，询价单会是空的。", {
      label: "去「需求」确认要求",
      href: requirementsHref(f.projectId),
    });
  }
  if (f.buildError === "SENSITIVE_LEAK") {
    return block("sensitive_leak", "要求里含有不能发给供应商的内容（如我方价格或内部备注），本轮整单不发。", {
      label: "去「需求」检查",
      href: requirementsHref(f.projectId),
    });
  }
  if (!f.sender.ok && f.sender.errorCode === "SENDER_NOT_CONNECTED") {
    return block(
      "sender_not_connected",
      `授权邮箱 ${f.mailboxEmail} 还没连接 Gmail，需要该邮箱本人登录青砚连接（发信和读回信两个权限）。`,
      { label: "去连接 Gmail", href: SETTINGS_EMAIL_HREF },
    );
  }
  if (!f.sender.ok) {
    return block("sender_no_compose_scope", `授权邮箱 ${f.mailboxEmail} 的 Gmail 授权缺少发信权限，需要重新授权。`, {
      label: "去重新授权",
      href: SETTINGS_EMAIL_HREF,
    });
  }
  if (f.readySupplierCount <= 0) {
    return block("no_ready_suppliers", "组织里还没有能发询价的供应商（需要在用、并且有联系邮箱）。", {
      label: "去补供应商",
      href: "/suppliers",
    });
  }

  const reply = f.replyBy ? `回复截止 ${monthDay(f.replyBy, f.timeZone)}` : "回复截止：请尽快";
  return {
    enabled: true,
    reason: null,
    message: `将从 ${f.fromEmail} 发出 · 已确认要求 ${f.confirmedRequirementCount} 条 · ${reply}`,
    action: null,
    warnings,
  };
}

/* ---------------------------------- 错误码 → 人话 ---------------------------------- */

export type PrepareRfqErrorCode =
  | "PROJECT_NOT_FOUND"
  | "ROUND_LOCKED"
  | "NO_SUPPLIERS"
  | "SUPPLIERS_NOT_READY"
  | "NO_CONFIRMED_REQUIREMENTS"
  | "SENSITIVE_LEAK"
  | "DRAFT_FAILED";

/** 路由层在调 prepareRfqRound 之前自己判出来的（人工填写的栏目含内部词） */
export type RfqEntryErrorCode = PrepareRfqErrorCode | "FREE_TEXT_SENSITIVE";

export type BlockedSupplier = { id: string; name: string; reason: "no_email" | "inactive" };

export type UserMessage = { message: string; action: EntryAction | null };

export function rfqErrorToUserMessage(
  code: RfqEntryErrorCode,
  ctx: { projectId: string; now: Date; timeZone: string; blockedSuppliers?: BlockedSupplier[]; field?: string },
): UserMessage {
  switch (code) {
    case "FREE_TEXT_SENSITIVE":
      return {
        message: `你填的${ctx.field ?? "内容"}里有不能发给供应商的内部词（如成本、预算、金额、毛利），改掉再提交。`,
        action: null,
      };
    case "ROUND_LOCKED":
      return {
        message: "这个项目刚发过一轮，或有一张待批准的发送卡，暂时不开新轮。",
        action: { label: "查看询价轮次", href: RFQ_ROUNDS_ANCHOR },
      };
    case "NO_SUPPLIERS":
      return { message: "还没选供应商。", action: null };
    case "SUPPLIERS_NOT_READY": {
      const list = ctx.blockedSuppliers ?? [];
      if (list.length === 0) return { message: "选中的供应商都发不了，请换几家。", action: null };
      const names = list.map((b) => `${b.name}（${b.reason === "no_email" ? "没有邮箱" : "已停用"}）`).join("、");
      const first = list[0];
      return {
        message: `这些供应商还发不了：${names}。`,
        action: { label: first.reason === "no_email" ? "补邮箱" : "查看供应商", href: `/suppliers/${first.id}` },
      };
    }
    case "NO_CONFIRMED_REQUIREMENTS":
      return {
        message: "还没有已确认的要求，询价单会是空的。",
        action: { label: "去「需求」确认要求", href: requirementsHref(ctx.projectId) },
      };
    case "SENSITIVE_LEAK":
      return {
        message: "要求里含有不能发给供应商的内容（如我方价格或内部备注），本轮整单不发。",
        action: { label: "去「需求」检查", href: requirementsHref(ctx.projectId) },
      };
    case "PROJECT_NOT_FOUND":
      return { message: "这个项目不是投标项目，或你没有权限。", action: { label: "返回项目列表", href: "/projects" } };
    case "DRAFT_FAILED":
    default:
      return {
        message: `生成审批卡没有成功，请重试；再不行把这个时间告诉管理员：${monthDayTime(ctx.now, ctx.timeZone)}。`,
        action: null,
      };
  }
}

/* ---------------------------------- 轮次状态行 ---------------------------------- */

/** 「已发出 3 家 · 已报价 1 · 等回复 2（截止 11-13）」；只看询价项状态，与 inquiry/status.ts 状态机一致。 */
export function roundStatusLine(items: Array<{ status: string }>, dueDate: string | null, timeZone: string): string {
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const sent = items.filter((i) => i.status !== "pending").length;
  if (sent === 0) return "还没发出";
  const parts = [`已发出 ${sent} 家`];
  const quoted = count("quoted");
  const replied = count("replied");
  const declined = count("declined");
  const noResponse = count("no_response");
  const waiting = count("sent");
  if (quoted) parts.push(`已报价 ${quoted}`);
  if (replied) parts.push(`已回复 ${replied}`);
  if (declined) parts.push(`已拒绝 ${declined}`);
  if (noResponse) parts.push(`未响应 ${noResponse}`);
  if (waiting) {
    const md = dueDate ? monthDay(dueDate, timeZone) : null;
    parts.push(`等回复 ${waiting}${md ? `（截止 ${md}）` : ""}`);
  } else {
    parts.push("全部有结果");
  }
  return parts.join(" · ");
}

/** 发出后卡片底部一行：会不会自动进表、几天没回会自动起草催单（天数与催单引擎 resolveChaseAfterDays 一致，由调用方传入）。 */
export function autoIngestNote(input: { hasReadScope: boolean; chaseAfterDays: number }): UserMessage {
  if (!input.hasReadScope) {
    return {
      message: "授权邮箱缺少读信权限：回信不会自动进表，需要手工录入。",
      action: { label: "去重新授权", href: SETTINGS_EMAIL_HREF },
    };
  }
  return {
    message: `回信每 10 分钟自动检查并进表；${input.chaseAfterDays} 天没回会自动起草催单给你批。`,
    action: null,
  };
}

/* ---------------------------------- 耗时 ---------------------------------- */

/** 审批卡创建 → 执行（发出）的耗时；缺值 / 倒序 / 非法 → null。 */
export function elapsedLabel(fromIso: string | null | undefined, toIso: string | null | undefined): string | null {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const s = Math.round((b - a) / 1000);
  let text: string;
  if (s < 60) text = `${s} 秒`;
  else if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    text = r ? `${m} 分 ${r} 秒` : `${m} 分`;
  } else if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    text = m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  } else {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    text = h ? `${d} 天 ${h} 小时` : `${d} 天`;
  }
  return `从发起到发出：${text}`;
}

/* ---------------------------------- 审批卡状态 / 执行失败文案 ---------------------------------- */

/** 审批中心统一状态 → 面板上的一句话；PENDING 不需要额外说明。 */
export function approvalStatusNote(status: string): string | null {
  switch (status) {
    case "PENDING":
      return null;
    case "APPROVED":
      return "已批准，正在发出…稍后刷新查看结果。";
    case "EXPIRED":
      return "这张卡已过期（超过 72 小时没批），系统 2 小时内会自动作废，之后可以重新「问供应商要价」。";
    case "EXECUTED":
      return "已发出。";
    case "REJECTED":
      return "已驳回，这一轮不会发出。";
    case "EXECUTION_FAILED":
    case "EXECUTION_BLOCKED":
      return "这张卡执行没成功，已失效；处理好原因后重新「问供应商要价」。";
    default:
      return "这张卡已不是待批状态，刷新后再看。";
  }
}

const GMAIL_AUTH_ERROR = /invalid_grant|unauthori[sz]ed|insufficient|invalid_token|token has been expired|\b401\b|\b403\b/i;

/** 批准后执行失败的原文 → 用户能看懂的话；Gmail 授权类英文错误整体替换，其余加「没有发出去：」前缀，部分成功的摘要原样保留。 */
export function friendlyExecutionError(raw: string): string {
  const text = raw.trim();
  // 部分成功（「已发出 2/3：A、B；失败：C（invalid_grant）」）：保留谁发出了，只把括号里的英文授权错误换成人话
  if (/^已发出 [1-9]\d*\//.test(text)) {
    return text.replace(/（([^）]*)）/g, (whole, inner: string) => (GMAIL_AUTH_ERROR.test(inner) ? "（Gmail 授权失效）" : whole));
  }
  if (GMAIL_AUTH_ERROR.test(text)) {
    return "Gmail 授权失效或权限不够：请授权邮箱本人重新连接 Gmail，再重新「问供应商要价」。";
  }
  // 执行器 resolveSender 的原文是「……再审批发送」，但这张卡执行失败后已作废，不能再批：改成与「重新发起」一致的说法
  if (/授权邮箱 .*(未连接|缺少 compose 权限)/.test(text)) {
    return "没有发出去：授权邮箱的 Gmail 未连接或缺发信权限，需要该邮箱本人在「设置 → 邮箱」重新连接。";
  }
  return `没有发出去：${text || "原因未知，请去审批中心查看这张卡"}`;
}

/* ---------------------------------- 供应商 ---------------------------------- */

export type EntrySupplierInput = { id: string; name: string; contactEmail: string | null; status: string };
export type EntrySupplier = {
  id: string;
  name: string;
  contactEmail: string | null;
  ready: boolean;
  blockedReason: "no_email" | "inactive" | null;
  isDefault: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 就绪规则与 round-pure.partitionSuppliers 逐字一致（status=active 且原始 contactEmail 通过同一正则，不先 trim）——
 * 入口说「可选」的，送审时一定 ready（测试里用 partitionSuppliers 做对照）。round-pure 引了 node:crypto，前端不能直接引，故这里复写同一规则。
 * 常用供应商按偏好顺序排最前，其余可发的在前、按名称。
 */
export function orderEntrySuppliers(suppliers: EntrySupplierInput[], defaultIds: string[]): EntrySupplier[] {
  const rank = new Map(defaultIds.map((id, i) => [id, i]));
  const rows: EntrySupplier[] = [];
  const seen = new Set<string>();
  for (const s of suppliers) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const blockedReason: EntrySupplier["blockedReason"] =
      s.status !== "active" ? "inactive" : !s.contactEmail || !EMAIL_RE.test(s.contactEmail) ? "no_email" : null;
    rows.push({
      id: s.id,
      name: s.name,
      contactEmail: s.contactEmail?.trim() || null,
      ready: blockedReason === null,
      blockedReason,
      isDefault: rank.has(s.id),
    });
  }
  return rows.sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) {
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    }
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

/* ---------------------------------- 预览白名单 ---------------------------------- */

export type EntryPreview = {
  fromName: string;
  fromEmail: string;
  replyBy: string | null;
  confirmedRequirementCount: number;
  excludedCount: number;
};

/** 只挑五个字段：不论上游对象里带了什么（项目估值、我方报价……），都不进响应。 */
export function assembleEntryPreview(src: {
  fromName: string;
  fromEmail: string;
  replyBy: string | null;
  confirmedRequirementCount: number;
  excludedCount: number;
  [extra: string]: unknown;
}): EntryPreview {
  return {
    fromName: src.fromName,
    fromEmail: src.fromEmail,
    replyBy: src.replyBy,
    confirmedRequirementCount: src.confirmedRequirementCount,
    excludedCount: src.excludedCount,
  };
}

// ── T-1：从链接直达询价轮次（spec tender/rfq-web-entry「从链接直达询价轮次」） ──

/** 轮次锚点前缀：通知跳转地址 /projects/{id}?tab=bid#rfq-round-{轮次 id} 与入口说明的页内锚点共用 */
export const RFQ_ROUND_ANCHOR_PREFIX = "#rfq-round-";
const ROUND_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 地址里的 #rfq-round-<id> → 轮次 id；空、错前缀、含多余字符 → null */
export function roundIdFromHash(hash: string | null | undefined): string | null {
  if (!hash || !hash.startsWith(RFQ_ROUND_ANCHOR_PREFIX)) return null;
  const id = hash.slice(RFQ_ROUND_ANCHOR_PREFIX.length);
  return ROUND_ID_PATTERN.test(id) ? id : null;
}

/**
 * 列表加载后展开哪一轮：锚点轮次属于本项目 → 它（优先于默认）；
 * 否则当前已展开 / 待批的那一轮（仍在列表里）；否则最新一轮；没有轮次 → null。
 */
export function initialExpandedRound(input: {
  hashRoundId: string | null;
  roundIds: readonly string[];
  currentRoundId: string | null;
  latestRoundId: string | null;
}): string | null {
  const inList = (id: string | null): id is string => !!id && input.roundIds.includes(id);
  if (inList(input.hashRoundId)) return input.hashRoundId;
  if (inList(input.currentRoundId)) return input.currentRoundId;
  return inList(input.latestRoundId) ? input.latestRoundId : null;
}

// ── T-1：催单卡在轮次里原地审批（spec tender/rfq-web-entry「待批催单卡的原地审批」，design D13） ──

export type EmailPreview = { supplierName: string; to: string; subject: string; body: string };

/**
 * 审批卡 payload → 每封将发出的邮件（发出的就是这份）：
 * 询价发送卡 `{ items: [{ supplierName, to, subject, body }] }`；催单 / 追问卡是单封 `{ supplierName, to, subject, body }`。
 * 缺收件人或正文的条目不列。
 */
export function previewEmailsFromPayload(payload: unknown): EmailPreview[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as { items?: unknown; supplierName?: unknown; to?: unknown; subject?: unknown; body?: unknown };
  const one = (x: unknown): EmailPreview | null => {
    if (!x || typeof x !== "object") return null;
    const e = x as { supplierName?: unknown; to?: unknown; subject?: unknown; body?: unknown };
    if (typeof e.to !== "string" || typeof e.body !== "string") return null;
    return { supplierName: String(e.supplierName ?? ""), to: e.to, subject: String(e.subject ?? ""), body: e.body };
  };
  if (Array.isArray(p.items)) return p.items.map(one).filter((e): e is EmailPreview => e !== null);
  const single = one(p);
  return single ? [single] : [];
}

export type ChaseCardKind = "no_reply" | "missing_fields";

/** 催单面板的文案：标题、驳回确认、驳回结果、写进审批记录的驳回备注 */
export function chasePanelCopy(input: { kind: ChaseCardKind; chaseIndex: number; supplierName: string; roundNumber: number | null }): {
  heading: string;
  rejectConfirm: string;
  rejected: string;
  rejectNote: string;
} {
  const what = input.kind === "no_reply" ? `第 ${input.chaseIndex} 次催单` : "缺字段追问";
  const round = input.roundNumber ? `第 ${input.roundNumber} 轮：` : "";
  const who = input.supplierName.trim() || "供应商";
  return {
    heading: `${round}给${who}的${what}等待批准，批准后在原邮件线程里发出`,
    rejectConfirm: "确认驳回？只是这一封不发出，这一轮不受影响。",
    rejected: `已驳回，给${who}的这封${input.kind === "no_reply" ? "催单" : "追问"}不会发出。`,
    rejectNote: "项目页驳回催单",
  };
}

/** 轮次卡片头的计数；没有待批催单卡 → null（不显示） */
export function chaseBadge(count: number): string | null {
  return count > 0 ? `催单待批 ${count}` : null;
}

/** 催单卡执行失败后的提示（卡已失效；下一次定时检查会按规则重新起草） */
export const CHASE_FAILED_HINT = " 这张催单卡已失效，下次自动检查会按规则重新起草。";
