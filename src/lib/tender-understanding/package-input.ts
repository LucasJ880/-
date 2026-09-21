/**
 * Tender 输入完整性层（纯函数，无 DB / 无 LLM）
 *
 * Project Documents → 完整清单 → 角色分类 → 招标包 Manifest
 * → 全文分块覆盖 → 完整性门。
 *
 * 禁止：前 8 份文件 / 窄关键词 / 静默 100k 截断 作为证据可用性依据。
 */

import type {
  AnalysisResultV2,
  AnalyzerDocument,
  AnalyzerInput,
  AnalyzerPage,
  DocumentSourceRole,
} from "./contract";
import { buildSectionWindows } from "./manifest";

export const TENDER_PACKAGE_INCOMPLETE = "TENDER_PACKAGE_INCOMPLETE" as const;
export const TENDER_PACKAGE_COMPLETE = "TENDER_PACKAGE_COMPLETE" as const;
export type TenderPackageCompletenessStatus =
  | typeof TENDER_PACKAGE_COMPLETE
  | typeof TENDER_PACKAGE_INCOMPLETE;

export const INCOMPLETE_COMPLIANCE_NOTICE =
  "完整合规审查尚不能保证。招标包输入不完整或存在未分析的相关证据，不得将本结果视为 COMPLETE。";

export const INVENTORY_PAGE_SIZE = 100;
export const PAGE_ROW_BATCH_SIZE = 500;
/** 无页级解析时，按字符切成可引用单元（覆盖全文，不是 content.slice(0, N)） */
export const PLAIN_TEXT_UNIT_CHARS = 3_500;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

const ANALYZABLE_TYPES = new Set([
  "pdf",
  "application/pdf",
  "docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "xls",
  "application/vnd.ms-excel",
  "csv",
  "text/csv",
  "txt",
  "text/plain",
]);

export const TENDER_PACKAGE_ROLES = [
  "RFP",
  "RFQ",
  "ITT",
  "SOW",
  "SPECIFICATION",
  "APPENDIX",
  "SCHEDULE",
  "PRICING_FORM",
  "BID_FORM",
  "FORM",
  "TERMS_AND_CONDITIONS",
  "GENERAL_CONDITIONS",
  "SUPPLEMENTARY_CONDITIONS",
  "DRAWING",
  "ADDENDUM",
  "AMENDMENT",
  "QA",
  "SUBMISSION_FORM",
  "MANDATORY_FORM",
  "CERTIFICATION",
  "INSURANCE_FORM",
  "BOND_FORM",
  "REFERENCE_FORM",
  "TECHNICAL_SCHEDULE",
  "COMMERCIAL_SCHEDULE",
  "OTHER_TENDER_EVIDENCE",
  "NON_TENDER",
] as const;
export type TenderPackageRole = (typeof TENDER_PACKAGE_ROLES)[number];

export type AddendumManifestStatus =
  | "NONE"
  | "ADDENDUM"
  | "AMENDMENT"
  | "SUSPECTED_ADDENDUM";

export type ExclusionReasonCode =
  | "PARSE_PENDING"
  | "PARSE_FAILED"
  | "EMPTY_TEXT"
  | "UNSUPPORTED_FILE_TYPE"
  | "SYSTEM_GENERATED"
  | "NON_TENDER"
  | "PARTIAL_PAGE_SET"
  | "CONTENT_SHORTER_THAN_PAGE_COUNT"
  | "WINDOW_EXTRACTION_FAILED";

export type InventoryDocument = {
  documentId: string;
  title: string;
  fileType: string;
  parseStatus: string;
  characterCount: number;
  pageCount: number | null;
  sortOrder: number;
  createdAt: Date;
  source: string;
  contentHash: string | null;
  pages: AnalyzerPage[];
  contentText: string | null;
};

export type TenderPackageManifestEntry = {
  documentId: string;
  title: string;
  documentRole: TenderPackageRole;
  sourceRole: DocumentSourceRole;
  parseStatus: string;
  characterCount: number;
  tokenEstimate: number;
  addendumStatus: AddendumManifestStatus;
  sourceOrder: number;
  includedForAnalysis: boolean;
  exclusionReason: ExclusionReasonCode | null;
  analysisStatus: "INCLUDED" | "EXCLUDED" | "PARTIALLY_READ";
};

export type EvidenceChunk = {
  documentId: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  sourceLocator: string;
  analysisStatus: "INDEXED" | "FAILED";
  characterCount: number;
};

export type TenderPackageCounts = {
  TOTAL_DOCUMENTS: number;
  TENDER_RELEVANT_DOCUMENTS: number;
  DOCUMENTS_ANALYZED: number;
  DOCUMENTS_EXCLUDED: number;
  DOCUMENTS_PARTIALLY_READ: number;
};

export type CompletenessGate = {
  status: TenderPackageCompletenessStatus;
  packageCoverage: number;
  mandatoryEvidenceCoverage: number;
  addendumCoverage: number;
  counts: TenderPackageCounts;
  reasons: string[];
};

export type TenderPackage = {
  projectId: string;
  inventory: InventoryDocument[];
  manifest: TenderPackageManifestEntry[];
  chunks: EvidenceChunk[];
  includedDocuments: AnalyzerDocument[];
  completeness: CompletenessGate;
};

type RoleRule = {
  role: TenderPackageRole;
  title: RegExp;
  content?: RegExp;
};

const ROLE_RULES: RoleRule[] = [
  {
    role: "ADDENDUM",
    title: /\baddendum\b|\baddenda\b|补遗|澄清公告/i,
    content: /\baddendum\s*(no\.?|#|number)?\s*\d+\b|\baddenda\b|本补遗|补遗第/i,
  },
  {
    role: "AMENDMENT",
    title: /\bamendments?\b|修订公告|变更公告/i,
    content: /\bamendment\s*(no\.?|#|number)?\s*\d+\b/i,
  },
  { role: "DRAWING", title: /\bdrawings?\b|图纸|图集/i },
  {
    role: "BOND_FORM",
    title: /\bbid\s*bond\b|\bperformance\s*bond\b|\bbond\s*form\b|保函|投标保证金/i,
  },
  {
    role: "INSURANCE_FORM",
    title: /\binsurance\s*form\b|\bcertificate\s+of\s+insurance\b|保险(?:表格|证明)/i,
  },
  {
    role: "CERTIFICATION",
    title: /\bcertifications?\b|\bcertificate\s+form\b|认证表格|合格声明/i,
  },
  {
    role: "REFERENCE_FORM",
    title: /\breference\s*form\b|\breferences?\s+form\b|业绩表格|推荐表格/i,
  },
  {
    role: "MANDATORY_FORM",
    title: /\bmandatory\s*form\b|强制表格|必备表格/i,
  },
  {
    role: "BID_FORM",
    title: /\bbid\s*form\b|\boffer\s*form\b|投标函|投标表格/i,
  },
  {
    role: "PRICING_FORM",
    title: /\bpricing\s*form\b|\bprice\s*form\b|\bbid\s*price\b|报价表|价格表/i,
    content: /\bunit\s*price\b|\bextended\s*price\b|单价|合价/i,
  },
  {
    role: "COMMERCIAL_SCHEDULE",
    title: /\bcommercial\s+schedule\b|商务附表/i,
  },
  {
    role: "TECHNICAL_SCHEDULE",
    title: /\btechnical\s+schedule\b|技术附表/i,
  },
  {
    role: "SUBMISSION_FORM",
    title: /\bsubmission\s*form\b|递交表格|投标文件格式/i,
  },
  {
    role: "SOW",
    title: /\bstatement\s+of\s+work\b|\bsow\b|工作说明书/i,
  },
  {
    role: "SPECIFICATION",
    title: /\bspecifications?\b|\btech(?:nical)?\s+spec\b|技术规格|规格书/i,
  },
  { role: "APPENDIX", title: /\bappendix\b|\bannex\b|附件|附录(?!补遗)/i },
  {
    role: "SCHEDULE",
    title: /\bschedule\s*[a-z0-9]+\b|\bschedule\s+of\b|附表/i,
  },
  {
    role: "SUPPLEMENTARY_CONDITIONS",
    title: /\bsupplementary\s+conditions?\b|补充条件/i,
  },
  {
    role: "GENERAL_CONDITIONS",
    title: /\bgeneral\s+conditions?\b|通用条款|总则/i,
  },
  {
    role: "TERMS_AND_CONDITIONS",
    title: /\bterms\s*(and|&)\s*conditions\b|\bterms\s+of\s+contract\b|条款(?:与)?条件/i,
    content: /\bgeneral\s+conditions\b|\bterms\s+and\s+conditions\b/i,
  },
  {
    role: "QA",
    title: /\bq\s*&\s*a\b|\bquestions?\s+and\s+answers?\b|问答|澄清回复/i,
  },
  {
    role: "ITT",
    title: /\binvitation\s+to\s+tender\b|\binvitation\s+to\s+bid\b|\bitt\b|\bitb\b|招标邀请/i,
  },
  {
    role: "RFQ",
    title: /\brequest\s+for\s+quot(?:e|ation)\b|\brfq\b|询价/i,
  },
  {
    role: "RFP",
    title: /\brequest\s+for\s+proposal\b|\brfp\b|招标文件|征求建议/i,
  },
  {
    role: "FORM",
    title: /\bform\s*[a-c]\b|\bform\s+\d+\b|表格[甲乙丙ABC]/i,
  },
];

const PROCUREMENT_CONTENT_RE =
  /\b(rfp|rfq|itt|itb|solicitation|invitation\s+to\s+tender|request\s+for\s+proposal|addendum|amendment|statement\s+of\s+work|mandatory|closing\s+date|bid\s+bond|bid\s+form|pricing\s+form)\b|招标|投标|询价|标书|补遗/i;

const MANDATORY_SIGNAL_RE =
  /\b(must|shall|mandatory|required\s+to)\b|必须|应当/;

const SYSTEM_SOURCES = new Set(["ai_checklist"]);

export function estimateTokens(characterCount: number): number {
  return Math.ceil(Math.max(0, characterCount) / CHARS_PER_TOKEN_ESTIMATE);
}

export function isAnalyzableTenderFileType(fileType: string): boolean {
  const t = (fileType ?? "").trim().toLowerCase().replace(/^\./, "");
  return ANALYZABLE_TYPES.has(t);
}

function haystack(title: string, content: string | null | undefined): {
  title: string;
  content: string;
} {
  return { title: title ?? "", content: content ?? "" };
}

function looksLikeAddendumBody(title: string, content: string): boolean {
  if (/\bappendix\b|附件|附录/i.test(title) && !/\baddendum\b|\baddenda\b|补遗/i.test(title)) {
    return false;
  }
  return (
    /\baddendum\b|\baddenda\b|补遗/i.test(title) ||
    /\baddendum\s*(no\.?|#|number)?\s*\d+\b|\bthis\s+addendum\b|\baddenda\b|本补遗|补遗第/i.test(
      content,
    )
  );
}

export function classifyTenderPackageRole(
  title: string,
  content?: string | null,
): TenderPackageRole {
  const h = haystack(title, content);
  for (const rule of ROLE_RULES) {
    if (rule.title.test(h.title)) return rule.role;
  }
  if (looksLikeAddendumBody(h.title, h.content)) return "ADDENDUM";
  if (/\bamendment\s*(no\.?|#|number)?\s*\d+\b|\bthis\s+amendment\b/i.test(h.content)) {
    return "AMENDMENT";
  }
  const contentRoles: RoleRule[] = ROLE_RULES.filter((r) =>
    [
      "PRICING_FORM",
      "BID_FORM",
      "MANDATORY_FORM",
      "SUBMISSION_FORM",
      "BOND_FORM",
      "INSURANCE_FORM",
      "CERTIFICATION",
      "REFERENCE_FORM",
      "DRAWING",
      "QA",
      "SOW",
      "SPECIFICATION",
      "GENERAL_CONDITIONS",
      "SUPPLEMENTARY_CONDITIONS",
      "TERMS_AND_CONDITIONS",
    ].includes(r.role),
  );
  for (const rule of contentRoles) {
    if (rule.content?.test(h.content) || rule.title.test(h.content.slice(0, 400))) {
      return rule.role;
    }
  }
  if (PROCUREMENT_CONTENT_RE.test(h.title) || PROCUREMENT_CONTENT_RE.test(h.content)) {
    return "OTHER_TENDER_EVIDENCE";
  }
  const trimmed = h.content.trim();
  if (trimmed.length >= 80) return "OTHER_TENDER_EVIDENCE";
  return "NON_TENDER";
}

export function isAddendumLike(title: string, content?: string | null): boolean {
  const role = classifyTenderPackageRole(title, content);
  return role === "ADDENDUM" || role === "AMENDMENT";
}

export function isTenderRelevantRole(role: TenderPackageRole): boolean {
  return role !== "NON_TENDER";
}

export function mapPackageRoleToSourceRole(
  role: TenderPackageRole,
): DocumentSourceRole {
  switch (role) {
    case "ADDENDUM":
    case "AMENDMENT":
      return "ADDENDUM";
    case "SPECIFICATION":
    case "SOW":
    case "APPENDIX":
    case "SCHEDULE":
    case "TECHNICAL_SCHEDULE":
      return "SPECIFICATION";
    case "DRAWING":
      return "DRAWING";
    case "PRICING_FORM":
    case "COMMERCIAL_SCHEDULE":
      return "PRICING_FORM";
    case "BID_FORM":
    case "MANDATORY_FORM":
    case "CERTIFICATION":
    case "INSURANCE_FORM":
    case "BOND_FORM":
    case "REFERENCE_FORM":
    case "SUBMISSION_FORM":
    case "FORM":
      return "SUBMISSION_FORM";
    case "RFP":
    case "RFQ":
    case "ITT":
      return "BASE_TENDER";
    default:
      return "OTHER";
  }
}

export function addendumStatusOf(
  role: TenderPackageRole,
  title: string,
  content?: string | null,
): AddendumManifestStatus {
  if (role === "ADDENDUM") return "ADDENDUM";
  if (role === "AMENDMENT") return "AMENDMENT";
  const blob = `${title}\n${content ?? ""}`;
  if (/\baddendum\b|\baddenda\b|补遗/i.test(blob) && !/\bappendix\b/i.test(title)) {
    return "SUSPECTED_ADDENDUM";
  }
  return "NONE";
}

/**
 * 把整段文本切成可引用单元。offset 前进覆盖 100% 字符，
 * 不得用 content.slice(0, N) 作为该文档的唯一证据源。
 */
export function pagesFromPlainText(
  content: string,
  maxChars = PLAIN_TEXT_UNIT_CHARS,
): AnalyzerPage[] {
  if (!content) return [];
  const pages: AnalyzerPage[] = [];
  let offset = 0;
  let n = 1;
  while (offset < content.length) {
    let end = Math.min(offset + maxChars, content.length);
    if (end < content.length) {
      const nl = content.lastIndexOf("\n", end);
      if (nl > offset + Math.floor(maxChars / 2)) end = nl + 1;
    }
    pages.push({
      pageNumber: n,
      contentText: content.slice(offset, end),
      unitKind: "block",
      unitLabel: `chars ${offset + 1}–${end}`,
    });
    n += 1;
    offset = end;
  }
  return pages;
}

export function characterCoverage(pages: AnalyzerPage[]): number {
  return pages.reduce((sum, p) => sum + p.contentText.length, 0);
}

export function resolveAnalyzerPages(doc: InventoryDocument): AnalyzerPage[] {
  if (doc.pages.length > 0) {
    return [...doc.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  }
  if (doc.contentText && doc.contentText.length > 0) {
    return pagesFromPlainText(doc.contentText);
  }
  return [];
}

export function buildChunkCoverage(doc: AnalyzerDocument): EvidenceChunk[] {
  return buildSectionWindows(doc).map((w) => {
    const nums = w.pages.map((p) => p.pageNumber);
    const pageStart = nums[0] ?? 1;
    const pageEnd = nums[nums.length - 1] ?? pageStart;
    const locator =
      w.pages
        .map((p) => p.unitLabel)
        .find((l) => !!l) ?? `${doc.documentId} p.${pageStart}-${pageEnd}`;
    return {
      documentId: doc.documentId,
      chunkId: w.windowId,
      pageStart,
      pageEnd,
      sourceLocator: locator,
      analysisStatus: "INDEXED" as const,
      characterCount: w.pages.reduce((a, p) => a + p.contentText.length, 0),
    };
  });
}

export function chunkUnionCoversPages(
  pages: AnalyzerPage[],
  chunks: EvidenceChunk[],
): boolean {
  if (pages.length === 0) return true;
  const covered = new Set<number>();
  for (const c of chunks) {
    for (let p = c.pageStart; p <= c.pageEnd; p++) covered.add(p);
  }
  return pages.every((p) => covered.has(p.pageNumber));
}

export async function paginateUntilComplete<T>(opts: {
  pageSize: number;
  fetchPage: (args: { take: number; skip: number }) => Promise<T[]>;
}): Promise<T[]> {
  const pageSize = opts.pageSize;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer");
  }
  const all: T[] = [];
  let skip = 0;
  for (let i = 0; i < 10_000; i++) {
    const batch = await opts.fetchPage({ take: pageSize, skip });
    all.push(...batch);
    if (batch.length < pageSize) return all;
    skip += pageSize;
  }
  throw new Error("paginateUntilComplete: exceeded safety iteration cap");
}

function sortInventory(docs: InventoryDocument[]): InventoryDocument[] {
  return [...docs].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.documentId.localeCompare(b.documentId);
  });
}

function hasUsableText(doc: InventoryDocument, pages: AnalyzerPage[]): boolean {
  if (pages.some((p) => p.contentText.trim().length > 0)) return true;
  return (doc.contentText ?? "").trim().length > 0;
}

function decideExclusion(input: {
  doc: InventoryDocument;
  role: TenderPackageRole;
  pages: AnalyzerPage[];
}): {
  included: boolean;
  reason: ExclusionReasonCode | null;
  analysisStatus: TenderPackageManifestEntry["analysisStatus"];
} {
  const { doc, role, pages } = input;
  if (SYSTEM_SOURCES.has(doc.source)) {
    return { included: false, reason: "SYSTEM_GENERATED", analysisStatus: "EXCLUDED" };
  }
  if (role === "NON_TENDER") {
    return { included: false, reason: "NON_TENDER", analysisStatus: "EXCLUDED" };
  }
  if (doc.parseStatus === "pending" || doc.parseStatus === "parsing") {
    return { included: false, reason: "PARSE_PENDING", analysisStatus: "EXCLUDED" };
  }
  if (doc.parseStatus === "failed") {
    return { included: false, reason: "PARSE_FAILED", analysisStatus: "EXCLUDED" };
  }
  if (!isAnalyzableTenderFileType(doc.fileType) && !hasUsableText(doc, pages)) {
    return { included: false, reason: "UNSUPPORTED_FILE_TYPE", analysisStatus: "EXCLUDED" };
  }
  if (!hasUsableText(doc, pages)) {
    return { included: false, reason: "EMPTY_TEXT", analysisStatus: "EXCLUDED" };
  }
  if (
    typeof doc.pageCount === "number" &&
    doc.pageCount > 0 &&
    pages.length > 0 &&
    pages.length < doc.pageCount
  ) {
    return { included: true, reason: "PARTIAL_PAGE_SET", analysisStatus: "PARTIALLY_READ" };
  }
  if (
    typeof doc.pageCount === "number" &&
    doc.pageCount >= 20 &&
    characterCoverage(pages) < doc.pageCount * 80
  ) {
    return {
      included: true,
      reason: "CONTENT_SHORTER_THAN_PAGE_COUNT",
      analysisStatus: "PARTIALLY_READ",
    };
  }
  return { included: true, reason: null, analysisStatus: "INCLUDED" };
}

export function buildTenderPackage(input: {
  projectId: string;
  inventory: InventoryDocument[];
  failedWindowDocumentIds?: Iterable<string>;
}): TenderPackage {
  const inventory = sortInventory(input.inventory);
  const failed = new Set(input.failedWindowDocumentIds ?? []);
  const manifest: TenderPackageManifestEntry[] = [];
  const includedDocuments: AnalyzerDocument[] = [];
  const chunks: EvidenceChunk[] = [];

  inventory.forEach((doc, idx) => {
    const joinedContent =
      doc.pages.map((p) => p.contentText).join("\n") || doc.contentText || "";
    const role = classifyTenderPackageRole(doc.title, joinedContent);
    const pages = resolveAnalyzerPages(doc);
    let decision = decideExclusion({ doc, role, pages });
    if (decision.included && failed.has(doc.documentId)) {
      decision = {
        included: true,
        reason: "WINDOW_EXTRACTION_FAILED",
        analysisStatus: "PARTIALLY_READ",
      };
    }
    const sourceRole = mapPackageRoleToSourceRole(role);
    manifest.push({
      documentId: doc.documentId,
      title: doc.title,
      documentRole: role,
      sourceRole,
      parseStatus: doc.parseStatus,
      characterCount: characterCoverage(pages) || doc.characterCount,
      tokenEstimate: estimateTokens(characterCoverage(pages) || doc.characterCount),
      addendumStatus: addendumStatusOf(role, doc.title, joinedContent),
      sourceOrder: idx + 1,
      includedForAnalysis: decision.included,
      exclusionReason: decision.reason,
      analysisStatus: decision.analysisStatus,
    });
    if (!decision.included) return;
    const analyzerDoc: AnalyzerDocument = {
      documentId: doc.documentId,
      name: doc.title,
      type: doc.fileType || "pdf",
      sourceRole,
      pages,
      contentHash: doc.contentHash,
    };
    includedDocuments.push(analyzerDoc);
    chunks.push(...buildChunkCoverage(analyzerDoc));
  });

  const completeness = computeCompletenessGate({
    inventory,
    manifest,
    chunks,
    includedDocuments,
  });

  return {
    projectId: input.projectId,
    inventory,
    manifest,
    chunks,
    includedDocuments,
    completeness,
  };
}

function coverageRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return Math.min(1, numerator / denominator);
}

export function computeCompletenessGate(pkg: {
  inventory: InventoryDocument[];
  manifest: TenderPackageManifestEntry[];
  chunks: EvidenceChunk[];
  includedDocuments: AnalyzerDocument[];
}): CompletenessGate {
  const relevant = pkg.manifest.filter((m) => m.documentRole !== "NON_TENDER");
  const analyzed = pkg.manifest.filter((m) => m.includedForAnalysis);
  const excluded = pkg.manifest.filter((m) => !m.includedForAnalysis);
  const partially = pkg.manifest.filter((m) => m.analysisStatus === "PARTIALLY_READ");
  const addenda = pkg.manifest.filter(
    (m) =>
      m.addendumStatus === "ADDENDUM" ||
      m.addendumStatus === "AMENDMENT" ||
      m.addendumStatus === "SUSPECTED_ADDENDUM",
  );
  const addendaIncluded = addenda.filter((m) => m.includedForAnalysis);

  const reasons: string[] = [];
  const packageCoverage = coverageRatio(analyzed.length, relevant.length);
  if (packageCoverage < 1) {
    reasons.push(
      `相关文档 ${relevant.length} 份中仅 ${analyzed.length} 份纳入分析`,
    );
  }

  let mandatoryHits = 0;
  let mandatoryCovered = 0;
  for (const doc of pkg.includedDocuments) {
    const docChunks = pkg.chunks.filter((c) => c.documentId === doc.documentId);
    if (!chunkUnionCoversPages(doc.pages, docChunks)) {
      reasons.push(`${doc.name} 分块未覆盖全部页/单元`);
    }
    for (const page of doc.pages) {
      if (!MANDATORY_SIGNAL_RE.test(page.contentText)) continue;
      mandatoryHits += 1;
      const inChunk = docChunks.some(
        (c) => page.pageNumber >= c.pageStart && page.pageNumber <= c.pageEnd,
      );
      if (inChunk) mandatoryCovered += 1;
    }
  }
  const mandatoryEvidenceCoverage = coverageRatio(mandatoryCovered, mandatoryHits);
  if (mandatoryEvidenceCoverage < 1) {
    reasons.push("存在强制条款所在页未进入分块");
  }

  const addendumCoverage = coverageRatio(addendaIncluded.length, addenda.length);
  if (addendumCoverage < 1) {
    reasons.push(
      `补遗/修订 ${addenda.length} 份中仅 ${addendaIncluded.length} 份进入分析`,
    );
  }
  if (partially.length > 0) {
    reasons.push(`${partially.length} 份文档为部分读取`);
  }

  const counts: TenderPackageCounts = {
    TOTAL_DOCUMENTS: pkg.manifest.length,
    TENDER_RELEVANT_DOCUMENTS: relevant.length,
    DOCUMENTS_ANALYZED: analyzed.length,
    DOCUMENTS_EXCLUDED: excluded.length,
    DOCUMENTS_PARTIALLY_READ: partially.length,
  };

  const incomplete =
    packageCoverage < 1 ||
    mandatoryEvidenceCoverage < 1 ||
    addendumCoverage < 1 ||
    partially.length > 0;

  return {
    status: incomplete ? TENDER_PACKAGE_INCOMPLETE : TENDER_PACKAGE_COMPLETE,
    packageCoverage,
    mandatoryEvidenceCoverage,
    addendumCoverage,
    counts,
    reasons,
  };
}

export function toAnalyzerInput(projectId: string, pkg: TenderPackage): AnalyzerInput {
  return { projectId, documents: pkg.includedDocuments };
}

export function applyCompletenessToResult(
  result: AnalysisResultV2,
  gate: CompletenessGate,
): AnalysisResultV2 {
  const limitations = [...result.limitations];
  if (gate.status === TENDER_PACKAGE_INCOMPLETE) {
    const notice = `${TENDER_PACKAGE_INCOMPLETE}：${INCOMPLETE_COMPLIANCE_NOTICE}`;
    if (!limitations.some((l) => l.includes(TENDER_PACKAGE_INCOMPLETE))) {
      limitations.unshift(notice);
      if (gate.reasons.length > 0) {
        limitations.splice(1, 0, `完整性原因：${gate.reasons.join("；")}。`);
      }
    }
  }
  return {
    ...result,
    limitations,
    metadata: {
      ...result.metadata,
      packageCompletenessStatus: gate.status,
      packageCoverage: gate.packageCoverage,
      mandatoryEvidenceCoverage: gate.mandatoryEvidenceCoverage,
      addendumCoverage: gate.addendumCoverage,
      totalDocuments: gate.counts.TOTAL_DOCUMENTS,
      tenderRelevantDocuments: gate.counts.TENDER_RELEVANT_DOCUMENTS,
      documentsAnalyzed: gate.counts.DOCUMENTS_ANALYZED,
      documentsExcluded: gate.counts.DOCUMENTS_EXCLUDED,
      documentsPartiallyRead: gate.counts.DOCUMENTS_PARTIALLY_READ,
    },
  };
}

export function formatManifestForPrompt(manifest: TenderPackageManifestEntry[]): string {
  return manifest
    .map((m) => {
      const excl = m.exclusionReason ? ` exclusion=${m.exclusionReason}` : "";
      return [
        `${m.sourceOrder}. ${m.title}`,
        `id=${m.documentId}`,
        `role=${m.documentRole}/${m.sourceRole}`,
        `parse=${m.parseStatus}`,
        `chars=${m.characterCount}`,
        `tokens~${m.tokenEstimate}`,
        `addendum=${m.addendumStatus}`,
        `included=${m.includedForAnalysis}`,
        `status=${m.analysisStatus}${excl}`,
      ].join(" | ");
    })
    .join("\n");
}

export function formatCountsForPrompt(counts: TenderPackageCounts): string {
  return [
    `TOTAL_DOCUMENTS=${counts.TOTAL_DOCUMENTS}`,
    `TENDER_RELEVANT_DOCUMENTS=${counts.TENDER_RELEVANT_DOCUMENTS}`,
    `DOCUMENTS_ANALYZED=${counts.DOCUMENTS_ANALYZED}`,
    `DOCUMENTS_EXCLUDED=${counts.DOCUMENTS_EXCLUDED}`,
    `DOCUMENTS_PARTIALLY_READ=${counts.DOCUMENTS_PARTIALLY_READ}`,
  ].join("\n");
}
