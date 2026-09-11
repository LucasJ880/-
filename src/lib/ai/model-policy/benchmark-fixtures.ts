/**
 * 脱敏后的 Qyane 真实任务形态（无客户原文 / 无密钥）。
 * 10 simple + 10 medium + 10 complex + 5 tool-heavy + 5 failure/recovery。
 */

export type BenchmarkBand =
  | "simple"
  | "medium"
  | "complex"
  | "tool-heavy"
  | "failure-recovery";

export interface BenchmarkCase {
  id: string;
  band: BenchmarkBand;
  workflow: string;
  role:
    | "supervisor"
    | "planner"
    | "researcher"
    | "coder"
    | "classifier"
    | "summarizer"
    | "chat"
    | "fast";
  title: string;
  prompt: string;
  expectStructured?: boolean;
  expectTools?: boolean;
  notes: string;
}

export const GPT6_BENCHMARK_CASES: BenchmarkCase[] = [
  // 10 simple — 不应升级 GPT-6
  {
    id: "S01",
    band: "simple",
    workflow: "title",
    role: "fast",
    title: "会话标题",
    prompt: "把这段销售跟进纪要压成 12 字以内标题。",
    notes: "Tier C",
  },
  {
    id: "S02",
    band: "simple",
    workflow: "translate",
    role: "fast",
    title: "短句翻译",
    prompt: "将询盘问候译成英文，不添加商务承诺。",
    notes: "Tier C",
  },
  {
    id: "S03",
    band: "simple",
    workflow: "rewrite",
    role: "summarizer",
    title: "礼貌改写",
    prompt: "把催款提醒改得更礼貌，不改变金额与日期。",
    notes: "Tier C",
  },
  {
    id: "S04",
    band: "simple",
    workflow: "metadata",
    role: "classifier",
    title: "标签抽取",
    prompt: "从产品短描述抽出 3 个品类标签。",
    notes: "Tier C",
  },
  {
    id: "S05",
    band: "simple",
    workflow: "format",
    role: "fast",
    title: "JSON 整形",
    prompt: "把已给出的键值整理成 JSON，禁止编造缺失字段。",
    expectStructured: true,
    notes: "Tier C / 可确定性替代",
  },
  {
    id: "S06",
    band: "simple",
    workflow: "summary",
    role: "summarizer",
    title: "邮件三行摘要",
    prompt: "将一封跟进邮件压成三行：目的/待办/风险。",
    notes: "Tier C",
  },
  {
    id: "S07",
    band: "simple",
    workflow: "classify",
    role: "classifier",
    title: "意向强弱",
    prompt: "把客户回复标成 hot/warm/cold，只依据文本。",
    notes: "Tier C",
  },
  {
    id: "S08",
    band: "simple",
    workflow: "caption",
    role: "fast",
    title: "社媒短文案",
    prompt: "为窗饰样品图写一句中文 caption。",
    notes: "Tier C",
  },
  {
    id: "S09",
    band: "simple",
    workflow: "language-assist",
    role: "fast",
    title: "语法润色",
    prompt: "修正英文询盘回复语法，不改变承诺范围。",
    notes: "Tier C",
  },
  {
    id: "S10",
    band: "simple",
    workflow: "weekly-brief",
    role: "summarizer",
    title: "数字周报",
    prompt: "用已汇总的签约/线索数字写 200 字周报。",
    notes: "Tier C；现有 weekly-report 旁路保持 Chat Completions",
  },
  // 10 medium
  {
    id: "M01",
    band: "medium",
    workflow: "quote-review",
    role: "chat",
    title: "报价草稿审阅",
    prompt: "审阅报价条款缺口，列出需人工确认项。",
    notes: "Tier B 候选，Phase 3 才考虑升级",
  },
  {
    id: "M02",
    band: "medium",
    workflow: "email-draft",
    role: "chat",
    title: "询盘回复草稿",
    prompt: "根据询价要点起草回复，禁止编造交期。",
    notes: "Tier B/C 交界",
  },
  {
    id: "M03",
    band: "medium",
    workflow: "supplier-classify",
    role: "classifier",
    title: "供应商标签",
    prompt: "按既有分类体系给供应商打标签。",
    notes: "保持 structured/terra；打分脊柱禁止 LLM",
  },
  {
    id: "M04",
    band: "medium",
    workflow: "sales-insight",
    role: "chat",
    title: "沟通洞察",
    prompt: "从通话纪要抽出异议与下一步。",
    notes: "Tier B 候选",
  },
  {
    id: "M05",
    band: "medium",
    workflow: "knowledge-extract",
    role: "classifier",
    title: "FAQ 抽取",
    prompt: "从客服对话抽出可复用 FAQ，禁止跨客户细节。",
    expectStructured: true,
    notes: "Tier B/C",
  },
  {
    id: "M06",
    band: "medium",
    workflow: "tender-enrich",
    role: "fast",
    title: "招标字段补全",
    prompt: "在证据窗口内补全已抽取字段，未知保持 UNKNOWN。",
    notes: "V2 有界 enrich，不因 GPT-6 放宽证据门",
  },
  {
    id: "M07",
    band: "medium",
    workflow: "ops-review",
    role: "chat",
    title: "内容合规审",
    prompt: "按发布规则检查文案，只输出违规点。",
    notes: "Tier B",
  },
  {
    id: "M08",
    band: "medium",
    workflow: "trade-intake",
    role: "classifier",
    title: "外贸意向结构化",
    prompt: "把服务咨询转成结构化 intake JSON。",
    expectStructured: true,
    notes: "Tier B",
  },
  {
    id: "M09",
    band: "medium",
    workflow: "secretary-brief",
    role: "summarizer",
    title: "日程简报",
    prompt: "根据今日任务列表写简报，不编造未列出的会议。",
    notes: "Tier C/B",
  },
  {
    id: "M10",
    band: "medium",
    workflow: "bid-fit-batch",
    role: "researcher",
    title: "批次资格初筛",
    prompt: "对 50 条强制项做资格映射，禁止猜测未出现条款。",
    expectStructured: true,
    notes: "现网 terra；Phase 3 benchmark 后再决定",
  },
  // 10 complex — Phase 1 GPT-6 候选
  {
    id: "C01",
    band: "complex",
    workflow: "supervisor-plan",
    role: "supervisor",
    title: "跨技能周计划",
    prompt: "把「分析本月销售并安排本周行动」拆成有界技能步骤。",
    expectStructured: true,
    notes: "Phase 1 / Tier A",
  },
  {
    id: "C02",
    band: "complex",
    workflow: "runtime-v2-planner",
    role: "planner",
    title: "FDE 计划",
    prompt: "为「检查报价草稿并准备跟进」产出 Runtime V2 plan JSON。",
    expectStructured: true,
    notes: "Phase 1 / FDE Observe-Plan",
  },
  {
    id: "C03",
    band: "complex",
    workflow: "tender-understanding",
    role: "researcher",
    title: "标书证据接地理解",
    prompt: "在证据窗口内抽取强制项，未知必须 UNKNOWN。",
    expectStructured: true,
    notes: "Phase 1；不得降低 evidence requirement",
  },
  {
    id: "C04",
    band: "complex",
    workflow: "market-research",
    role: "researcher",
    title: "市场深度研究",
    prompt: "综合公开竞品与渠道信息，标注不确定项。",
    notes: "Phase 1；已有主备超时",
  },
  {
    id: "C05",
    band: "complex",
    workflow: "tender-analysis-skill",
    role: "researcher",
    title: "老板决策标书报告",
    prompt: "对脱敏标书生成 bid/no-bid 输入材料，不代替人工决策。",
    notes: "Phase 1",
  },
  {
    id: "C06",
    band: "complex",
    workflow: "supervisor-repair",
    role: "supervisor",
    title: "失败后重规划",
    prompt: "技能失败后只修复失败步骤，禁止重跑已成功副作用。",
    notes: "Phase 1 / error recovery",
  },
  {
    id: "C07",
    band: "complex",
    workflow: "cross-doc-tender",
    role: "researcher",
    title: "多文档综合",
    prompt: "综合主标与补遗，冲突时列出证据对。",
    notes: "Phase 1 long-context，仍要 token discipline",
  },
  {
    id: "C08",
    band: "complex",
    workflow: "procurement-reasoning",
    role: "researcher",
    title: "采购可行性",
    prompt: "评估加拿大本地执行与替代贸易路径，必须引用证据。",
    notes: "Phase 2 候选；M1 打分脊柱保持确定性",
  },
  {
    id: "C09",
    band: "complex",
    workflow: "proposal-strategy",
    role: "planner",
    title: "投标策略备忘",
    prompt: "在合规矩阵之上写策略备忘，禁止无证据资格结论。",
    notes: "Phase 2",
  },
  {
    id: "C10",
    band: "complex",
    workflow: "supervisor-escalate",
    role: "supervisor",
    title: "主管升级",
    prompt: "多技能冲突时仲裁工具与审批，不自行授权外发。",
    notes: "Phase 1 / tool arbitration",
  },
  // 5 tool-heavy
  {
    id: "T01",
    band: "tool-heavy",
    workflow: "agent-core-operator",
    role: "chat",
    title: "Operator 工具环",
    prompt: "查询管道并起草跟进，工具须经 canInvokeTool。",
    expectTools: true,
    notes: "默认仍 5.6；若升 GPT-6 必须 Responses",
  },
  {
    id: "T02",
    band: "tool-heavy",
    workflow: "runtime-v2-execute",
    role: "coder",
    title: "FDE Execute/Verify",
    prompt: "按 plan 调只读工具，失败走 repair，禁止无审批外发。",
    expectTools: true,
    notes: "Phase 2 coder",
  },
  {
    id: "T03",
    band: "tool-heavy",
    workflow: "workforce-synthesis",
    role: "researcher",
    title: "Workforce 综合",
    prompt: "在有界输入上综合多 worker 结果。",
    expectTools: true,
    notes: "Phase 3",
  },
  {
    id: "T04",
    band: "tool-heavy",
    workflow: "sales-tools",
    role: "chat",
    title: "销售只读工具",
    prompt: "连续调用 pipeline / deal health，服务端授权。",
    expectTools: true,
    notes: "工具循环已有 max rounds",
  },
  {
    id: "T05",
    band: "tool-heavy",
    workflow: "mention-gateway",
    role: "chat",
    title: "Mention 只读",
    prompt: "外部 mention 只允许 l0_read 工具。",
    expectTools: true,
    notes: "不得因模型变强放宽 maxRisk",
  },
  // 5 failure/recovery
  {
    id: "F01",
    band: "failure-recovery",
    workflow: "timeout",
    role: "supervisor",
    title: "模型超时",
    prompt: "模拟 GPT-6 timeout 后同模型 1 次再 fallback。",
    notes: "禁止无限 retry",
  },
  {
    id: "F02",
    band: "failure-recovery",
    workflow: "rate-limit",
    role: "researcher",
    title: "429",
    prompt: "429 可重试；400 schema 不可重试。",
    notes: "retry classification",
  },
  {
    id: "F03",
    band: "failure-recovery",
    workflow: "malformed-tool",
    role: "chat",
    title: "损坏 tool arguments",
    prompt: "非法 JSON arguments 不得执行外部 mutation。",
    expectTools: true,
    notes: "server-side parse + 授权",
  },
  {
    id: "F04",
    band: "failure-recovery",
    workflow: "cancel",
    role: "supervisor",
    title: "用户取消",
    prompt: "AbortSignal 必须停止上游计费。",
    notes: "已有 abort 传播",
  },
  {
    id: "F05",
    band: "failure-recovery",
    workflow: "fallback-fail",
    role: "supervisor",
    title: "fallback 也失败",
    prompt: "fallback 失败后安全失败，不循环。",
    notes: "safe failure",
  },
];

export function describeBenchmarkInventory() {
  const counts: Record<BenchmarkBand, number> = {
    simple: 0,
    medium: 0,
    complex: 0,
    "tool-heavy": 0,
    "failure-recovery": 0,
  };
  for (const c of GPT6_BENCHMARK_CASES) counts[c.band]++;
  return { total: GPT6_BENCHMARK_CASES.length, counts };
}
