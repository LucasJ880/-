/**
 * Prompt construction and JSON parsing for project_progress_summary.
 */

// ── 输出结构 ──────────────────────────────────────────────────

export interface ProgressSummaryOutput {
  overallStatus: "green" | "yellow" | "red";
  statusLabel: string;
  currentJudgment: string;
  keyProgress: Array<{ item: string; significance: string }>;
  blockers: Array<{ item: string; severity: "high" | "medium" | "low"; impact: string }>;
  stageAlignment: string;
  nextActions: Array<{ action: string; purpose: string; owner: string; deadline: string; priority: "high" | "medium" | "low" }>;
  pendingConfirmations: string[];
  executiveSummary: string;
}

// ── 数据聚合结构 ──────────────────────────────────────────────

export interface ProjectData {
  project: Record<string, unknown>;
  intelligence: Record<string, unknown> | null;
  taskStats: { total: number; done: number; overdue: number; inProgress: number };
  tasks: Array<{ title: string; status: string; priority: string; dueDate: string | null }>;
  recentDiscussion: Array<{ sender: string; body: string; time: string; type: string }>;
  inquiries: Array<{ round: number; status: string; items: number; quoted: number }>;
  documents: Array<{ title: string; type: string; hasSummary: boolean }>;
  members: Array<{ name: string; role: string }>;
  auditHighlights: Array<{ action: string; target: string; time: string }>;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────

export const SYSTEM_PROMPT = `你是青砚 AI 项目进展分析师。

你的任务是根据项目的真实数据（任务状态、讨论记录、文档、询价进展、AI 情报等），生成一份**管理层可直接阅读的项目进展摘要**。

## 你不是
- 不是聊天机器人
- 不是只做语言润色的助手
- 不是只罗列更新的记录员

## 你是
- 一个能**判断项目阶段**的分析师
- 一个能**识别阻塞和风险**的顾问
- 一个能**给出具体下一步建议**的项目经理

## 分析原则
1. 先判断项目当前所处阶段，再决定哪些进展最重要
2. 优先总结"对当前阶段最重要的进展"，而不是平均展开
3. 如果项目实际上"功能很多但验证不足"，要敢于指出
4. 区分：已知事实 / 推断判断 / 待确认项
5. 行动建议必须具体（有负责人、有时限），不允许"建议进一步评估"这种空话
6. 语言简洁有力，不要套话空话流水账
7. 如果数据不足以支撑判断，明确写"待确认"，不要编造

## 项目管理专家视角（增强）
- 保持务实的范围控制：需求中没写的"高级"需求别自己加，基础实现就是正常的
- 找出需求中模糊或缺失的地方，在 pendingConfirmations 中主动指出
- 记住大多数第一版都需要 2-3 轮修改，合理预期交付质量
- 每个 nextAction 要控制在可执行粒度，避免模糊的大任务
- 如果发现范围蔓延迹象（做的越来越多但核心功能未闭环），在 stageAlignment 中明确警告

## 输出格式
返回纯 JSON，不要包含 markdown 代码块或其他文本。

{
  "overallStatus": "green | yellow | red",
  "statusLabel": "一句话状态（10字以内）",
  "currentJudgment": "2-4句话直接说明当前项目在哪个阶段、总体状态如何。这是给决策者看的第一段话。",
  "keyProgress": [
    { "item": "进展描述", "significance": "为什么这件事重要" }
  ],
  "blockers": [
    { "item": "阻塞/风险描述", "severity": "high|medium|low", "impact": "影响面说明" }
  ],
  "stageAlignment": "当前进展是否符合本阶段目标。如存在偏离（如建设过多验证不足、流程通但未测试），需明确指出。",
  "nextActions": [
    { "action": "具体动作", "purpose": "目的", "owner": "建议负责人", "deadline": "建议时限", "priority": "high|medium|low" }
  ],
  "pendingConfirmations": ["还缺哪些信息，导致判断不能完全落地"],
  "executiveSummary": "一句话管理层摘要，可直接转发"
}

## overallStatus 判定标准
- green: 进展正常，无阻塞，阶段目标对齐
- yellow: 有需关注项（逾期任务、时间紧迫、关键环节未推进），但总体可控
- red: 有严重阻塞、重大偏离、或关键风险未处理

## keyProgress 要求
- 只列最重要的 3-6 项，不要面面俱到
- 每项必须说明 significance（为什么重要），不能只说"做了什么"

## blockers 要求
- 列出 2-5 项最值得注意的阻塞/风险
- severity: high = 阻塞主流程, medium = 影响进度但可绕过, low = 需关注但暂不紧急
- 如果没有明显阻塞，可以写 0 条，但 stageAlignment 中要说明

## nextActions 要求
- 3-5 个动作，按优先级排序
- owner 写角色名或"待定"，不编造人名
- deadline 写相对时间如"本周内"/"下周一前"/"3天内"

## pendingConfirmations 要求
- 列出 0-3 项不确定因素
- 如果所有判断都有充分依据，可以为空数组`;

// ── Prompt 构建 ───────────────────────────────────────────────

export function buildUserPrompt(data: ProjectData): string {
  const lines: string[] = [];
  const p = data.project;

  lines.push(`# 项目：${p.name}`);
  if (p.description) lines.push(`描述：${String(p.description).slice(0, 300)}`);
  if (p.client) lines.push(`客户：${p.client}`);
  if (p.stage) lines.push(`当前阶段：${p.stage}`);
  lines.push(`优先级：${p.priority} | 状态：${p.status}`);
  if (p.closeDate) lines.push(`截止日期：${p.closeDate}`);
  if (p.location) lines.push(`地点：${p.location}`);
  if (p.estimatedValue) lines.push(`预估金额：${p.estimatedValue} ${p.currency || "CAD"}`);
  lines.push(`来源：${p.sourceSystem || "手动创建"} | 创建于：${p.createdAt}`);

  lines.push("");
  lines.push(`## 任务统计`);
  const ts = data.taskStats;
  lines.push(`总数: ${ts.total} | 已完成: ${ts.done} | 进行中: ${ts.inProgress} | 逾期: ${ts.overdue}`);
  if (ts.total > 0) {
    lines.push(`完成率: ${Math.round((ts.done / ts.total) * 100)}%`);
  }

  if (data.tasks.length > 0) {
    lines.push("");
    lines.push("## 近期任务明细（最新15条）");
    for (const t of data.tasks) {
      const due = t.dueDate ? ` [截止:${t.dueDate}]` : "";
      lines.push(`- [${t.status}][${t.priority}] ${t.title}${due}`);
    }
  }

  if (data.intelligence) {
    lines.push("");
    lines.push("## AI 情报分析结论");
    lines.push(`推荐: ${data.intelligence.recommendation} | 风险: ${data.intelligence.riskLevel} | 匹配度: ${data.intelligence.fitScore}%`);
    if (data.intelligence.summary) lines.push(`摘要: ${data.intelligence.summary}`);
    if (data.intelligence.reportStatus) lines.push(`报告审核状态: ${data.intelligence.reportStatus}`);
  }

  if (data.inquiries.length > 0) {
    lines.push("");
    lines.push("## 询价进展");
    for (const iq of data.inquiries) {
      lines.push(`- 第${iq.round}轮: ${iq.status}，${iq.items}家供应商，${iq.quoted}家已报价`);
    }
  }

  if (data.recentDiscussion.length > 0) {
    lines.push("");
    lines.push("## 最近讨论（最新15条）");
    for (const msg of data.recentDiscussion) {
      const prefix = msg.type === "SYSTEM" ? "[系统]" : `[${msg.sender}]`;
      lines.push(`- ${msg.time} ${prefix} ${msg.body}`);
    }
  }

  if (data.documents.length > 0) {
    lines.push("");
    lines.push(`## 项目文档（${data.documents.length}个）`);
    for (const d of data.documents) {
      lines.push(`- ${d.title} [${d.type}]${d.hasSummary ? " ✓已摘要" : ""}`);
    }
  }

  if (data.members.length > 0) {
    lines.push("");
    lines.push("## 项目成员");
    for (const m of data.members) {
      lines.push(`- ${m.name} (${m.role})`);
    }
  }

  if (data.auditHighlights.length > 0) {
    lines.push("");
    lines.push("## 近期活动日志");
    for (const a of data.auditHighlights) {
      lines.push(`- ${a.time} ${a.action} → ${a.target}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("请基于以上全部项目数据，生成项目进展摘要。");
  lines.push("要求：先判断阶段，再优先总结对当前阶段最重要的进展，指出阻塞和风险，给出具体下一步。");
  lines.push("返回纯 JSON。");

  return lines.join("\n");
}

// ── JSON 解析 ─────────────────────────────────────────────────

export function tryParseJson(raw: string): ProgressSummaryOutput | null {
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
    const status = ["green", "yellow", "red"].includes(parsed.overallStatus)
      ? parsed.overallStatus
      : "yellow";
    return {
      overallStatus: status,
      statusLabel: parsed.statusLabel || "状态待定",
      currentJudgment: parsed.currentJudgment || "",
      keyProgress: Array.isArray(parsed.keyProgress) ? parsed.keyProgress : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      stageAlignment: parsed.stageAlignment || "",
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
      pendingConfirmations: Array.isArray(parsed.pendingConfirmations) ? parsed.pendingConfirmations : [],
      executiveSummary: parsed.executiveSummary || "",
    };
  } catch {
    return null;
  }
}
