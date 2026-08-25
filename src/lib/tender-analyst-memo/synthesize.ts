/**
 * 分析师备忘录 v1 · 判断层合成（AI_INFERRED，人审语义）
 *
 * 定位：把「GPT 式一份连贯投标分析备忘录」搬进平台证据纪律——
 *  - 表格/事实/标准展开/市场基准全部来自确定性数据与已接地的情报模块（不在这里产生）
 *  - 本合成器只产出**判断层**：执行摘要 / GO-NO-GO 矩阵 / 风险对策 / 规格歧义 RFI / 下一步 / 数据缺口
 *  - 铁律：每条判断标 basedOn（依据模块）；金额只准复述输入中出现的数字；缺数据明说；
 *    GO/NO-GO 是**分维评级**，不产整体投/不投结论（决策权在人）
 */

import { z } from "zod";
import { callStructured, createUnifiedRuntimeInvoker, type LlmInvoker } from "@/lib/tender-understanding/llm";

export const ANALYST_MEMO_VERSION = "tender-analyst-memo/v1" as const;

const zh = (max: number) => z.preprocess((v) => String(v ?? "").slice(0, max), z.string().min(1));
const zhOpt = (max: number) => z.preprocess((v) => String(v ?? "").slice(0, max), z.string());

export const analystMemoLlmSchema = z.object({
  execSummaryZh: zh(700),
  goNoGo: z
    .array(
      z.object({
        dimensionZh: zh(60),
        rating: z.enum(["GREEN", "YELLOW", "RED"]),
        reasonZh: zh(220),
        basedOn: zh(60),
      }),
    )
    .min(4)
    .max(10),
  risks: z
    .array(
      z.object({
        riskZh: zh(220),
        severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
        mitigationZh: zh(260),
        basedOn: zh(60),
      }),
    )
    .max(8)
    .default([]),
  rfiSuggestions: z
    .array(
      z.object({
        questionZh: zh(260),
        questionEn: zh(260),
        whyZh: zhOpt(180),
      }),
    )
    .max(8)
    .default([]),
  nextStepsZh: z.array(zh(200)).max(6).default([]),
  dataGapsZh: z.array(zh(200)).max(6).default([]),
});
export type AnalystMemoLlm = z.infer<typeof analystMemoLlmSchema>;

export type AnalystMemoDigest = {
  project: { nameZh: string; buyer: string | null; closeDate: string | null; solicitationNumber: string | null };
  criticalFactsDigest: string[];
  requirementsDigest: { mandatoryCount: number; totalCount: number; top: string[] };
  synthesisDigest: string[];
  standardsDigest: string[];
  marketDigest: string[];
  strategyDigest: string[];
  pricingDigest: string[];
  quoteDigest: string[];
};

export async function synthesizeAnalystMemo(input: {
  digest: AnalystMemoDigest;
  invoker?: LlmInvoker;
}): Promise<{ memo: AnalystMemoLlm | null; errorCode: string | null }> {
  const d = input.digest;
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const sec = (title: string, rows: string[]) => (rows.length > 0 ? `【${title}】\n${rows.map((r) => `- ${r}`).join("\n")}` : `【${title}】\n- （无数据）`);
  const userPrompt = [
    `项目：${d.project.nameZh}（采购方：${d.project.buyer ?? "未知"}；截标：${d.project.closeDate ?? "未知"}；标号：${d.project.solicitationNumber ?? "未知"}）`,
    sec("关键事实", d.criticalFactsDigest),
    `【强制要求】共 ${d.requirementsDigest.totalCount} 条（其中强制 ${d.requirementsDigest.mandatoryCount} 条），要点：\n${d.requirementsDigest.top.map((r) => `- ${r}`).join("\n") || "- （无）"}`,
    sec("分析师综合", d.synthesisDigest),
    sec("引用标准展开（M3，已接地）", d.standardsDigest),
    sec("市场价格基准（M4，已接地，原币未换算）", d.marketDigest),
    sec("策略备忘录要点", d.strategyDigest),
    sec("价格演算/对标（确定性数字，不得重算）", d.pricingDigest),
    sec("我方报价引擎快照", d.quoteDigest),
  ].join("\n\n").slice(0, 14000);
  try {
    const res = await callStructured(
      invoker,
      {
        promptName: "tender-analyst-memo",
        promptVersion: "1",
        timeoutMs: 120_000,
        maxTokens: 2400,
        systemPrompt:
          "你是投标分析师，为管理层写一份备忘录的**判断层**。只输出 JSON：" +
          '{"execSummaryZh","goNoGo":[{"dimensionZh","rating":"GREEN|YELLOW|RED","reasonZh","basedOn"}],"risks":[{"riskZh","severity":"HIGH|MEDIUM|LOW","mitigationZh","basedOn"}],"rfiSuggestions":[{"questionZh","questionEn","whyZh"}],"nextStepsZh":[],"dataGapsZh":[]}。' +
          "纪律：① 每条 goNoGo/risks 的 basedOn 标注依据来自哪段输入（如 关键事实/强制要求/引用标准/市场基准/策略备忘录/价格演算/报价快照）；" +
          "② 金额与数字只准复述输入中出现的，绝不自行估算或换算；" +
          "③ goNoGo 至少覆盖：合规可行性、资格经验、交付周期、供应链、价格竞争力（4-10 维，每维独立评级，不给整体投/不投结论）；" +
          "④ rfiSuggestions 面向**规格歧义**（定义不清、结构未指明、验收口径缺失的条款），中英对照，可直接向采购方提交；" +
          "⑤ 输入缺什么就写进 dataGapsZh（如无市场基准、无历史授标），不要假装知道。",
        userPrompt,
      },
      analystMemoLlmSchema,
    );
    if (!res.ok) return { memo: null, errorCode: res.errorCode ?? "LLM_FAILED" };
    return { memo: res.value, errorCode: null };
  } catch (e) {
    return { memo: null, errorCode: e instanceof Error ? e.message.slice(0, 80) : "LLM_ERROR" };
  }
}
