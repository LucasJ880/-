/**
 * 场景实体解析（保守，禁止猜测）
 */

import { resolveChineseDate } from "@/lib/date/relative-date";
import { nowToronto, parseBusinessDateTime } from "@/lib/time";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** 其他成员指派语气（本阶段不支持） */
const OTHER_ASSIGNEE_RE =
  /提醒\s*([A-Za-z\u4e00-\u9fff]{1,20})\s*(明天|后天|周|星期|周五|下午|上午|联系|跟进)/;

const CALENDAR_RE =
  /(提醒我|加入.{0,4}日历|放进.{0,4}日历|日历提醒|提醒一下)/;
const SALES_FOLLOWUP_RE =
  /(下次跟进|跟进日|follow-?up|更新.{0,6}跟进|把.{0,20}跟进.{0,10}改)/i;
const BOTH_RE =
  /(同时|并且|而且).{0,12}(提醒|日历)|(提醒|日历).{0,12}(同时|并且|而且).{0,12}跟进/;

const FUZZY_TIME_RE = /^(过几天|周末|下午|上午|晚上|晚点|回头)$/;

const NAME_BLOCKLIST = new Set([
  "这个",
  "那个",
  "客户",
  "商机",
  "该",
  "该客户",
  "该商机",
  "这个客户",
  "这个商机",
  "下次跟进",
  "周五",
  "下周",
  "明天",
  "后天",
  "周末",
  "下次跟进改到周五",
]);

export type FollowupActionKind =
  | "calendar"
  | "sales_followup"
  | "both"
  | "unclear";

export type ParsedFollowupRequest = {
  actionKind: FollowupActionKind;
  customerName: string | null;
  otherAssignee: string | null;
  timeRaw: string | null;
  startIso: string | null;
  endIso: string | null;
  needsTimeClarification: boolean;
};

export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}

/** 清洗并校验候选客户/联系人名 */
export function sanitizeEntityName(raw: string): string | null {
  let name = raw
    .trim()
    .replace(/^[「"'《]|[」"'》]$/g, "")
    .replace(/(?:客户|商机)$/u, "")
    .replace(/的$/u, "")
    .replace(
      /(?:的)?(?:下次)?跟进.*$/u,
      "",
    )
    .replace(/(?:发送|发|写|起草).*(?:邮件|gmail).*$/iu, "")
    .replace(/改到.*$/u, "")
    .trim();

  if (!name || name.length > 40) return null;
  if (NAME_BLOCKLIST.has(name)) return null;
  if (/^(下次|跟进|改到|周五|星期|周\d|发送|邮件)/u.test(name)) return null;
  if (!/^[\w\u4e00-\u9fff&.\- ]+$/u.test(name)) return null;
  // 拒绝纯时间/动作短语
  if (/跟进|改到|发送邮件/.test(name)) return null;
  return name;
}

/**
 * 从用户话术中提取客户/联系人名称（保守）。
 * 优先匹配「把 ABC 商机…」「给 Rudy 起草一封邮件」等前置名表达。
 */
export function extractCustomerNameHint(text: string): string | null {
  const patterns: RegExp[] = [
    /把\s*[「"']?(.+?)[」"']?\s*(?:客户|商机)(?:的)?(?:下次)?跟进/u,
    /更新\s*[「"']?(.+?)[」"']?\s*(?:客户|商机)(?:的)?跟进/u,
    /将\s*[「"']?(.+?)[」"']?\s*(?:的)?follow-?up/iu,
    /给\s*[「"']?(.+?)[」"']?\s*(?:起草|写|发|发送)(?:一封)?(?:邮件|gmail)/iu,
    /给\s*[「"']?(.+?)[」"']?\s*客户(?:发送|发|写)?(?:一封)?(?:邮件|gmail)?/u,
    /跟进\s*[「"']?([A-Za-z0-9\u4e00-\u9fff&.\- ]{1,40})[」"']?/u,
    /客户\s*[「"']?([A-Za-z0-9\u4e00-\u9fff&.\- ]{1,40})[」"']?/u,
    /联系\s*[「"']?([A-Za-z0-9\u4e00-\u9fff&.\- ]{1,40})[」"']?/u,
    /商机\s*[「"']?([A-Za-z0-9\u4e00-\u9fff&.\- ]{1,40})[」"']?/u,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const name = sanitizeEntityName(m[1]);
      if (name) return name;
    }
  }
  return null;
}

export function detectOtherAssignee(text: string): string | null {
  const m = text.match(OTHER_ASSIGNEE_RE);
  if (!m?.[1]) return null;
  const name = m[1].trim();
  if (["我", "自己"].includes(name)) return null;
  return name;
}

export function detectFollowupActionKind(text: string): FollowupActionKind {
  const wantsBoth =
    BOTH_RE.test(text) ||
    (CALENDAR_RE.test(text) && SALES_FOLLOWUP_RE.test(text));
  if (wantsBoth) return "both";
  if (SALES_FOLLOWUP_RE.test(text) && !CALENDAR_RE.test(text)) {
    return "sales_followup";
  }
  if (CALENDAR_RE.test(text)) return "calendar";
  if (/跟进|回访|联系/.test(text)) return "calendar";
  return "unclear";
}

export function parseFollowupTime(text: string): {
  startIso: string | null;
  endIso: string | null;
  timeRaw: string | null;
  needsClarification: boolean;
} {
  const now = nowToronto();
  const resolved = resolveChineseDate(text, now);
  if (!resolved) {
    const fuzzy = text.match(/(过几天|周末|下午|上午|晚上|晚点|回头)/);
    if (fuzzy && FUZZY_TIME_RE.test(fuzzy[1])) {
      return {
        startIso: null,
        endIso: null,
        timeRaw: fuzzy[1],
        needsClarification: true,
      };
    }
    if (
      /下午|上午|晚上/.test(text) &&
      !/(周|星期|明天|后天|月|日|\d)/.test(text)
    ) {
      return {
        startIso: null,
        endIso: null,
        timeRaw: "模糊时段",
        needsClarification: true,
      };
    }
    return {
      startIso: null,
      endIso: null,
      timeRaw: null,
      needsClarification: true,
    };
  }

  const date = resolved.date;
  const time = resolved.time ?? "09:00";
  const start = parseBusinessDateTime(`${date}T${time}`);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    timeRaw: `${date} ${time}`,
    needsClarification: false,
  };
}

export function parseFollowupRequest(message: string): ParsedFollowupRequest {
  const otherAssignee = detectOtherAssignee(message);
  const actionKind = detectFollowupActionKind(message);
  const customerName = extractCustomerNameHint(message);
  const time = parseFollowupTime(message);
  return {
    actionKind,
    customerName,
    otherAssignee,
    timeRaw: time.timeRaw,
    startIso: time.startIso,
    endIso: time.endIso,
    needsTimeClarification: time.needsClarification,
  };
}
