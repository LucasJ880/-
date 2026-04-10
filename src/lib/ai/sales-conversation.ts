/**
 * 销售对话处理 — 多渠道解析 + 语言检测 + 知识提取
 *
 * 支持 4 种渠道的对话格式：微信、小红书、Facebook、邮件
 * 自动检测中英文/混合语言
 */

// ─── 类型 ──────────────────────────────────────────────────────

export type Channel =
  | "wechat"
  | "xiaohongshu"
  | "facebook"
  | "email"
  | "phone"
  | "in_person"
  | "other";

export type Language = "zh" | "en" | "mixed";
export type Sentiment = "positive" | "neutral" | "negative";
export type ConversationOutcome =
  | "converted"
  | "lost"
  | "pending"
  | "info_request"
  | "follow_up";

export interface RawMessage {
  role: "customer" | "staff";
  content: string;
  time?: string;
}

export interface ParsedConversation {
  messages: RawMessage[];
  language: Language;
  channel: Channel;
  topicTags: string[];
  messageCount: number;
}

// ─── 语言检测 ──────────────────────────────────────────────────

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
const LATIN_RANGE = /[a-zA-Z]/g;

/**
 * 检测文本语言：zh / en / mixed
 * 规则：CJK 字符占比 > 40% → zh; < 10% → en; 中间 → mixed
 * 产品术语（Zebra, Roller 等）不影响判定
 */
export function detectLanguage(text: string): Language {
  const cleaned = text
    .replace(/[0-9\s\p{P}\p{S}]/gu, "")
    .replace(
      /\b(zebra|roller|cellular|drapery|sheer|shutter|blind|shade|honeycomb|shangri-?la|skylight|cordless)\b/gi,
      ""
    );

  if (cleaned.length < 5) return "zh";

  const cjkCount = (cleaned.match(CJK_RANGE) || []).length;
  const latinCount = (cleaned.match(LATIN_RANGE) || []).length;
  const total = cjkCount + latinCount;

  if (total === 0) return "zh";

  const cjkRatio = cjkCount / total;

  if (cjkRatio > 0.4) return "zh";
  if (cjkRatio < 0.1) return "en";
  return "mixed";
}

/**
 * 检测整段对话的语言（综合所有消息）
 */
export function detectConversationLanguage(messages: RawMessage[]): Language {
  const allText = messages.map((m) => m.content).join(" ");
  return detectLanguage(allText);
}

// ─── 微信对话解析 ──────────────────────────────────────────────

/**
 * 解析微信聊天记录导出格式
 * 典型格式：
 *   2024-03-15 14:23 张三
 *   你好，想问一下窗帘价格
 *
 *   2024-03-15 14:25 Sunny Shutter
 *   您好！请问是什么窗型呢？
 *
 * 或简化格式（手动粘贴）：
 *   客户: 你好，想问价格
 *   我: 您好！什么窗型？
 */
const WECHAT_DATETIME_LINE =
  /^(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;
const SIMPLE_ROLE_LINE = /^(客户|顾客|对方|customer|他|她)\s*[:：]\s*/i;
const STAFF_ROLE_LINE =
  /^(我|staff|sunny|shutter|sunny\s*shutter|sales|员工)\s*[:：]\s*/i;

export function parseWechatConversation(
  rawText: string,
  staffNames: string[] = ["Sunny Shutter", "我"]
): ParsedConversation {
  const lines = rawText.split("\n");
  const messages: RawMessage[] = [];
  let currentSender = "";
  let currentTime = "";
  let currentContent: string[] = [];
  const staffSet = new Set(staffNames.map((n) => n.toLowerCase()));

  function flush() {
    if (currentSender && currentContent.length > 0) {
      const text = currentContent.join("\n").trim();
      if (text) {
        const isStaff = staffSet.has(currentSender.toLowerCase());
        messages.push({
          role: isStaff ? "staff" : "customer",
          content: text,
          time: currentTime || undefined,
        });
      }
    }
    currentContent = [];
  }

  for (const line of lines) {
    const dtMatch = line.match(WECHAT_DATETIME_LINE);
    if (dtMatch) {
      flush();
      currentTime = dtMatch[1];
      currentSender = dtMatch[2].trim();
      continue;
    }

    const simpleCustomer = line.match(SIMPLE_ROLE_LINE);
    if (simpleCustomer) {
      flush();
      currentSender = "customer";
      currentContent.push(line.replace(SIMPLE_ROLE_LINE, ""));
      continue;
    }

    const simpleStaff = line.match(STAFF_ROLE_LINE);
    if (simpleStaff) {
      flush();
      currentSender = "sunny shutter";
      staffSet.add("sunny shutter");
      currentContent.push(line.replace(STAFF_ROLE_LINE, ""));
      continue;
    }

    if (currentSender) {
      currentContent.push(line);
    }
  }
  flush();

  const language = detectConversationLanguage(messages);
  const topicTags = extractTopicTags(
    messages.map((m) => m.content).join(" ")
  );

  return {
    messages,
    language,
    channel: "wechat",
    topicTags,
    messageCount: messages.length,
  };
}

// ─── 通用对话解析（小红书/Facebook 手动粘贴） ─────────────────

/**
 * 通用格式解析器
 * 支持格式：
 *   Customer: Hello, I'd like to know...
 *   Staff: Hi! Sure, ...
 *
 * 或中文格式：
 *   客户：你好
 *   我：您好
 */
export function parseGenericConversation(
  rawText: string,
  channel: Channel
): ParsedConversation {
  const lines = rawText.split("\n");
  const messages: RawMessage[] = [];
  let currentRole: "customer" | "staff" | null = null;
  let currentContent: string[] = [];

  const customerPrefixes =
    /^(customer|client|buyer|客户|顾客|对方|用户|粉丝|他|她)\s*[:：]\s*/i;
  const staffPrefixes =
    /^(staff|me|i|我|sales|agent|sunny|rep|回复|客服)\s*[:：]\s*/i;

  function flush() {
    if (currentRole && currentContent.length > 0) {
      const text = currentContent.join("\n").trim();
      if (text) {
        messages.push({ role: currentRole, content: text });
      }
    }
    currentContent = [];
  }

  for (const line of lines) {
    if (customerPrefixes.test(line)) {
      flush();
      currentRole = "customer";
      currentContent.push(line.replace(customerPrefixes, ""));
    } else if (staffPrefixes.test(line)) {
      flush();
      currentRole = "staff";
      currentContent.push(line.replace(staffPrefixes, ""));
    } else if (currentRole) {
      currentContent.push(line);
    }
  }
  flush();

  const language = detectConversationLanguage(messages);
  const topicTags = extractTopicTags(
    messages.map((m) => m.content).join(" ")
  );

  return {
    messages,
    language,
    channel,
    topicTags,
    messageCount: messages.length,
  };
}

// ─── 邮件线程解析 ──────────────────────────────────────────────

/**
 * 简单的邮件线程解析
 * 支持格式（粘贴的邮件正文）：
 *   From: customer@email.com
 *   Subject: Re: Quote for blinds
 *
 *   Hi, I'd like to get a quote...
 *   ---
 *   From: sunny@shutter.com
 *   ...
 */
export function parseEmailThread(rawText: string): ParsedConversation {
  const blocks = rawText.split(/^-{3,}$/m);
  const messages: RawMessage[] = [];
  const staffDomains = ["sunnyshutter", "sunny-shutter", "sunny"];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const fromMatch = trimmed.match(
      /^From:\s*.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/im
    );
    const bodyStart = trimmed.search(/\n\n/);
    const body =
      bodyStart >= 0 ? trimmed.slice(bodyStart).trim() : trimmed;

    let role: "customer" | "staff" = "customer";
    if (fromMatch) {
      const email = fromMatch[1].toLowerCase();
      if (staffDomains.some((d) => email.includes(d))) {
        role = "staff";
      }
    }

    if (body.length > 5) {
      messages.push({ role, content: body });
    }
  }

  if (messages.length === 0 && rawText.trim().length > 10) {
    messages.push({ role: "customer", content: rawText.trim() });
  }

  const language = detectConversationLanguage(messages);
  const topicTags = extractTopicTags(
    messages.map((m) => m.content).join(" ")
  );

  return {
    messages,
    language,
    channel: "email",
    topicTags,
    messageCount: messages.length,
  };
}

// ─── 话题标签提取 ──────────────────────────────────────────────

const TOPIC_PATTERNS: [RegExp, string][] = [
  // 产品类
  [/\b(zebra|斑马帘)\b/i, "zebra"],
  [/\b(roller|卷帘)\b/i, "roller"],
  [/\b(cellular|honeycomb|蜂巢帘)\b/i, "cellular"],
  [/\b(drapery|窗帘|drape)\b/i, "drapery"],
  [/\b(shutter|百叶窗|百叶)\b/i, "shutter"],
  [/\b(sheer|纱帘)\b/i, "sheer"],
  [/\b(shangri-?la|香格里拉)\b/i, "shangri-la"],
  [/\b(skylight|天窗)\b/i, "skylight"],
  [/\b(cordless|无绳)\b/i, "cordless"],
  [/\b(motorized|电动|motor)\b/i, "motorized"],
  // 业务类
  [/(报价|quote|pricing|价格|多少钱|how much)/i, "pricing"],
  [/(安装|install|installation|上门)/i, "installation"],
  [/(测量|measure|measurement|量尺)/i, "measurement"],
  [/(折扣|discount|优惠|promotion|deal)/i, "discount"],
  [/(颜色|color|colour|面料|fabric|材质)/i, "fabric"],
  [/(售后|warranty|保修|guarantee)/i, "warranty"],
  [/(交期|delivery|送货|配送|几天|when)/i, "delivery"],
  [/(退换|return|exchange|退货)/i, "returns"],
  [/(定制|custom|customize|特殊尺寸)/i, "custom"],
  [/(推荐|recommend|建议|suggest)/i, "recommendation"],
];

export function extractTopicTags(text: string): string[] {
  const tags = new Set<string>();
  for (const [pattern, tag] of TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }
  return [...tags];
}

// ─── 渠道风格指南 ──────────────────────────────────────────────

export const CHANNEL_STYLE_GUIDE: Record<
  Channel,
  { language: string; tone: string; length: string; example: string }
> = {
  wechat: {
    language: "中文为主，产品名保持英文",
    tone: "亲切口语化，可用表情符号",
    length: "短句，1-3句为宜",
    example: "好的，Zebra帘的话，您家窗户大概多大呢？我帮您算一下～",
  },
  xiaohongshu: {
    language: "中文，适当用网络用语",
    tone: "专业+种草感，有亲和力",
    length: "中等长度，带要点",
    example: "亲，Zebra帘真的超推荐！既能遮光又能调光，颜值还高✨ 价格的话要看窗户尺寸~",
  },
  facebook: {
    language: "English",
    tone: "Professional yet warm and friendly",
    length: "Medium, with clear structure",
    example:
      "Hi! Thanks for your interest in our blinds. The Zebra shades are a great choice — they offer both privacy and light control. Could you share your window dimensions?",
  },
  email: {
    language: "English (formal) / 根据客户语言匹配",
    tone: "Formal, structured, professional",
    length: "Detailed with greeting and closing",
    example:
      "Dear [Name],\n\nThank you for reaching out. I'd be happy to provide a quote for your window treatments...",
  },
  phone: {
    language: "根据客户语言",
    tone: "自然对话，热情专业",
    length: "不限",
    example: "您好，感谢来电！请问是想了解哪种窗帘呢？",
  },
  in_person: {
    language: "根据客户语言",
    tone: "面对面，热情自然",
    length: "不限",
    example: "",
  },
  other: {
    language: "自适应",
    tone: "中性专业",
    length: "适中",
    example: "",
  },
};

/**
 * 构建渠道风格 prompt 片段
 */
export function buildChannelStylePrompt(channel: Channel): string {
  const guide = CHANNEL_STYLE_GUIDE[channel];
  if (!guide || channel === "other") return "";

  return `
## 当前沟通渠道：${channel}
- 语言要求：${guide.language}
- 语气风格：${guide.tone}
- 消息长度：${guide.length}
${guide.example ? `- 参考范例：「${guide.example}」` : ""}
请严格按照此渠道风格生成话术。`;
}
