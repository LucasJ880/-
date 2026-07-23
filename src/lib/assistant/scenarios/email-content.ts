/**
 * Gmail 草稿正文：只采用用户明确事实，禁止内部说明泄漏
 */

export type EmailDraftLanguage = "zh" | "en";

export type EmailContentExtract = {
  facts: string[];
  language: EmailDraftLanguage;
  hasPurpose: boolean;
};

const INTERNAL_LEAK_RE =
  /青砚助手|由青砚|原文[：:]|系统提示|内部说明|Prompt|调试信息/i;

/** 检测用户是否要求英文邮件 */
export function detectEmailLanguage(message: string): EmailDraftLanguage {
  if (/英文|English|in English|write (it )?in English/i.test(message)) {
    return "en";
  }
  return "zh";
}

/**
 * 从用户消息提取可写入客户可见正文的事实。
 * 不猜测价格/交期/保修等未提供承诺。
 */
export function extractEmailContentFacts(message: string): EmailContentExtract {
  const language = detectEmailLanguage(message);
  const facts: string[] = [];
  const seen = new Set<string>();

  const push = (zh: string, en: string) => {
    const line = language === "en" ? en : zh;
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    if (INTERNAL_LEAK_RE.test(line)) return;
    seen.add(key);
    facts.push(line.trim());
  };

  const cycle = message.match(
    /生产周期\s*(?:是|为|:|：)?\s*(\d+)\s*(周|个?星期|weeks?)/i,
  );
  if (cycle) {
    const n = cycle[1];
    push(`生产周期为 ${n} 周`, `The production lead time is ${n} weeks.`);
  }

  const measure = message.match(
    /预计\s*([0-9０-９]+?\s*[月年]|[一二三四五六七八九十]+月|[0-9]{1,2}\s*月初|[0-9]{1,2}\s*月底|[A-Za-z]+)\s*测量/,
  );
  if (measure) {
    const when = measure[1].trim();
    push(`预计 ${when} 测量`, `We expect to measure in/on ${when}.`);
  } else if (/预计.{0,12}测量/.test(message)) {
    const m2 = message.match(/预计\s*(.+?)\s*测量/);
    if (m2?.[1] && m2[1].length <= 20) {
      push(`预计 ${m2[1].trim()} 测量`, `We expect to measure around ${m2[1].trim()}.`);
    }
  }

  if (/报价仍然有效|确认报价仍然有效|报价\s*仍\s*有效/.test(message)) {
    push("报价仍然有效", "The quote remains valid.");
  }

  const alone = message.match(
    /(?:现场)?只有\s*([A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff .]{1,40}?)\s*一个人?(?:参加|到场)/,
  );
  if (alone?.[1]) {
    const who = alone[1].trim();
    push(`${who} 将单独到场`, `${who} will attend alone.`);
  }

  // 逗号后的自由事实（仅在尚未命中结构化事实时，或作为补充）
  const clause = message.match(/[，,]\s*([^，,]{4,120})$/);
  if (clause) {
    let c = clause[1].trim();
    c = c
      .replace(/^(我们|我想|请|麻烦)/, "")
      .replace(/[。.!！]+$/, "")
      .trim();
    // 避免把纯动作句当事实
    if (
      c &&
      !/^(帮我|发送|发邮件|写邮件|起草)/.test(c) &&
      !INTERNAL_LEAK_RE.test(c)
    ) {
      // 若结构化已覆盖同类，跳过重复
      const already =
        (/生产周期/.test(c) && facts.some((f) => /生产周期|lead time/i.test(f))) ||
        (/测量/.test(c) && facts.some((f) => /测量|measure/i.test(f))) ||
        (/报价/.test(c) && facts.some((f) => /报价|quote/i.test(f))) ||
        (/参加|到场/.test(c) && facts.some((f) => /到场|attend/i.test(f)));
      if (!already && facts.length === 0) {
        push(c, c);
      } else if (!already && /生产周期|测量|报价|参加|到场|周/.test(c)) {
        // 已有结构化事实时不再重复推自由句
      }
    }
  }

  return {
    facts,
    language,
    hasPurpose: facts.length > 0,
  };
}

export function assertNoInternalLeak(body: string): boolean {
  return !INTERNAL_LEAK_RE.test(body);
}

/** 组装客户可见正文（无内部说明、无原文回显） */
export function buildCustomerVisibleEmailBody(input: {
  customerName?: string;
  facts: string[];
  language: EmailDraftLanguage;
}): string {
  const greet =
    input.language === "en"
      ? `Hello${input.customerName ? ` ${input.customerName}` : ""},`
      : `您好${input.customerName ? ` ${input.customerName}` : ""}，`;

  const closing =
    input.language === "en"
      ? ["", "Best regards"]
      : ["", "此致", "敬礼"];

  const factLines =
    input.language === "en"
      ? [
          "",
          "I wanted to share the following:",
          "",
          ...input.facts.map((f) => `- ${f}`),
        ]
      : ["", "想与您确认以下信息：", "", ...input.facts.map((f) => `- ${f}`)];

  return [greet, ...factLines, ...closing].join("\n");
}

export function buildEmailSubject(input: {
  customerName?: string;
  facts: string[];
  language: EmailDraftLanguage;
}): string {
  if (input.facts.some((f) => /生产周期|lead time/i.test(f))) {
    return input.language === "en"
      ? "Production lead time update"
      : "关于生产周期";
  }
  if (input.facts.some((f) => /测量|measure/i.test(f))) {
    return input.language === "en" ? "Measurement schedule" : "关于测量安排";
  }
  if (input.facts.some((f) => /报价|quote/i.test(f))) {
    return input.language === "en" ? "Quote confirmation" : "报价确认";
  }
  if (input.customerName) {
    return input.language === "en"
      ? `Follow-up regarding ${input.customerName}`
      : `关于 ${input.customerName} 的跟进`;
  }
  return input.language === "en" ? "Follow-up" : "跟进邮件";
}
