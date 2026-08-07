/**
 * Phase 1.1.1 package fingerprint / role / dedupe 纯函数测试
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/package-fingerprint.test.ts
 */

import {
  computePackageFingerprintFromPairs,
  normalizeRequirementFingerprint,
} from "../hash";
import {
  classifyPackageDocumentRole,
  computePackageFingerprint,
  detectMultiplePrimaryWarning,
  MAX_TENDER_PACKAGE_PAGES,
  packageTooLarge,
  sortPackageDocuments,
} from "../package";
import {
  dedupeRequirementCandidates,
  extractRequirementsFromPages,
} from "../extract/requirements";
import type { PageInput, RequirementCandidate } from "../extract/types";
import { MAX_PDF_PAGES } from "../page-parse";
import { detectRunKind } from "../enqueue-helpers";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis package-fingerprint (Phase 1.1.1)");

{
  const a = { documentId: "docA", contentHash: "hashA" };
  const b = { documentId: "docB", contentHash: "hashB" };
  const c = { documentId: "docC", contentHash: "hashC" };
  const fpAB = computePackageFingerprintFromPairs([a, b]);
  const fpBA = computePackageFingerprintFromPairs([b, a]);
  const fpABC = computePackageFingerprintFromPairs([a, b, c]);
  const fpA = computePackageFingerprintFromPairs([a]);
  ok(fpAB === fpBA, "A+B 与 B+A fingerprint 一致");
  ok(fpAB !== fpABC, "A+B 与 A+B+C fingerprint 不同");
  ok(fpA !== fpAB, "单文档与双文档 fingerprint 不同");
  ok(
    computePackageFingerprint([a, b]) === fpAB,
    "package.computePackageFingerprint 委托一致",
  );
}

ok(MAX_PDF_PAGES === 80, "MAX_PDF_PAGES=80 per document");
ok(MAX_TENDER_PACKAGE_PAGES === 200, "MAX_TENDER_PACKAGE_PAGES=200 per package");
ok(
  packageTooLarge([{ pageCount: 80 }, { pageCount: 80 }, { pageCount: 50 }]),
  "210 页包过大",
);
ok(
  !packageTooLarge([{ pageCount: 80 }, { pageCount: 80 }]),
  "160 页包可接受",
);

ok(classifyPackageDocumentRole("RFP Main.pdf") === "PRIMARY", "RFP → PRIMARY");
ok(
  classifyPackageDocumentRole("Technical Specification.pdf") === "SUPPLEMENT",
  "Spec → SUPPLEMENT",
);
ok(
  classifyPackageDocumentRole("Pricing Form.pdf") === "PRICING",
  "Pricing → PRICING",
);
ok(
  classifyPackageDocumentRole("Addendum 1.pdf") !== "ADDENDUM",
  "文件名 Addendum 不单独决定 ADDENDUM 角色",
);
ok(
  detectRunKind("ADDENDUM") === "FULL",
  "无显式标志时 ADDENDUM 角色仍走 FULL",
);

{
  const warn = detectMultiplePrimaryWarning([
    { role: "PRIMARY" },
    { role: "PRIMARY" },
    { role: "SUPPLEMENT" },
  ]);
  ok(!!warn && warn.includes("PRIMARY"), "两 PRIMARY 共存产生 ambiguity warning");
}

{
  const sorted = sortPackageDocuments([
    {
      documentId: "z",
      contentHash: "h",
      role: "SUPPLEMENT",
      filename: "z",
      createdAt: new Date("2026-01-02"),
      pageCount: 1,
      parseStatus: "done",
    },
    {
      documentId: "a",
      contentHash: "h",
      role: "PRIMARY",
      filename: "a",
      createdAt: new Date("2026-01-03"),
      pageCount: 1,
      parseStatus: "done",
    },
    {
      documentId: "b",
      contentHash: "h",
      role: "PRIMARY",
      filename: "b",
      createdAt: new Date("2026-01-01"),
      pageCount: 1,
      parseStatus: "done",
    },
  ]);
  ok(sorted[0]!.documentId === "b", "排序：PRIMARY 优先且 createdAt 更早在前");
  ok(sorted[1]!.documentId === "a", "排序：同角色按 createdAt");
  ok(sorted[2]!.documentId === "z", "排序：SUPPLEMENT 在后");
}

{
  const pages: PageInput[] = [
    {
      documentId: "rfp",
      pageNumber: 5,
      contentText:
        "M1. The backpack shall have a minimum capacity of 30 litres.\nThe Bidder shall submit three PDFs.",
    },
    {
      documentId: "spec",
      pageNumber: 5,
      contentText:
        "M1. The backpack shall have a minimum capacity of 30 litres.\nThe Contractor must provide OEM certificate.",
    },
    {
      documentId: "spec",
      pageNumber: 2,
      contentText: "M2. Fabric shall be 1000D nylon.",
    },
  ];
  const reqs = extractRequirementsFromPages(pages);
  const m1 = reqs.find((r) => r.requirementCode === "M1");
  ok(!!m1, "抽到 M1");
  ok(
    (m1?.sourceRefs.length ?? 0) >= 2,
    "M1 跨文件合并多个 SourceRefs",
  );
  ok(
    m1!.sourceRefs.some((r) => r.documentId === "rfp" && r.pageNumber === 5) &&
      m1!.sourceRefs.some((r) => r.documentId === "spec" && r.pageNumber === 5),
    "SourceRef 同页码不同 document 可区分",
  );
  ok(
    reqs.filter((r) => r.requirementCode === "M1").length === 1,
    "跨文件同 code Requirement dedupe 为 1",
  );
  ok(
    reqs.some((r) => r.requirementCode.startsWith("GEN-")),
    "通用 shall/must 可抽出 GEN 要求",
  );
}

{
  const conflict: RequirementCandidate[] = [
    {
      requirementCode: "M3",
      category: "mandatory_technical",
      originalRequirement: "Must ship in 10 days",
      chineseTranslation: "10天",
      mandatory: true,
      evidenceRequired: false,
      complianceStatus: "NOT_ASSESSED",
      reviewStatus: "AI_EXTRACTED",
      sourcePage: 1,
      sourceRefs: [
        {
          documentId: "a",
          pageNumber: 1,
          originalTextSnippet: "10 days",
          extractionMethod: "test",
          confidence: "HIGH_CONFIDENCE",
        },
      ],
    },
    {
      requirementCode: "M3",
      category: "mandatory_technical",
      originalRequirement: "Must ship in 30 days",
      chineseTranslation: "30天",
      mandatory: true,
      evidenceRequired: false,
      complianceStatus: "NOT_ASSESSED",
      reviewStatus: "AI_EXTRACTED",
      sourcePage: 2,
      sourceRefs: [
        {
          documentId: "b",
          pageNumber: 2,
          originalTextSnippet: "30 days",
          extractionMethod: "test",
          confidence: "HIGH_CONFIDENCE",
        },
      ],
    },
  ];
  const merged = dedupeRequirementCandidates(conflict);
  ok(merged.length === 1, "冲突要求合并为 1 条");
  ok(
    merged[0]!.complianceStatus === "NEEDS_CLARIFICATION" &&
      merged[0]!.originalRequirement.includes("DOCUMENT_CONFLICT"),
    "冲突不静默覆盖，标记 DOCUMENT_CONFLICT",
  );
}

{
  const fp1 = normalizeRequirementFingerprint("Bidder shall submit Form A");
  const fp2 = normalizeRequirementFingerprint("  bidder   shall submit form a ");
  ok(fp1 === fp2, "requirement 正文指纹归一化一致");
}

console.log(`\npackage-fingerprint: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
