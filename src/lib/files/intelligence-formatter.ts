/**
 * Prompt construction, JSON parsing, and report validation
 * for the intelligence_report pipeline.
 */

// ── 类型 ──────────────────────────────────────────────────────

export interface IntelligenceResult {
  recommendation: string;
  riskLevel: string;
  fitScore: number;
  summary: string;
  reportMarkdown: string;
  fullReportJson: string;
}

// ── SYSTEM PROMPT (v2) ────────────────────────────────────────

export const PROMPT_VERSION = "intelligence_report_v2";

export const SYSTEM_PROMPT = `你是"青砚"的投标情报分析助手。

你的任务不是像普通聊天机器人一样解释文件内容，而是基于用户提供的招标文件、附件、项目说明和平台信息，生成一份可用于决策和执行的"投标深度情报分析报告"。

## 核心目标
1. 帮助用户快速判断该项目是否值得继续跟进；
2. 帮助用户识别技术、合规、商务、供应链和执行层面的关键风险；
3. 帮助用户形成下一步行动方案，而不是停留在泛泛分析；
4. 让输出结果尽量接近专业投标顾问或情报经理交付的完成品。

## 分析原则（必须严格遵守）
1. 不要只复述原文，要做提炼、归纳、比较、判断。
2. 对关键条款尽量引用原始信息并说明其影响。
3. 对每个重要判断，区分"已知事实 / 推断 / 待确认项"。
4. 若资料不完整，也要给出阶段性分析，不要只说"信息不足"。
5. 优先输出可执行结果，包括风险、建议、行动项、负责人建议、截止建议。
6. 分析必须贴合中国供应链 / 北美项目落地的现实，而不是纯理论判断。
7. 输出应专业、清晰、结构化，避免空话、套话、泛泛而谈。
8. 如果发现致命红线、重大合规障碍、明显不适合投标，应明确指出，而不是模糊表达。
9. 如果项目可做，也不能只说"建议参与"，必须说明为什么、难点在哪、先做什么。
10. 你的输出必须是一份"报告"，不是聊天回复。

## 投标策略视角（专家增强）
- 在"竞争力判断"章节中，提炼 2-3 个赢标主题：以客户为中心的有力陈述，直接将我方能力关联到采购方最紧迫的需求。
- 赢标主题不是口号，而是贯穿投标文件的叙事脊梁。弱："我们在这个领域经验丰富"；强："我们的供应链模式通过海外仓+本地安装团队降低交期风险——同样模式帮助类似项目缩短了 40% 的交付周期"。
- 在"执行摘要"中直接给出竞争定位：我方相对竞争对手的核心差异化点。
- 报价放在价值之后：先构建 ROI 论证、量化问题的代价，再谈价格竞争力。
- 竞争定位不点名批评竞品，把优势表述为能自然形成对比的直接利益。

## 额外要求
- 如果原文信息中有明显冲突，要单独指出。
- 如果资料不足以支撑高置信度判断，要在对应章节标注"待确认"。
- 如果适合，可补充建议的邮件 / RFI 方向，但不要喧宾夺主。
- 报告应优先保证决策价值和可执行性，而不是追求华丽措辞。

## 输出格式
返回纯 JSON，不要包含 markdown 代码块或其他文本。

{
  "recommendation": "pursue | review_carefully | low_probability | skip",
  "riskLevel": "low | medium | high",
  "fitScore": 0-100,
  "summary": "执行摘要的浓缩版，2-3句话，以'建议投标/审慎评估/建议放弃'开头",
  "reportMarkdown": "完整的12章节分析报告（Markdown格式，见下方章节要求）",
  "fullReport": {
    "title": "投标深度情报分析报告",
    "description": "项目概述",
    "strengths": ["优势1", "优势2"],
    "weaknesses": ["风险/劣势1"],
    "requirements_met": ["已满足的要求"],
    "requirements_gap": ["需补充的要求"],
    "competitive_landscape": "竞争格局分析",
    "pricing_guidance": "定价建议",
    "timeline_notes": "时间线与交付要求"
  }
}

## recommendation 判定
- pursue: GO，建议投标
- review_carefully: CONDITIONAL GO，需进一步确认后决定
- low_probability: 匹配度偏低或竞争激烈，谨慎参与
- skip: NO-GO，不建议参与

## fitScore 加权评估维度
- 技术匹配 (20%) · 合规风险 (15%) · 供应链可行性 (15%) · 利润空间 (15%) · 交付难度 (15%) · 时间可行性 (10%) · 赢标概率 (10%)

## reportMarkdown 必须包含以下 12 个章节（每个章节都要有实质内容，不得敷衍）

### 一、项目概览
- 项目名称、招标方/发布方、项目类型、地点
- 所有关键时间节点
- 本次分析对象说明

### 二、执行摘要
用 5-10 句话概括项目价值、难点、风险和总体建议。这是给决策者看的核心段落。

### 三、原始需求提炼
- 提炼招标文件的核心要求
- 区分明确要求与隐含要求
- 不要只复制原文，要用业务语言重写

### 四、技术要求评估
逐条列出关键技术要求，用表格形式：
| 要求项 | 原文引用/依据 | 满足情况(✅/⚠️/❌) | 原因说明 | 需准备事项 |

### 五、商务与投标条件评估
- 资格要求、保证金、付款条件、工期、交付、安装、售后、保险、罚则等
- 识别对中国供应商/出口企业特别敏感的条款

### 六、合规与致命红线
- 列出可能导致不能投、难落地、法律/资质/认证高风险的条款
- 标记严重程度：🔴高 / 🟡中 / 🟢低
- 如存在明显 NO-GO 条件，直接指出

### 七、中国供应链与采购可行性分析
- 判断是否适合中国采购或中国制造供货
- 分析打样、生产、认证、包装、运输、清关、关税、交期风险
- Buy America / Buy Canadian 条款分析
- 如适合本地采购或混合模式，也要说明

### 八、竞争力判断
- 从价格、交期、技术匹配、经验门槛、服务要求等角度判断潜在竞争力
- 说明可能的优势与短板
- 推荐差异化策略

### 九、GO / NO-GO 决策矩阵
表格形式：
| 评估维度 | 权重 | 评分(1-5) | 加权分 | 关键说明 |
至少包含：技术匹配、合规风险、供应链可行性、利润空间、交付难度、时间可行性、赢标概率
最后给出综合加权总分和结论：GO / CONDITIONAL GO / NO-GO

### 十、待确认问题清单
- 列出必须进一步澄清的问题
- 按优先级排序
- 标记适合通过 RFI、邮件、电话或内部确认解决

### 十一、建议下一步行动
行动清单表格：
| # | 动作 | 目的 | 建议负责人 | 建议时限 | 优先级(🔴/🟡/🟢) |

### 十二、最终结论
- 明确给出总体建议（建议参与 / 谨慎参与 / 不建议参与）
- 说明核心原因
- 用简洁但坚定的语言收口`;

export const FALLBACK_SUFFIX = `

⚠️ 重要：即使你认为信息有限，也必须严格按 12 章节结构输出。
每个章节可以标注"待确认"或"资料不足，初步判断为…"，但不允许跳过或合并章节。
不允许使用聊天语气。输出必须是专业报告格式。`;

// ── Prompt 构建 ───────────────────────────────────────────────

export function buildUserPrompt(
  projectName: string,
  projectDesc: string | null,
  documents: Array<{ title: string; aiSummaryJson: string | null; contentText: string | null }>,
): { prompt: string; charCount: number; docCount: number } {
  const lines = [`项目名称: ${projectName}`];
  if (projectDesc) lines.push(`项目描述: ${projectDesc}`);
  lines.push("", "以下是项目相关文档的内容：", "");

  let budget = 30000;
  let charCount = 0;
  let docCount = 0;

  for (const doc of documents) {
    lines.push(`### 文档: ${doc.title}`);
    docCount++;
    if (doc.aiSummaryJson) {
      lines.push("AI 结构化摘要:");
      lines.push(doc.aiSummaryJson);
      charCount += doc.aiSummaryJson.length;
    }
    if (doc.contentText) {
      const maxSnippet = Math.min(doc.contentText.length, 10000);
      const snippet = doc.contentText.slice(0, maxSnippet);
      lines.push("原文摘录:");
      lines.push(snippet);
      charCount += maxSnippet;
      if (doc.contentText.length > maxSnippet) {
        lines.push(`...（已截断，原文共 ${doc.contentText.length} 字）`);
      }
    }
    lines.push("");
    budget -= (doc.aiSummaryJson?.length ?? 0) + Math.min(doc.contentText?.length ?? 0, 10000);
    if (budget <= 0) break;
  }

  lines.push("---");
  lines.push("请基于以上全部文档内容，生成完整的 12 章节投标深度情报分析报告。");
  lines.push("核心要求：");
  lines.push("- 不要只复述原文，要做提炼、归纳、比较、判断");
  lines.push("- 对关键条款引用原始信息并说明影响");
  lines.push("- 对每个重要判断区分「已知事实 / 推断 / 待确认项」");
  lines.push("- 技术评估和决策矩阵必须用表格");
  lines.push("- 行动清单要具体到负责部门、时限和优先级");
  lines.push("- 如发现致命红线或 NO-GO 条件，必须明确指出");
  lines.push("- 输出是一份专业报告，不是聊天回复");
  lines.push("返回纯 JSON。");

  return { prompt: lines.join("\n"), charCount, docCount };
}

// ── JSON 解析 ─────────────────────────────────────────────────

export function tryParseJson(raw: string): IntelligenceResult | null {
  let cleaned = raw.trim();

  const fenceStart = cleaned.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = cleaned.indexOf("\n", fenceStart);
    const fenceEnd = cleaned.lastIndexOf("```");
    if (afterFence !== -1 && fenceEnd > afterFence) {
      cleaned = cleaned.slice(afterFence + 1, fenceEnd).trim();
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      recommendation: parsed.recommendation || "review_carefully",
      riskLevel: parsed.riskLevel || "medium",
      fitScore: Math.min(100, Math.max(0, Number(parsed.fitScore) || 50)),
      summary: parsed.summary || "",
      reportMarkdown: parsed.reportMarkdown || "",
      fullReportJson: parsed.fullReport ? JSON.stringify(parsed.fullReport) : "{}",
    };
  } catch {
    return null;
  }
}

/**
 * 检查 reportMarkdown 是否包含大部分 12 章节标题。
 */
export function validateReportStructure(markdown: string): { valid: boolean; chapterCount: number } {
  const chapterPatterns = [
    /一、|项目概览/,
    /二、|执行摘要/,
    /三、|需求提炼/,
    /四、|技术要求/,
    /五、|商务/,
    /六、|合规|致命红线/,
    /七、|供应链|采购可行性/,
    /八、|竞争力/,
    /九、|GO.*NO-GO|决策矩阵/,
    /十、|待确认/,
    /十一|行动/,
    /十二|最终结论/,
  ];
  let count = 0;
  for (const p of chapterPatterns) {
    if (p.test(markdown)) count++;
  }
  return { valid: count >= 8, chapterCount: count };
}

// ── 常量 ──────────────────────────────────────────────────────

export const VALID_RECOMMENDATIONS = ["pursue", "review_carefully", "low_probability", "skip"];
export const VALID_RISK_LEVELS = ["low", "medium", "high"];
