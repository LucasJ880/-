/**
 * Addendum 对照标签 + 后发布补遗优先。
 * 运行：npx tsx src/lib/tender-understanding/__tests__/addendum-disposition.test.ts
 */
import assert from "node:assert";
import { analyzeTender } from "../analyzer";
import { ANALYZED_WITH_FALLBACK_MODEL } from "@/lib/ai/model-policy";
import { assembleAnalysisResult, deriveGroundedState } from "../analyzer";
import { buildDocumentManifest } from "../manifest";
import { doc, input, makeOk, scriptedInvoker } from "./helpers";

const { ok, count } = makeOk();

function warrantyReq(
  documentId: string,
  pageNumber: number,
  years: string,
  snippet: string,
  extra: {
    revisionAction?: "REVISES" | null;
    revisionTargetHint?: string | null;
    statement?: string;
  } = {},
) {
  return {
    category: "WARRANTY" as const,
    statement:
      extra.statement ??
      `The contractor must provide a warranty of ${years} years on all installed systems`,
    actor: "contractor",
    action: "provide warranty",
    object: "installed systems",
    mandatory: true as const,
    mandatorySignal: "must",
    deadline: null,
    quantity: years,
    unit: "years",
    submissionStage: null,
    technicalArea: null,
    revisionAction: extra.revisionAction ?? null,
    revisionTargetHint: extra.revisionTargetHint ?? null,
    sourceDocumentId: documentId,
    pageNumber,
    sourceSnippet: snippet,
    confidence: "HIGH" as const,
  };
}

async function run(): Promise<void> {
  await ok("Addendum 修订 → ORIGINAL 被 SUPERSEDED，补遗为 MODIFIED", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "The contractor must provide a warranty of 5 years on all installed systems.",
    });
    const add = doc("d_add", "ADDENDUM", {
      1: "Addendum 1: warranty requirement is revised to 3 years on all installed systems.",
    });
    const invoker = scriptedInvoker({
      extract: (prompt) => {
        if (prompt.includes("documentId d_base")) {
          return { requirements: [warrantyReq("d_base", 1, "5", "warranty of 5 years on all installed systems")] };
        }
        return {
          requirements: [
            warrantyReq(
              "d_add",
              1,
              "3",
              "warranty requirement is revised to 3 years on all installed systems",
              {
                revisionAction: "REVISES",
                revisionTargetHint: "warranty",
                statement: "Warranty requirement is revised to 3 years on all installed systems",
              },
            ),
          ],
        };
      },
    });
    const { result } = await analyzeTender(input(base, add), { invoker });
    const baseReq = result.requirements.find((r) => r.quantity === "5")!;
    const addReq = result.requirements.find((r) => r.quantity === "3")!;
    assert.equal(baseReq.addendumDisposition, "SUPERSEDED");
    assert.equal(addReq.addendumDisposition, "MODIFIED");
    assert.equal(addReq.status, "ACTIVE");
  });

  await ok("仅主标、无补遗 → ORIGINAL", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "The bidder must submit two copies of the technical proposal.",
    });
    const { result } = await analyzeTender(input(base), {
      invoker: scriptedInvoker({
        extract: () => ({
          requirements: [
            {
              category: "SUBMISSION",
              statement: "The bidder must submit two copies of the technical proposal",
              actor: "bidder",
              action: "submit",
              object: "proposal",
              mandatory: true,
              mandatorySignal: "must",
              deadline: null,
              quantity: "two",
              unit: "copies",
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: "d_base",
              pageNumber: 1,
              sourceSnippet: "The bidder must submit two copies of the technical proposal.",
              confidence: "HIGH",
            },
          ],
        }),
      }),
    });
    assert.equal(result.requirements[0]!.addendumDisposition, "ORIGINAL");
  });

  await ok("后发布 Addendum 2 覆盖 Addendum 1", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "Section 7: The contractor must provide a warranty of 5 years on all installed systems.",
    });
    const add1 = doc("d_add1", "ADDENDUM", {
      1: "Addendum 1: Section 7 warranty duration is hereby revised to 4 years.",
    });
    const add2 = doc("d_add2", "ADDENDUM", {
      1: "Addendum 2 hereby deletes the four-year term and substitutes a 3-year warranty in Section 7.",
    });
    const { result } = await analyzeTender(input(base, add1, add2), {
      invoker: scriptedInvoker({
        extract: (prompt) => {
          if (prompt.includes("documentId d_base")) {
            return {
              requirements: [
                warrantyReq(
                  "d_base",
                  1,
                  "5",
                  "The contractor must provide a warranty of 5 years on all installed systems.",
                  {
                    statement:
                      "Section 7 requires the contractor to provide a warranty of 5 years on all installed systems",
                  },
                ),
              ],
            };
          }
          if (prompt.includes("documentId d_add1")) {
            return {
              requirements: [
                warrantyReq(
                  "d_add1",
                  1,
                  "4",
                  "Section 7 warranty duration is hereby revised to 4 years.",
                  {
                    revisionAction: "REVISES",
                    revisionTargetHint: "Section 7",
                    statement:
                      "Addendum 1 sets the Section 7 warranty duration at 4 years",
                  },
                ),
              ],
            };
          }
          return {
            requirements: [
              warrantyReq(
                "d_add2",
                1,
                "3",
                "deletes the four-year term and substitutes a 3-year warranty in Section 7.",
                {
                  revisionAction: "REVISES",
                  revisionTargetHint: "Section 7",
                  statement:
                    "Addendum 2 substitutes a 3-year warranty in Section 7",
                },
              ),
            ],
          };
        },
      }),
    });
    const r5 = result.requirements.find((r) => r.quantity === "5")!;
    const r4 = result.requirements.find((r) => r.quantity === "4")!;
    const r3 = result.requirements.find((r) => r.quantity === "3")!;
    assert.equal(r5.status, "SUPERSEDED");
    assert.equal(r4.status, "SUPERSEDED");
    assert.equal(r3.status, "ACTIVE");
    assert.equal(r3.addendumDisposition, "MODIFIED");
    assert.ok(result.addendumChanges.length >= 2);
  });

  await ok("补遗新增、主标无对应项 → NEW", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "The bidder must submit two copies of the technical proposal.",
    });
    const add = doc("d_add", "ADDENDUM", {
      1: "Addendum 1: bidders must attend a mandatory site visit on June 1.",
    });
    const { result } = await analyzeTender(input(base, add), {
      invoker: scriptedInvoker({
        extract: (prompt) => {
          if (prompt.includes("documentId d_base")) {
            return {
              requirements: [
                {
                  category: "SUBMISSION",
                  statement: "The bidder must submit two copies of the technical proposal",
                  actor: "bidder",
                  action: "submit",
                  object: "proposal",
                  mandatory: true,
                  mandatorySignal: "must",
                  deadline: null,
                  quantity: "two",
                  unit: "copies",
                  submissionStage: null,
                  technicalArea: null,
                  revisionAction: null,
                  revisionTargetHint: null,
                  sourceDocumentId: "d_base",
                  pageNumber: 1,
                  sourceSnippet: "The bidder must submit two copies of the technical proposal.",
                  confidence: "HIGH",
                },
              ],
            };
          }
          return {
            requirements: [
              {
                category: "SITE_VISIT",
                statement: "Bidders must attend a mandatory site visit on June 1",
                actor: "bidder",
                action: "attend",
                object: "site visit",
                mandatory: true,
                mandatorySignal: "must",
                deadline: "June 1",
                quantity: null,
                unit: null,
                submissionStage: "pre-award",
                technicalArea: null,
                revisionAction: null,
                revisionTargetHint: null,
                sourceDocumentId: "d_add",
                pageNumber: 1,
                sourceSnippet: "bidders must attend a mandatory site visit on June 1.",
                confidence: "HIGH",
              },
            ],
          };
        },
      }),
    });
    const visit = result.requirements.find((r) => r.category === "SITE_VISIT")!;
    const sub = result.requirements.find((r) => r.category === "SUBMISSION")!;
    assert.equal(visit.addendumDisposition, "NEW");
    assert.equal(sub.addendumDisposition, "UNCHANGED");
  });

  await ok("fallback 标记进入 limitations，不得假装 GPT-6", () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "The bidder must submit two copies of the technical proposal.",
    });
    const inp = input(base);
    const grounded = deriveGroundedState(inp, {
      facts: [],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    const result = assembleAnalysisResult({
      input: inp,
      manifest: buildDocumentManifest(inp),
      grounded,
      clarifications: [],
      resolvedAmbiguities: [],
      logs: [
        {
          promptName: "tender-understanding-v2-extract",
          promptVersion: "tender-understanding-v2-extract@6",
          model: "gpt-5.6-sol",
          elapsedMs: 10,
          inputChars: 10,
          outputChars: 10,
          ok: true,
          errorCode: null,
          fallbackUsed: true,
          requestedModel: "gpt-6-astra",
        },
      ],
      failedWindows: [],
      windowCount: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    assert.equal(result.metadata.analyzedWithFallbackModel, true);
    assert.ok(
      result.limitations.some((l) => l.includes(ANALYZED_WITH_FALLBACK_MODEL)),
    );
    assert.equal(result.metadata.modelFamily, "gpt-6-astra");
  });

  console.log(`\nAddendum disposition: ${count()} 组断言全部通过`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
