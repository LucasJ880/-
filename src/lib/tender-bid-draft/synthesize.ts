/**
 * 投标文件起草 · 合成：LLM 产出英文提交稿各节 + 中文内部注；
 * 后处理保证：每条强制要求都有响应（缺失→占位）、提交面剔除竞对名称、
 * 禁用语命中→占位并记内部注。AI_DRAFT 语义，人工审阅后才可提交。
 */

import {
  callStructured,
  createUnifiedRuntimeInvoker,
  type LlmInvoker,
} from "@/lib/tender-understanding/llm";
import {
  BID_DRAFT_PROMPT,
  BID_DRAFT_VERSION,
  bidDraftLlmSchema,
  COMPLIANCE_LABEL_EN,
  PLACEHOLDER_RE,
  type BidDraftInputs,
  type BidDraftLlmOutput,
  type BidDraftResult,
} from "./contract";

const SYSTEM_PROMPT = `You are a senior bid writer drafting a SUBMISSION-READY English bid response for a Canadian public-sector solicitation, on behalf of the BIDDER (the organization described in ORG PROFILE). Chinese internal notes go to internalNotesZh only.

HARD RULES (violations make the draft unusable):
1. Ground every statement in the provided inputs. Capabilities, certifications, staff, past projects, locations and dates may ONLY come from ORG PROFILE / VERIFIED ORG FACTS / OWN PAST WINS / HUMAN MATRIX NOTES. If something required is not supported by those inputs, write a placeholder exactly in the form [TO CONFIRM: what is needed] instead of inventing it.
2. Never state or imply a price, discount or total. pricingSummaryEn only explains the pricing structure required by the solicitation and says the price is provided in the Bid Form; if OUR PRICE INPUT is null, write [TO CONFIRM: bid price].
3. Never mention any competitor or incumbent supplier by name anywhere.
4. complianceResponses: one entry per requirement code in REQUIREMENTS (all of them). Wording by status: COMPLIANT → affirmative compliance statement grounded in the human note if present; COMPLIANT_ON_AWARD → compliant upon award with the plan; COMPLIANT_VIA_PARTNER → compliant through a partner (partner name only if given in notes, else [TO CONFIRM: partner]); CLARIFICATION_REQUESTED → note that a clarification has been submitted; TO_CONFIRM → "[TO CONFIRM: ...]" placeholder describing what must be confirmed; INTERNAL_NO_GO → "[INTERNAL: requirement not met — decide before submission]". Keep each response 1–3 sentences, specific to the requirement text.
5. Respect FORBIDDEN CLAIMS (never use those expressions). Use the brand tone if given.
6. Do not output any overall bid/no-bid recommendation. This is a draft for human review.
7. Output ONE valid JSON object with EXACTLY these keys: coverLetterEn, executiveSummaryEn, complianceResponses (array of {requirementCode, responseEn}), technicalApproachEn, companyProfileEn, socialValueGuidanceEn, pricingSummaryEn, internalNotesZh (array of Simplified Chinese strings listing gaps, assumptions and items needing human input).`;

function scrubNames(text: string, names: string[]): { text: string; hits: number } {
  let hits = 0;
  let out = text;
  for (const n of names) {
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, () => {
      hits += 1;
      return "[a third-party supplier]";
    });
  }
  return { text: out, hits };
}

function forbiddenPhrases(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,;，；、]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60)
    .slice(0, 40);
}

export async function synthesizeBidDraft(
  input: BidDraftInputs,
  opts: { invoker?: LlmInvoker; timeoutMs?: number } = {},
): Promise<{ result: BidDraftResult | null; errorCode: string | null }> {
  const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
  const reqForPrompt = input.requirements.slice(0, 60).map((r) => ({
    code: r.code,
    mandatory: r.mandatory,
    category: r.category,
    requirement: r.textOriginal || r.textZh,
    status: r.status,
    humanNoteZh: r.noteZh,
  }));
  const userPrompt = [
    `SOLICITATION: ${JSON.stringify(input.project)}`,
    `KEY FACTS: ${JSON.stringify(input.criticalFacts)}`,
    `REQUIREMENTS (${reqForPrompt.length}; respond to EVERY code): ${JSON.stringify(reqForPrompt)}`,
    `ANALYST SYNTHESIS (excerpt): ${JSON.stringify(input.analystBrief).slice(0, 3500)}`,
    `SUBMISSION CHECKLIST: ${JSON.stringify(input.submissionChecklist).slice(0, 1500)}`,
    `STRATEGY MEMO (internal, do not quote verbatim in submission): ${JSON.stringify(input.memo).slice(0, 2000)}`,
    `CLARIFICATIONS SUBMITTED COUNT: ${input.rfiCount}`,
    `OUR PRICE INPUT: ${JSON.stringify(input.pricing.ourPriceCad)} (note: ${input.pricing.note})`,
    `ORG PROFILE (brand context, may be null): ${input.org.brandContext ?? "null"}`,
    `VERIFIED ORG FACTS (${input.org.memoryClaims.length}): ${JSON.stringify(input.org.memoryClaims).slice(0, 3000)}`,
    `OWN PAST WINS (${input.org.ownWins.length}): ${JSON.stringify(input.org.ownWins)}`,
    `FORBIDDEN CLAIMS: ${input.org.forbiddenClaims ?? "none"}`,
  ].join("\n");

  const res = await callStructured(
    invoker,
    {
      promptName: BID_DRAFT_PROMPT.name,
      promptVersion: BID_DRAFT_PROMPT.version,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 16_000,
      timeoutMs: opts.timeoutMs ?? 180_000,
    },
    bidDraftLlmSchema,
  );
  if (!res.ok) return { result: null, errorCode: res.errorCode };
  const out: BidDraftLlmOutput = res.value;

  // 后处理 ① 合规覆盖：每条要求必须有响应；缺失 → 按状态占位
  const byCode = new Map<string, string>();
  for (const c of out.complianceResponses) {
    if (c && c.requirementCode && c.responseEn) byCode.set(c.requirementCode, c.responseEn);
  }
  const compliance = input.requirements.map((r) => {
    const given = byCode.get(r.code);
    const responseEn =
      given && given.trim()
        ? given
        : r.status === "COMPLIANT" && r.noteZh
          ? `Compliant. ${r.noteZh}`
          : `${COMPLIANCE_LABEL_EN[r.status]}${r.status === "TO_CONFIRM" ? ` [TO CONFIRM: response to ${r.code}]` : ""}`;
    return { ...r, responseEn };
  });

  // 后处理 ② 提交面剔除竞对/现任名称；③ 禁用语扫描
  let excludedNameHits = 0;
  let forbiddenHits = 0;
  const forbidden = forbiddenPhrases(input.org.forbiddenClaims);
  const clean = (s: string): string => {
    const a = scrubNames(s, input.excludeNames);
    excludedNameHits += a.hits;
    let t = a.text;
    for (const f of forbidden) {
      const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      t = t.replace(re, () => {
        forbiddenHits += 1;
        return "[TO CONFIRM: wording — forbidden claim removed]";
      });
    }
    return t;
  };
  const sections: BidDraftLlmOutput = {
    coverLetterEn: clean(out.coverLetterEn),
    executiveSummaryEn: clean(out.executiveSummaryEn),
    complianceResponses: compliance.map((c) => ({ requirementCode: c.code, responseEn: clean(c.responseEn) })),
    technicalApproachEn: clean(out.technicalApproachEn),
    companyProfileEn: clean(out.companyProfileEn),
    socialValueGuidanceEn: clean(out.socialValueGuidanceEn),
    pricingSummaryEn: clean(out.pricingSummaryEn),
    internalNotesZh: out.internalNotesZh.slice(0, 30),
  };
  const complianceClean = compliance.map((c, i) => ({ ...c, responseEn: sections.complianceResponses[i]!.responseEn }));
  const allText = [
    sections.coverLetterEn,
    sections.executiveSummaryEn,
    sections.technicalApproachEn,
    sections.companyProfileEn,
    sections.socialValueGuidanceEn,
    sections.pricingSummaryEn,
    ...complianceClean.map((c) => c.responseEn),
  ].join("\n");
  const placeholders = (allText.match(PLACEHOLDER_RE) ?? []).length;
  if (excludedNameHits > 0) sections.internalNotesZh.push(`提交面曾出现竞对/现任名称 ${excludedNameHits} 处，已替换为 [a third-party supplier]，请复核`);
  if (forbiddenHits > 0) sections.internalNotesZh.push(`命中品牌禁用语 ${forbiddenHits} 处，已替换为占位，请改写`);

  return {
    result: {
      version: BID_DRAFT_VERSION,
      generatedAt: new Date().toISOString(),
      sections,
      compliance: complianceClean,
      placeholders,
      excludedNameHits,
      forbiddenHits,
      llmCalls: res.logs.length,
    },
    errorCode: null,
  };
}
