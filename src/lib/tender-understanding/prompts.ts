/**
 * Tender Understanding V2 — 版本化 Prompt 集中管理
 *
 * 规则：
 * - Prompt 只描述通用任务与证据纪律；禁止出现任何具体 Tender 的答案性内容
 *   （固定编号/买方/产品/颜色/容量/日期），禁止领域模板（背包/窗饰均不得内置）。
 * - 版本号变更 = 行为变更，benchmark metadata 会记录 promptVersion。
 */

export const PROMPT_EXTRACT = {
  name: "tender-understanding-v2-extract",
  // @4：明确「pageNumber 必须是引文所在的那个 PAGE/UNIT 块」——
  // 生产实测多单元窗口（尤其 xlsx 工作表）下模型高频引错单元号。
  version: "tender-understanding-v2-extract@4",
} as const;

export const PROMPT_RESOLVE = {
  name: "tender-understanding-v2-resolve",
  version: "tender-understanding-v2-resolve@1",
} as const;

/* ---------------------------------- 抽取（Pass 1） ---------------------------------- */

export const EXTRACT_SYSTEM_PROMPT = `You are a tender/RFP analyst. You extract structured data from the tender document pages provided in the user message. You work for the bidder.

HARD RULES — violating any of these makes the output unusable:
1. Extract ONLY information stated in the provided pages. No outside knowledge. No industry defaults. No guesses.
2. EVERY item must cite: sourceDocumentId (exactly as given), pageNumber (a page shown in this message), and sourceSnippet — a VERBATIM quote copied character-for-character from that page (20–400 chars). If you cannot quote real evidence, DO NOT output the item.
3. A field you cannot support with the text = null. Never invent a value to satisfy the schema. Missing information is a legitimate result.
4. "requirements" are obligations/conditions on the bidder/offeror/contractor/supplier (what they must do, provide, submit, comply with, or how the bid can be rejected).
5. mandatory: true ONLY when binding language applies to the item (e.g. must / shall / required / mandatory / will be rejected / failure to ... will result / condition of bid / non-responsive). Copy the exact triggering words into mandatorySignal. If the binding force is unclear, use "uncertain" — never guess true.
6. "facts" are project-level data points. Use factType from the taxonomy; if none fits use "other". rawValue = the literal value text from the page (e.g. a date, an amount), else null.
7. "potentialRisks" only when grounded in the text (contradictions, tight deadlines, rejection conditions, missing referenced forms, compliance constraints, commercial exposure). Cite evidence like everything else.
8. "ambiguities" = places where the document is unclear, self-contradictory, or references something it does not define. whatIsUnknown must state precisely what a bidder cannot determine.
9. If this document is an ADDENDUM/AMENDMENT and the text changes, replaces, revises, extends or deletes an earlier provision, set revisionAction accordingly and put the original provision's identifier/topic in revisionTargetHint.
10. Do not summarize the whole document. Extract discrete items only from these pages.
CATEGORY DISCIPLINE — "Vendor must ..." alone does NOT make something TECHNICAL or bid-critical:
  - TECHNICAL: ONLY product specifications, materials, dimensions, performance, testing, quality standards, technical installation, engineering criteria.
  - PRODUCT: composition / model / function / packaging / specification of the product itself.
  - SUBMISSION: documents, forms, formats, portal steps, signatures required to SUBMIT the bid.
  - ADMINISTRATIVE: general administration, notices, conflict of interest, contacts.
  - PRICING: how to price, price tables, pricing rules. COMMERCIAL: payment, invoicing, Procurement Card, commercial terms.
  - DELIVERY: delivery location, timing, quantities, logistics. INSURANCE/BONDING: strictly those topics.
  - REPORTING: reports, records, invoice supporting info. OTHER: when nothing fits.
  - Invoicing / Procurement Card / confidentiality / notices / force majeure / records retention / gifts & hospitality are NEVER "TECHNICAL" — use COMMERCIAL, REPORTING or ADMINISTRATIVE (e.g. "Vendor must email invoices..." → COMMERCIAL or REPORTING, submissionStage "after award").
STAGE DISCIPLINE — always try to fill submissionStage with one of: "with bid" / "pre-award" / "post-award" / "ongoing"; null only when truly undeterminable. Post-award contract obligations (invoices, reports, records, payment) are "post-award", not bid submission conditions.
11. Coverage guidance (still evidence-bound, never invented):
   a. Capture document identification data as facts when present: issue/publication date, solicitation/reference numbers, buyer identity, contact for questions.
   b. Deadlines expressed as RULES count as facts too (e.g. "questions no later than N days before closing" → question_deadline with the rule text as rawValue).
   c. Capture quantity/pricing schedule rows and stated quantity limits as quantity facts (e.g. estimated annual quantities, "up to N per period"), quoting the row/line.
   d. When scope lists products/services, include the enumeration in the scope fact claim so the product types are preserved.
12. Output ONLY one JSON object matching the schema below. No markdown, no commentary, no code fences.

SCHEMA (all arrays may be empty; that is a valid answer):
{
  "facts": [{
    "factType": "buyer|tender_number|project_title|closing_datetime|question_deadline|site_visit|location|scope|quantity|contract_duration|delivery|installation|warranty|bond|insurance|submission_method|pricing_method|addenda|other",
    "claim": "concise statement of the fact",
    "rawValue": "literal value text from page or null",
    "sourceDocumentId": "...", "pageNumber": 1, "sourceSnippet": "verbatim quote", "confidence": "HIGH|MEDIUM|LOW"
  }],
  "requirements": [{
    "category": "ADMINISTRATIVE|SUBMISSION|MANDATORY|TECHNICAL|PRODUCT|PERFORMANCE|INSTALLATION|DELIVERY|WARRANTY|BONDING|INSURANCE|SAFETY|SAMPLES|SHOP_DRAWINGS|TRAINING|PRICING|COMMERCIAL|SITE_VISIT|SCHEDULE|REPORTING|OTHER",
    "statement": "the obligation, self-contained and specific",
    "actor": "who must act, or null", "action": "what they must do, or null", "object": "what it applies to, or null",
    "mandatory": true, "mandatorySignal": "exact binding words or null",
    "deadline": "literal deadline text or null", "quantity": "literal quantity text or null", "unit": "unit or null",
    "submissionStage": "e.g. with bid / after award / before payment, or null", "technicalArea": "or null",
    "revisionAction": "CHANGES|REPLACES|REVISES|EXTENDS|DELETES or null", "revisionTargetHint": "or null",
    "sourceDocumentId": "...", "pageNumber": 1, "sourceSnippet": "verbatim quote", "confidence": "HIGH|MEDIUM|LOW"
  }],
  "potentialRisks": [{
    "riskType": "MANDATORY_MISSING|DEADLINE|CONTRADICTION|AMBIGUITY|MISSING_FORM|TECHNICAL|COMPLIANCE|COMMERCIAL|SUBMISSION|ADDENDUM_CONFLICT|EVIDENCE_GAP",
    "description": "...", "sourceDocumentId": "...", "pageNumber": 1, "sourceSnippet": "verbatim quote", "confidence": "HIGH|MEDIUM|LOW"
  }],
  "ambiguities": [{
    "topic": "...", "description": "...", "whatIsUnknown": "...",
    "sourceDocumentId": "...", "pageNumber": 1, "sourceSnippet": "verbatim quote", "confidence": "HIGH|MEDIUM|LOW"
  }]
}`;

export function buildExtractUserPrompt(window: {
  documentId: string;
  documentName: string;
  sourceRole: string;
  headings: string[];
  pages: {
    pageNumber: number;
    contentText: string;
    unitKind?: string | null;
    unitLabel?: string | null;
  }[];
}): string {
  const header = [
    `DOCUMENT: ${window.documentName}`,
    `documentId: ${window.documentId}`,
    `sourceRole: ${window.sourceRole}`,
    window.headings.length > 0
      ? `nearby headings: ${window.headings.join(" | ")}`
      : null,
    "",
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
  // 非 PDF 没有页：定位单元用真实标签（Sheet/段落块），并明确 pageNumber 是单元序号。
  // 绝不把单元序号说成"页"——引用要能被人核验回原文。
  const body = window.pages
    .map((p) => {
      const isPage = !p.unitKind || p.unitKind === "page";
      const locator = isPage
        ? `PAGE ${p.pageNumber}`
        : `UNIT ${p.pageNumber} (${p.unitKind}${p.unitLabel ? `: ${p.unitLabel}` : ""})`;
      return `=== documentId ${window.documentId} ${locator} ===\n${p.contentText}`;
    })
    .join("\n\n");
  return `${header}${body}

LOCATION RULE (strict):
- Each block above starts with a marker line: "=== documentId <id> PAGE <n> ===" or
  "=== documentId <id> UNIT <n> (kind: label) ===".
- sourceSnippet MUST be copied verbatim from ONE single block. Never merge lines from
  two different blocks into one snippet.
- pageNumber MUST be the <n> of the block your sourceSnippet was copied from — not the
  first block, not the block you are summarising about. Copy the number from that block's
  marker line.

Extract facts / requirements / potentialRisks / ambiguities from the blocks above. JSON only.`;
}

/* ---------------------------------- 澄清解决检查（corpus resolution） ---------------------------------- */

export const RESOLVE_SYSTEM_PROMPT = `You are a tender analyst checking whether a question a bidder wants to ask is ALREADY ANSWERED somewhere in the tender document set.

RULES:
1. Judge only from the candidate pages provided. No outside knowledge.
2. resolved: true ONLY if the pages explicitly answer the question. Partial hints are not answers.
3. When resolved, cite: answerDocumentId, answerPageNumber (from the provided pages), answerSnippet — a VERBATIM quote containing the answer, and a one-sentence answerSummary.
4. When not resolved: {"resolved": false, "answerSummary": null, "answerDocumentId": null, "answerPageNumber": null, "answerSnippet": null}.
5. Output ONLY one JSON object. No prose.`;

export function buildResolveUserPrompt(input: {
  question: string;
  whatIsUnknown: string;
  candidatePages: {
    documentId: string;
    pageNumber: number;
    contentText: string;
  }[];
}): string {
  const pages = input.candidatePages
    .map(
      (p) =>
        `=== documentId ${p.documentId} PAGE ${p.pageNumber} ===\n${p.contentText}`,
    )
    .join("\n\n");
  return `QUESTION: ${input.question}\nWHAT IS UNKNOWN: ${input.whatIsUnknown}\n\nCANDIDATE PAGES:\n${pages}\n\nIs the question already answered by these pages? JSON only.`;
}
