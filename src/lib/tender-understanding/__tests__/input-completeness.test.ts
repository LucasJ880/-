/**
 * Tender 输入完整性门（清单 / 角色 / 分块 / 补遗 / 完整性）
 * 运行：npx tsx src/lib/tender-understanding/__tests__/input-completeness.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import { analyzeTender } from "../analyzer";
import { applyAddendumPrecedence } from "../precedence";
import type { AnalyzerPage } from "../contract";
import {
  buildChunkCoverage,
  buildTenderPackage,
  characterCoverage,
  chunkUnionCoversPages,
  classifyTenderPackageRole,
  INCOMPLETE_COMPLIANCE_NOTICE,
  paginateUntilComplete,
  pagesFromPlainText,
  TENDER_PACKAGE_INCOMPLETE,
  toAnalyzerInput,
  type InventoryDocument,
} from "../package-input";
import { makeOk, scriptedInvoker } from "./helpers";

const { ok, count } = makeOk();

function inv(
  overrides: Partial<InventoryDocument> &
    Pick<InventoryDocument, "documentId" | "title">,
): InventoryDocument {
  const contentText = overrides.contentText ?? "";
  const pages = overrides.pages ?? [];
  return {
    fileType: "pdf",
    parseStatus: "done",
    characterCount: characterCoverage(pages) || contentText.length,
    pageCount: pages.length || overrides.pageCount || null,
    sortOrder: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    source: "upload",
    contentHash: null,
    pages,
    contentText,
    ...overrides,
  };
}

function fillerPage(n: number, extra = ""): AnalyzerPage {
  return {
    pageNumber: n,
    contentText: `Filler material for page ${n}. ${extra}`.repeat(20),
  };
}

async function run(): Promise<void> {
  await ok("分页直到完整：12 条、pageSize=5 → 全部返回", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `d${i + 1}` }));
    let fetches = 0;
    const all = await paginateUntilComplete({
      pageSize: 5,
      fetchPage: async ({ take, skip }) => {
        fetches += 1;
        return items.slice(skip, skip + take);
      },
    });
    assert.equal(all.length, 12);
    assert.equal(fetches, 3);
    assert.deepEqual(
      all.map((x) => x.id),
      items.map((x) => x.id),
    );
  });

  await ok(">8 项目文档 → 全部相关文档进入清单", () => {
    const inventory = Array.from({ length: 12 }, (_, i) =>
      inv({
        documentId: `d${i + 1}`,
        title:
          i === 0
            ? "RFP-2026-100 Main.pdf"
            : i === 8
              ? "Pricing Form.xlsx"
              : i === 9
                ? "Terms and Conditions.pdf"
                : i === 11
                  ? "Document 12.pdf"
                  : `Package File ${i + 1}.pdf`,
        sortOrder: i + 1,
        contentText:
          i === 11
            ? "Addendum 3 revises the closing date to 30 September 2026."
            : `Solicitation package document ${i + 1}. The bidder shall review this file. `.repeat(
                3,
              ),
        fileType: i === 8 ? "xlsx" : "pdf",
      }),
    );
    const pkg = buildTenderPackage({ projectId: "p1", inventory });
    assert.equal(pkg.completeness.counts.TOTAL_DOCUMENTS, 12);
    assert.equal(pkg.manifest.length, 12);
    assert.equal(pkg.includedDocuments.length, 12);
    assert.ok(pkg.manifest.some((m) => m.documentId === "d9"));
    assert.ok(pkg.manifest.some((m) => m.documentId === "d12"));
  });

  await ok("Addendum 是文档 #12 → 仍被发现并纳入", () => {
    const inventory = Array.from({ length: 12 }, (_, i) =>
      inv({
        documentId: `d${i + 1}`,
        title: i === 11 ? "Document 12.pdf" : `File ${i + 1}.pdf`,
        sortOrder: i + 1,
        contentText:
          i === 11
            ? "Addendum 3: this addendum revises insurance limits."
            : `Package part ${i + 1}. The contractor shall comply. `.repeat(4),
      }),
    );
    const pkg = buildTenderPackage({ projectId: "p1", inventory });
    const add = pkg.manifest.find((m) => m.documentId === "d12")!;
    assert.equal(add.documentRole, "ADDENDUM");
    assert.equal(add.sourceRole, "ADDENDUM");
    assert.equal(add.includedForAnalysis, true);
    assert.equal(add.sourceOrder, 12);
  });

  await ok("Pricing Form 无 tender 关键词 → included", () => {
    assert.equal(classifyTenderPackageRole("Pricing Form.xlsx", "Item,Qty,Unit Price"), "PRICING_FORM");
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "price",
          title: "Pricing Form.xlsx",
          fileType: "xlsx",
          contentText: "Item,Qty,Unit Price\nDesk,10,120",
        }),
      ],
    });
    const row = pkg.manifest[0]!;
    assert.equal(row.includedForAnalysis, true);
    assert.equal(row.documentRole, "PRICING_FORM");
    assert.equal(row.exclusionReason, null);
  });

  await ok("Terms & Conditions 泛文件名 → included", () => {
    assert.equal(
      classifyTenderPackageRole("Terms and Conditions.pdf", "These terms apply."),
      "TERMS_AND_CONDITIONS",
    );
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "gc",
          title: "conditions-final.pdf",
          contentText:
            "GENERAL CONDITIONS of Contract. The contractor shall maintain insurance.",
        }),
      ],
    });
    const row = pkg.manifest[0]!;
    assert.equal(row.includedForAnalysis, true);
    assert.ok(
      row.documentRole === "GENERAL_CONDITIONS" ||
        row.documentRole === "TERMS_AND_CONDITIONS" ||
        row.documentRole === "OTHER_TENDER_EVIDENCE",
    );
  });

  await ok("强制要求在约 100 页文档末尾 → 可达", () => {
    const pages = Array.from({ length: 100 }, (_, i) =>
      i === 99
        ? {
            pageNumber: 100,
            contentText:
              "The bidder MUST submit Form A and a bid bond by the closing date.",
          }
        : fillerPage(i + 1),
    );
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "long",
          title: "RFP Volume 1.pdf",
          pages,
          pageCount: 100,
        }),
      ],
    });
    const joined = pkg.includedDocuments[0]!.pages
      .map((p) => p.contentText)
      .join("\n");
    assert.ok(joined.includes("MUST submit Form A"));
    assert.ok(pkg.chunks.some((c) => c.pageEnd === 100 || c.pageStart === 100));
    assert.ok(
      pkg.includedDocuments[0]!.pages.some((p) =>
        p.contentText.includes("MUST submit Form A"),
      ),
    );
    assert.ok(
      chunkUnionCoversPages(pkg.includedDocuments[0]!.pages, pkg.chunks),
    );
  });

  await ok("长文档 → 全文 chunk 覆盖（字符合计 = 原文）", () => {
    const content = `${"Section heading\n"} ${"lorem ipsum dolor sit amet. ".repeat(8000)}`;
    const pages = pagesFromPlainText(content);
    assert.equal(characterCoverage(pages), content.length);
    assert.ok(pages.length > 1);
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "blob",
          title: "Specification.pdf",
          contentText: content,
          pageCount: pages.length,
        }),
      ],
    });
    const doc = pkg.includedDocuments[0]!;
    const chunks = buildChunkCoverage(doc);
    assert.ok(chunks.length >= 1);
    assert.ok(chunkUnionCoversPages(doc.pages, chunks));
    assert.ok(pkg.completeness.mandatoryEvidenceCoverage === 1);
  });

  await ok("多份 Addenda → 全部进入 precedence 输入", async () => {
    const inventory = [
      inv({
        documentId: "d_base",
        title: "RFP.pdf",
        sortOrder: 1,
        pages: [
          {
            pageNumber: 1,
            contentText:
              "The contractor must provide a warranty of 5 years on all installed systems.",
          },
        ],
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        inv({
          documentId: `d_fill_${i + 2}`,
          title: `Schedule ${i + 2}.pdf`,
          sortOrder: i + 2,
          contentText: `Schedule ${i + 2}. The bidder shall complete this schedule. `.repeat(4),
        }),
      ),
      inv({
        documentId: "d_add1",
        title: "Addendum 1.pdf",
        sortOrder: 10,
        pages: [
          {
            pageNumber: 1,
            contentText:
              "Addendum 1: warranty requirement is revised to 4 years on all installed systems.",
          },
        ],
      }),
      inv({
        documentId: "d_add2",
        title: "Addendum 2.pdf",
        sortOrder: 11,
        pages: [
          {
            pageNumber: 1,
            contentText:
              "Addendum 2: the contractor must submit a site safety plan.",
          },
        ],
      }),
      inv({
        documentId: "d_add3",
        title: "Document 12.pdf",
        sortOrder: 12,
        pages: [
          {
            pageNumber: 1,
            contentText:
              "Addendum 3: this addendum revises closing to 1 October 2026.",
          },
        ],
      }),
    ];
    const pkg = buildTenderPackage({ projectId: "p1", inventory });
    const addenda = pkg.includedDocuments.filter((d) => d.sourceRole === "ADDENDUM");
    assert.equal(addenda.length, 3);
    assert.deepEqual(
      addenda.map((d) => d.documentId).sort(),
      ["d_add1", "d_add2", "d_add3"],
    );

    const invoker = scriptedInvoker({
      extract: (prompt) => {
        if (prompt.includes("documentId d_add1")) {
          return {
            requirements: [
              {
                category: "WARRANTY",
                statement:
                  "Warranty requirement is revised to 4 years on all installed systems",
                actor: "contractor",
                action: "provide warranty",
                object: "installed systems",
                mandatory: true,
                mandatorySignal: "revised",
                deadline: null,
                quantity: "4",
                unit: "years",
                submissionStage: null,
                technicalArea: null,
                revisionAction: "REVISES",
                revisionTargetHint: "warranty",
                sourceDocumentId: "d_add1",
                pageNumber: 1,
                sourceSnippet:
                  "warranty requirement is revised to 4 years on all installed systems",
                confidence: "HIGH",
              },
            ],
          };
        }
        if (prompt.includes("documentId d_add2")) {
          return {
            requirements: [
              {
                category: "SAFETY",
                statement: "the contractor must submit a site safety plan",
                actor: "contractor",
                action: "submit",
                object: "site safety plan",
                mandatory: true,
                mandatorySignal: "must",
                deadline: null,
                quantity: null,
                unit: null,
                submissionStage: null,
                technicalArea: null,
                revisionAction: null,
                revisionTargetHint: null,
                sourceDocumentId: "d_add2",
                pageNumber: 1,
                sourceSnippet: "the contractor must submit a site safety plan",
                confidence: "HIGH",
              },
            ],
          };
        }
        if (prompt.includes("documentId d_add3")) {
          return {
            facts: [
              {
                factType: "closing_datetime",
                claim: "closing revised to 1 October 2026",
                rawValue: "1 October 2026",
                sourceDocumentId: "d_add3",
                pageNumber: 1,
                sourceSnippet: "this addendum revises closing to 1 October 2026",
                confidence: "HIGH",
              },
            ],
          };
        }
        return {
          requirements: [
            {
              category: "WARRANTY",
              statement:
                "The contractor must provide a warranty of 5 years on all installed systems",
              actor: "contractor",
              action: "provide warranty",
              object: "installed systems",
              mandatory: true,
              mandatorySignal: "must",
              deadline: null,
              quantity: "5",
              unit: "years",
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: "d_base",
              pageNumber: 1,
              sourceSnippet:
                "The contractor must provide a warranty of 5 years on all installed systems",
              confidence: "HIGH",
            },
          ],
        };
      },
    });
    const { result } = await analyzeTender(toAnalyzerInput("p1", pkg), { invoker });
    const addendumDocIds = new Set(
      result.addendumChanges.map((c) => c.addendumDocumentId),
    );
    assert.ok(addendumDocIds.has("d_add1"), "Addendum 1 进入 precedence");
    assert.ok(
      result.requirements.some((r) =>
        r.evidence.some((e) => e.documentId === "d_add2"),
      ),
      "Addendum 2 要求进入结果",
    );
    assert.ok(
      result.facts.some((f) => f.evidence.some((e) => e.documentId === "d_add3")),
      "Addendum 3 事实进入结果",
    );
    const precedence = applyAddendumPrecedence(toAnalyzerInput("p1", pkg), []);
    assert.ok(Array.isArray(precedence.requirements));
  });

  await ok("排除的文档 → exclusionReason 被记录", () => {
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "rfp",
          title: "RFP.pdf",
          contentText: "Request for Proposal. The bidder shall submit.",
        }),
        inv({
          documentId: "photo",
          title: "site-photo.jpg",
          fileType: "jpg",
          parseStatus: "done",
          contentText: "",
        }),
        inv({
          documentId: "pending",
          title: "Addendum 4.pdf",
          parseStatus: "pending",
          contentText: "",
        }),
      ],
    });
    const photo = pkg.manifest.find((m) => m.documentId === "photo")!;
    const pending = pkg.manifest.find((m) => m.documentId === "pending")!;
    assert.equal(photo.includedForAnalysis, false);
    assert.ok(photo.exclusionReason);
    assert.equal(pending.includedForAnalysis, false);
    assert.equal(pending.exclusionReason, "PARSE_PENDING");
    assert.equal(pending.documentRole, "ADDENDUM");
  });

  await ok("不完整包 → TENDER_PACKAGE_INCOMPLETE", () => {
    const pkg = buildTenderPackage({
      projectId: "p1",
      inventory: [
        inv({
          documentId: "rfp",
          title: "RFP.pdf",
          contentText: "Request for Proposal. The bidder shall submit two copies.",
        }),
        inv({
          documentId: "add",
          title: "Addendum 1.pdf",
          parseStatus: "pending",
          contentText: "",
        }),
      ],
    });
    assert.equal(pkg.completeness.status, TENDER_PACKAGE_INCOMPLETE);
    assert.ok(pkg.completeness.addendumCoverage < 1);
    assert.ok(INCOMPLETE_COMPLIANCE_NOTICE.includes("完整合规审查尚不能保证"));
  });

  await ok("无静默字符截断：全文切块覆盖 250k 字符", () => {
    const content = `Mandatory clause.\n${"word ".repeat(50_000)}`;
    const pages = pagesFromPlainText(content);
    assert.equal(characterCoverage(pages), content.length);
    assert.ok(content.length > 100_000);
    const last = pages[pages.length - 1]!;
    assert.equal(
      pages.reduce((a, p) => a + p.contentText.length, 0),
      content.length,
    );
    assert.ok(last.contentText.length > 0);
  });

  await ok("skill 不再用 take:8 / 100k / 前 2000 字关键词作为证据门", () => {
    const skillPath = path.join(
      process.cwd(),
      "src/lib/agent/skills/tender-analysis.ts",
    );
    const src = fs.readFileSync(skillPath, "utf8");
    assert.equal(/\btake:\s*8\b/.test(src), false);
    assert.equal(src.includes("100_000"), false);
    assert.equal(/slice\(0,\s*Math\.min\(remaining,\s*40_000\)/.test(src), false);
    assert.equal(/content\.slice\(0,\s*2000\)/.test(src), false);
    assert.ok(src.includes("loadTenderPackageInventory"));
    assert.ok(src.includes("TENDER_PACKAGE_INCOMPLETE"));
    assert.ok(src.includes("createTenderCompletion"));
    assert.ok(src.includes("analyzeTender"));
  });
}

run()
  .then(() => {
    console.log(`input-completeness: ${count()} passed`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
