/**
 * 入队门闸建议 + 幂等/抢占纯函数
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-helpers.test.ts
 */

import { fingerprintOrderedHashes, sha256Content } from "../hash";
import { buildIdempotencyKey } from "../idempotency";
import { ANALYSIS_VERSION, PROMPT_VERSION } from "../constants";
import { canAutoEnqueueAnalysis } from "../gate";
import {
  detectDocumentRole,
  detectRunKind,
  isPdfFileType,
  looksLikeTenderFilename,
  shouldSupersedeActiveRun,
  suggestionWhenGateClosed,
} from "../enqueue-helpers";

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

console.log("tender-auto-analysis enqueue-helpers");

ok(looksLikeTenderFilename("UNOPS RFP-2024.pdf"), "RFP 文件名像招标");
ok(looksLikeTenderFilename("tender-package.zip"), "tender 文件名像招标");
ok(looksLikeTenderFilename("Bid Document.docx"), "bid 文件名像招标");
ok(!looksLikeTenderFilename("meeting-notes.docx"), "普通文件名不像招标");
ok(isPdfFileType("pdf"), "pdf 扩展名");
ok(isPdfFileType("application/pdf"), "pdf mime");
ok(!isPdfFileType("docx"), "docx 非 pdf");

{
  const gate = canAutoEnqueueAnalysis({
    workDomain: "general",
    hasIntelligenceRoom: false,
  });
  ok(!gate.ok, "门闸关闭");
  const hint = suggestionWhenGateClosed({
    title: "RFP-100.pdf",
    fileType: "pdf",
  });
  ok(hint.suggestion === "mark_as_tender", "门闸关闭+像招标 → mark_as_tender");
  const hintPdf = suggestionWhenGateClosed({
    title: "random.pdf",
    fileType: "pdf",
  });
  ok(hintPdf.suggestion === "mark_as_tender", "门闸关闭+PDF → mark_as_tender");
  const hintNo = suggestionWhenGateClosed({
    title: "notes.docx",
    fileType: "docx",
  });
  ok(!hintNo.suggestion, "门闸关闭+非招标非 PDF → 无 suggestion");
}

ok(detectDocumentRole("Addendum 1") === "ADDENDUM", "addendum 角色");
ok(detectDocumentRole("Main RFP") === "PRIMARY", "主文件 PRIMARY");
ok(detectRunKind("ADDENDUM") === "INCREMENTAL", "ADDENDUM → INCREMENTAL");
ok(detectRunKind("PRIMARY") === "FULL", "PRIMARY → FULL");

{
  const h1 = sha256Content("doc-a");
  const h2 = sha256Content("doc-b");
  const fp1 = fingerprintOrderedHashes([h1]);
  const fp2 = fingerprintOrderedHashes([h2]);
  ok(fp1 !== fp2, "不同内容不同指纹");

  const key1 = buildIdempotencyKey({
    projectId: "p1",
    fingerprint: fp1,
    promptVersion: PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
  });
  const key1b = buildIdempotencyKey({
    projectId: "p1",
    fingerprint: fp1,
    promptVersion: PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
  });
  ok(key1 === key1b, "相同源文档指纹 → 相同幂等键");

  ok(
    shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp2,
      existingStatus: "PENDING",
    }),
    "新 hash + PENDING → SUPERSEDE",
  );
  ok(
    shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp2,
      existingStatus: "EXTRACTING",
    }),
    "新 hash + EXTRACTING → SUPERSEDE",
  );
  ok(
    shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp2,
      existingStatus: "ANALYZING",
    }),
    "新 hash + ANALYZING → SUPERSEDE",
  );
  ok(
    !shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp1,
      existingStatus: "PENDING",
    }),
    "相同指纹不 SUPERSEDE",
  );
  ok(
    !shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp2,
      existingStatus: "APPROVED",
    }),
    "APPROVED 不 SUPERSEDE",
  );
  ok(
    !shouldSupersedeActiveRun({
      existingFingerprint: fp1,
      newFingerprint: fp2,
      existingStatus: "REVIEW_REQUIRED",
    }),
    "REVIEW_REQUIRED 不 SUPERSEDE",
  );
}

console.log(`\nenqueue-helpers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
