/**
 * FDE 无回复跟进草稿金样本输入（openspec change fde-preferences-in-followup）。
 *
 * 用途：证明草稿偏好开关关闭时，跟进草稿主题 / 正文与本 change 实施前逐字节一致。
 * followup-golden-pre-c2.json 是用本 change 改动之前的代码、对这里每个用例跑 renderFollowUpGolden 生成的，只生成一次：
 *   npx tsx -e 'import("./src/lib/revenue-spine/__tests__/fixtures/followup-golden-cases").then((m) => (m.writeFollowUpGolden ?? m.default.writeFollowUpGolden)())'
 * 默认模板以后有意改动时才重新生成，并在 PR 里说明。
 *
 * 公开仓库：只用虚构企业、人名与域名。输入全部手写。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNoReplyFollowUpDraft, type NoReplyFollowUpInput } from "../../fde/no-reply-followup";
import { buildClarifyingQuestions } from "../../rfq/missing-info";
import type { RfqField } from "../../rfq/types";

export const FOLLOWUP_GOLDEN_FILE = join(__dirname, "followup-golden-pre-c2.json");

export interface FollowUpGoldenCase {
  id: string;
  /** 不含 questions：由 missing 按调用方的方式生成（上限 3） */
  input: Omit<NoReplyFollowUpInput, "questions">;
  missing: RfqField[];
}

const SENT = new Date("2026-11-01T02:00:00Z");
const SIG = { afterName: ["Sales Manager"], afterOrg: ["WhatsApp +86 138 0013 8000", "www.example-home.example"] };
const MISSING: RfqField[] = ["quantity", "size", "destinationCountry", "destinationCity", "targetPrice"];

export function followUpGoldenCases(): FollowUpGoldenCase[] {
  const base = {
    total: 3,
    orgName: "示例家纺",
    senderName: "Lucy",
    previousSentAt: SENT,
    buyerFacingName: "Example Home Textile",
  };
  return [
    {
      id: "en-step1-event-contact-signature",
      input: { ...base, step: 1, language: "en", contactName: "Mark", previousSubject: "Great meeting you at Heimtextil — Flannel Throw — Example Home Textile", product: "Flannel Throw", event: "Heimtextil", signature: SIG },
      missing: MISSING,
    },
    {
      id: "en-step1-no-contact-no-event-no-questions",
      input: { ...base, step: 1, language: "en", contactName: null, previousSubject: null, product: null, event: null },
      missing: [],
    },
    {
      id: "en-step2-event-questions",
      input: { ...base, step: 2, language: "en", contactName: "Mark", previousSubject: "Re: Your inquiry about hotel bathrobes — Example Home Textile", product: "hotel bathrobes", event: "the Canton Fair", signature: SIG },
      missing: MISSING,
    },
    {
      id: "en-step2-no-product-no-questions",
      input: { ...base, step: 2, language: "en", contactName: "Mark", previousSubject: null, product: null, event: null },
      missing: [],
    },
    {
      id: "en-step3-last",
      input: { ...base, step: 3, language: "en", contactName: "Mark", previousSubject: "Re: Your inquiry", product: "hotel bathrobes", event: null, signature: SIG },
      missing: MISSING,
    },
    {
      id: "zh-step1-latin-event",
      input: { ...base, step: 1, language: "zh", contactName: "王先生", previousSubject: "感谢展位来访：法兰绒毯 — 示例家纺", product: "法兰绒毯", event: "Heimtextil", signature: SIG },
      missing: MISSING,
    },
    {
      id: "zh-step1-no-event-product",
      input: { ...base, step: 1, language: "zh", contactName: null, previousSubject: null, product: "酒店浴袍", event: null },
      missing: MISSING,
    },
    {
      id: "zh-step2-questions",
      input: { ...base, step: 2, language: "zh", contactName: "王先生", previousSubject: "回复：酒店浴袍询盘 — 示例家纺", product: "酒店浴袍", event: "广交会" },
      missing: MISSING,
    },
    {
      id: "zh-step3-last",
      input: { ...base, step: 3, language: "zh", contactName: "王先生", previousSubject: null, product: null, event: null, signature: SIG },
      missing: [],
    },
    {
      id: "en-step1-no-buyer-facing-name",
      input: { ...base, step: 1, language: "en", contactName: "Mark", previousSubject: "Re: inquiry", product: "blackout curtains", event: null, buyerFacingName: null },
      missing: ["incoterm", "packaging", "quantity"],
    },
  ];
}

export interface FollowUpGoldenDraft {
  id: string;
  subject: string;
  body: string;
  questionFields: string[];
}

/** 实施前的调用方式：追问按缺失字段、上限 3 生成，不传任何偏好 */
export function renderFollowUpGolden(c: FollowUpGoldenCase): FollowUpGoldenDraft {
  const questions = buildClarifyingQuestions(c.missing, c.input.language, 3);
  const d = buildNoReplyFollowUpDraft({ ...c.input, questions });
  return { id: c.id, subject: d.subject, body: d.body, questionFields: questions.map((q) => q.field) };
}

export function writeFollowUpGolden(): void {
  writeFileSync(FOLLOWUP_GOLDEN_FILE, `${JSON.stringify(followUpGoldenCases().map(renderFollowUpGolden), null, 2)}\n`);
}
