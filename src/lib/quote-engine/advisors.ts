/**
 * Quote Engine · AI 建议器（Sunny 定价链 v1 P1）——只建议、不落库。
 *
 *  关税建议：识别材料品类 → Tavily 查加拿大现行关税（含对华附加税）→ LLM 归纳出税率建议 + 出处；
 *            无 TAVILY / 无 LLM → ADVISOR_UNAVAILABLE（fail-closed，绝不猜税率）。
 *  毛利建议：基于成本结构（类别分布 / 规模 / 报价类型）给 15–30% 区间内的建议值 + 理由。
 *
 *  纪律：AI 仅 advisory（与企业记忆「AI 自动写硬禁」同族）；采纳动作永远由人在 UI 里点「采用」完成；
 *        输出必须是严格 JSON，解析失败即报错，不做静默兜底。
 */

import { createCompletion } from "@/lib/ai/client";
import { hasWebSearchKey } from "@/lib/tender-intel/websearch";

export class AdvisorError extends Error {
  constructor(public code: "ADVISOR_UNAVAILABLE" | "ADVISOR_PARSE_ERROR" | "ADVISOR_INPUT_INVALID", message: string) {
    super(message);
    this.name = "AdvisorError";
  }
}

export type DutySource = { title: string; url: string; snippet: string };
export type DutyAdvice = {
  ratePct: number;
  hsCodeGuess: string | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  rationaleZh: string;
  sources: DutySource[];
};
export type MarginAdvice = {
  marginPct: number;
  rationaleZh: string;
  considerations: string[];
};

const TAVILY_URL = "https://api.tavily.com/search";

async function tavily(query: string, env: NodeJS.ProcessEnv): Promise<DutySource[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results: 5, search_depth: "basic" }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? []).filter((r) => r.url).map((r) => ({ title: (r.title ?? r.url ?? "").slice(0, 160), url: r.url!, snippet: (r.content ?? "").slice(0, 400) }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonStrict<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new AdvisorError("ADVISOR_PARSE_ERROR", "模型未输出 JSON");
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    throw new AdvisorError("ADVISOR_PARSE_ERROR", "模型 JSON 解析失败");
  }
}

export async function adviseDutyRate(input: { orgId: string; userId: string; materials: string[]; env?: NodeJS.ProcessEnv }): Promise<DutyAdvice> {
  const env = input.env ?? process.env;
  const materials = input.materials.map((m) => m.trim()).filter(Boolean).slice(0, 8);
  if (materials.length === 0) throw new AdvisorError("ADVISOR_INPUT_INVALID", "没有可识别的材料行（请先填写材料行说明）");
  if (!hasWebSearchKey(env)) throw new AdvisorError("ADVISOR_UNAVAILABLE", "未配置 Web 检索（TAVILY_API_KEY），拒绝凭空猜税率");
  const desc = materials.join("; ");
  const year = new Date().getFullYear();
  const queries = [
    `Canada import tariff rate ${desc} from China ${year} CBSA customs tariff`,
    `Canada surtax China ${desc} ${year} rate percent`,
  ];
  const found = (await Promise.all(queries.map((q) => tavily(q, env)))).flat();
  const dedup = [...new Map(found.map((f) => [f.url, f])).values()].slice(0, 8);
  if (dedup.length === 0) throw new AdvisorError("ADVISOR_UNAVAILABLE", "检索无结果，无法给出有依据的税率建议（请人工查 CBSA 关税表）");
  const raw = await createCompletion({
    systemPrompt:
      "你是加拿大进口关税顾问。基于提供的检索片段，判断该材料从中国进口到加拿大的现行合计税率（MFN/普惠税率 + 任何对华附加税/反倾销税，若适用）。" +
      '只输出严格 JSON：{"ratePct": number, "hsCodeGuess": string|null, "confidence": "LOW"|"MEDIUM"|"HIGH", "rationaleZh": string, "sourceIndexes": number[]}。' +
      "ratePct 是百分数（如 25 表示 25%）。依据不足时 confidence 用 LOW 并在 rationaleZh 说明缺什么。绝不编造来源。",
    userPrompt: `材料：${desc}\n\n检索片段：\n${dedup.map((f, i) => `[${i}] ${f.title}\n${f.url}\n${f.snippet}`).join("\n\n")}`,
    maxTokens: 700,
    temperature: 0,
    orgId: input.orgId,
    userId: input.userId,
  });
  const parsed = parseJsonStrict<{ ratePct?: unknown; hsCodeGuess?: unknown; confidence?: unknown; rationaleZh?: unknown; sourceIndexes?: unknown }>(raw);
  const rate = Number(parsed.ratePct);
  if (!Number.isFinite(rate) || rate < 0 || rate > 200) throw new AdvisorError("ADVISOR_PARSE_ERROR", "模型给出的税率不合法");
  const idx = Array.isArray(parsed.sourceIndexes) ? (parsed.sourceIndexes as unknown[]).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < dedup.length) : [];
  return {
    ratePct: Math.round(rate * 100) / 100,
    hsCodeGuess: typeof parsed.hsCodeGuess === "string" && parsed.hsCodeGuess.trim() ? parsed.hsCodeGuess.trim().slice(0, 20) : null,
    confidence: parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" ? parsed.confidence : "LOW",
    rationaleZh: typeof parsed.rationaleZh === "string" ? parsed.rationaleZh.slice(0, 1200) : "（模型未给理由）",
    sources: (idx.length > 0 ? idx : dedup.map((_, i) => i)).map((i) => dedup[i]!),
  };
}

export async function adviseMargin(input: {
  orgId: string;
  userId: string;
  quoteType: string;
  currency: string;
  projectName: string | null;
  baseCost: number;
  breakdown: Array<{ category: string; amount: number }>;
}): Promise<MarginAdvice> {
  if (!(input.baseCost > 0)) throw new AdvisorError("ADVISOR_INPUT_INVALID", "成本为 0，先填成本行再请求毛利建议");
  const raw = await createCompletion({
    systemPrompt:
      "你是投标定价顾问。Sunny 的冻结口径：毛利率按售价倒扣（S = C ÷ (1−m)），可调区间 15%–30%；销售提成 = 毛利 × 30%（已在成本模型内，不需你考虑）。" +
      "基于成本结构给出 15–30 之间的建议毛利率。竞争激烈/大额/纯供货 → 低档；小额/含安装与风险 → 高档。" +
      '只输出严格 JSON：{"marginPct": number, "rationaleZh": string, "considerations": string[]}（considerations ≤ 4 条，中文）。',
    userPrompt: `报价类型：${input.quoteType}\n项目：${input.projectName ?? "—"}\n币种：${input.currency}\n成本合计（含关税/资金使用/管理费/CashAllowance）：${input.baseCost.toFixed(2)}\n成本结构：\n${input.breakdown.map((b) => `${b.category}: ${b.amount.toFixed(2)}`).join("\n")}`,
    maxTokens: 500,
    temperature: 0,
    orgId: input.orgId,
    userId: input.userId,
  });
  const parsed = parseJsonStrict<{ marginPct?: unknown; rationaleZh?: unknown; considerations?: unknown }>(raw);
  const m = Number(parsed.marginPct);
  if (!Number.isFinite(m)) throw new AdvisorError("ADVISOR_PARSE_ERROR", "模型给出的毛利率不合法");
  return {
    marginPct: Math.min(30, Math.max(15, Math.round(m * 10) / 10)),
    rationaleZh: typeof parsed.rationaleZh === "string" ? parsed.rationaleZh.slice(0, 1200) : "（模型未给理由）",
    considerations: Array.isArray(parsed.considerations) ? (parsed.considerations as unknown[]).filter((x) => typeof x === "string").slice(0, 4) as string[] : [],
  };
}
