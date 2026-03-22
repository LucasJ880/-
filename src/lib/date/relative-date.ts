/**
 * 中文相对日期解析器
 *
 * 将"这周六"、"明天下午两点"等中文时间表达，
 * 基于给定的 now 参数程序化换算为绝对日期/时间。
 *
 * 周规则：自然周 Mon=1 … Sun=7
 * 时区：调用方负责传入正确时区的 now
 */

// ─── Types ─────────────────────────────────────────────────────

export interface ResolvedDate {
  date: string;        // YYYY-MM-DD
  time: string | null; // HH:mm or null
  allDay: boolean;
}

// ─── Constants ─────────────────────────────────────────────────

const WEEKDAY_NAMES: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
};

const PERIOD_INFO: Record<string, { pm: boolean; defaultHour: number }> = {
  "凌晨": { pm: false, defaultHour: 2 },
  "早上": { pm: false, defaultHour: 8 },
  "上午": { pm: false, defaultHour: 9 },
  "中午": { pm: false, defaultHour: 12 },
  "下午": { pm: true,  defaultHour: 14 },
  "晚上": { pm: true,  defaultHour: 19 },
};

// ─── Helpers ───────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** JS getDay() (Sun=0) → ISO weekday (Mon=1…Sun=7) */
function isoWeekday(d: Date): number {
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

/** 解析中文/阿拉伯数字 → number */
function parseCnNum(s: string): number | null {
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;

  const map: Record<string, number> = {
    "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    "十一": 11, "十二": 12,
  };
  if (map[s] !== undefined) return map[s];

  // 十X → 1X
  if (s.startsWith("十") && s.length === 2) {
    const ones = map[s[1]];
    if (ones !== undefined && ones < 10) return 10 + ones;
  }
  // X十 → X0
  if (s.endsWith("十") && s.length === 2) {
    const tens = map[s[0]];
    if (tens !== undefined) return tens * 10;
  }
  // X十Y → XY
  const shi = s.indexOf("十");
  if (shi === 1 && s.length === 3) {
    const tens = map[s[0]];
    const ones = map[s[2]];
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return null;
}

// ─── Date Extraction ───────────────────────────────────────────

function extractDatePart(text: string, now: Date): string | null {
  const wd = isoWeekday(now);

  // 绝对近距
  if (/大后天/.test(text)) return fmtDate(addDays(now, 3));
  if (/后天/.test(text))   return fmtDate(addDays(now, 2));
  if (/明[天日]/.test(text)) return fmtDate(addDays(now, 1));
  if (/今[天日]/.test(text)) return fmtDate(now);

  // 下周末 → 下周六（必须在"周末"之前检测）
  if (/下[个]?周末/.test(text)) {
    const toNextMon = 8 - wd;
    return fmtDate(addDays(now, toNextMon + 5)); // Mon+5=Sat
  }

  // 本周末 / 这周末 → 本周六
  if (/(?:这|本)周末/.test(text)) {
    return fmtDate(addDays(now, 6 - wd));
  }

  // 裸"周末" → 最近未来的周六
  if (/周末/.test(text)) {
    const diff = 6 - wd;
    return fmtDate(addDays(now, diff >= 0 ? diff : diff + 7));
  }

  // 下周X
  const nextWeekRe = /下[个]?(?:周|星期|礼拜)(一|二|三|四|五|六|日|天)/;
  const nwm = text.match(nextWeekRe);
  if (nwm) {
    const target = WEEKDAY_NAMES[nwm[1]];
    const toNextMon = 8 - wd;
    return fmtDate(addDays(now, toNextMon + target - 1));
  }

  // 这周X / 本周X → 当前自然周内
  const thisWeekRe = /(?:这|本)(?:周|星期|礼拜)(一|二|三|四|五|六|日|天)/;
  const twm = text.match(thisWeekRe);
  if (twm) {
    const target = WEEKDAY_NAMES[twm[1]];
    return fmtDate(addDays(now, target - wd));
  }

  // 裸"周X" / "星期X" → 最近未来
  const bareWeekRe = /(?:周|星期|礼拜)(一|二|三|四|五|六|日|天)/;
  const bwm = text.match(bareWeekRe);
  if (bwm) {
    const target = WEEKDAY_NAMES[bwm[1]];
    const diff = target - wd;
    return fmtDate(addDays(now, diff >= 0 ? diff : diff + 7));
  }

  // 月底
  if (/(?:本)?月底/.test(text)) {
    return fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  // 下月初
  if (/下[个]?月初/.test(text)) {
    return fmtDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  }

  // X月Y日/号（当年）
  const specRe = /(\d{1,2})月(\d{1,2})[日号]/;
  const sm = text.match(specRe);
  if (sm) {
    return fmtDate(new Date(now.getFullYear(), parseInt(sm[1]) - 1, parseInt(sm[2])));
  }

  return null;
}

// ─── Time Extraction ───────────────────────────────────────────

interface ParsedTime { hour: number; minute: number }

function extractTimePart(text: string): ParsedTime | null {
  const periods = "凌晨|早上|上午|中午|下午|晚上";
  const cnChars = "一二两三四五六七八九十零〇";

  // 完整时间：[时段] 数字 [点/时/:] [分钟/半]
  const fullRe = new RegExp(
    `(${periods})?\\s*([\\d${cnChars}]+)\\s*[点时:：]\\s*([\\d${cnChars}]+|半)?\\s*分?`
  );
  const m = text.match(fullRe);
  if (m) {
    const period = m[1] || null;
    let hour = parseCnNum(m[2]);
    if (hour === null) return null;

    let minute = 0;
    if (m[3] === "半") {
      minute = 30;
    } else if (m[3]) {
      minute = parseCnNum(m[3]) ?? 0;
    }

    if (period) {
      const info = PERIOD_INFO[period];
      if (info?.pm && hour < 12) hour += 12;
    }

    return { hour, minute };
  }

  // 仅时段关键词（无具体时间） → 使用默认值
  const periodOnlyRe = new RegExp(`(${periods})`);
  const pm = text.match(periodOnlyRe);
  if (pm) {
    const info = PERIOD_INFO[pm[1]];
    if (info) return { hour: info.defaultHour, minute: 0 };
  }

  return null;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * 解析中文相对日期/时间表达式。
 *
 * @param text  AI 输出的日期字段值，如 "这周六"、"明天下午两点"、"2026-03-21"
 * @param now   当前时间（应为目标时区的本地时间）
 * @returns     解析结果，null 表示无法识别（保持原值）
 */
export function resolveChineseDate(
  text: string | null | undefined,
  now: Date
): ResolvedDate | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 已经是 ISO 格式 → 直接解析
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (iso) {
    return { date: iso[1], time: iso[2] || null, allDay: !iso[2] };
  }

  const datePart = extractDatePart(trimmed, now);
  if (!datePart) return null;

  const timePart = extractTimePart(trimmed);
  const timeStr = timePart
    ? `${String(timePart.hour).padStart(2, "0")}:${String(timePart.minute).padStart(2, "0")}`
    : null;

  return { date: datePart, time: timeStr, allDay: !timeStr };
}

/**
 * 获取当前 Toronto 时区的 Date 对象。
 * 返回的 Date 的 getFullYear/getMonth/getDate/getDay 对应 Toronto 时间。
 * @deprecated 直接使用 nowToronto() from "@/lib/time"
 */
export function getShanghaiNow(): Date {
  const str = new Date().toLocaleString("en-US", { timeZone: "America/Toronto" });
  return new Date(str);
}

/**
 * 格式化今天的日期 + 星期（用于 prompt 注入）。
 * 已切换为 Toronto 时区。
 */
export function getTodayInfo(now?: Date): { date: string; weekday: string } {
  const d = now ?? getShanghaiNow();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return {
    date: fmtDate(d),
    weekday: `星期${weekdays[d.getDay()]}`,
  };
}
