/**
 * CASE A0 — RCMP 合成 fixture（过拟合对照组，CI 恒可跑）
 *
 * 文档 = committed 合成 15 页 fixture（rcmp-backpack-pages.ts，抽取规则即按它手写）。
 * 本 case 的作用不是测能力，而是：
 * 1. 固定「管线在其自身构建目标文档上的表现」——此处的任何回归都是代码级问题；
 * 2. 与 CASE A-REAL 的分差 = 过拟合幅度的直接度量。
 *
 * Golden 来源：逐行阅读 fixture 页文本（fixture 本身即本 case 的"文档真相"）。
 * 注意：fixture 的 M 条款正文与真实 PDF 不一致（如 M3 35L vs 真实 37–55L）——
 * 该差异在 CASE A-REAL 的 golden notes 中登记。
 */

import { buildRcmpBackpackFixturePages, FIXTURE_DOC_ID } from "@/lib/tender-auto-analysis/__tests__/fixtures/rcmp-backpack-pages";

import type { CaseModule, TenderEvalCase } from "../contract";

const DOC = FIXTURE_DOC_ID;

export const caseA0RcmpFixture: CaseModule = {
  caseId: "case-a0-rcmp-fixture",
  load: async (): Promise<TenderEvalCase> => ({
    contractVersion: "tender-eval/v1",
    caseId: "case-a0-rcmp-fixture",
    title: "RCMP RISO 合成 fixture（过拟合对照）",
    projectType: "goods-standing-offer",
    provenance: {
      kind: "SYNTHETIC",
      source:
        "src/lib/tender-auto-analysis/__tests__/fixtures/rcmp-backpack-pages.ts（真实招标的人工转写节选，页码/正文与原件有出入）",
      redaction: "EXCERPTED",
      goldenAnswerMethod: "PENDING_HUMAN_CONFIRMATION",
      confirmedBy: null,
      confirmedAt: null,
    },
    documentSet: [
      {
        documentId: DOC,
        role: "MAIN",
        title: "RCMP fixture pages (15)",
        pages: buildRcmpBackpackFixturePages(),
      },
    ],
    goldenFacts: [
      {
        factId: "F0-NUMBER",
        field: "tender_number",
        description: "招标编号 M5000-25-3574-A",
        expected: { kind: "text", value: "m5000-25-3574-a" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [1],
            sourceQuote: "Solicitation No. – Nº de l'invitation M5000-25-3574-A",
          },
        ],
        matchAnchors: [["m5000"]],
      },
      {
        factId: "F0-BUYER",
        field: "buyer",
        description: "采购单位 RCMP",
        expected: {
          kind: "text",
          value: "royal canadian mounted police",
          aliases: ["rcmp"],
        },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [1],
            sourceQuote: "Offer to: Royal Canadian Mounted Police (RCMP)",
          },
        ],
        matchAnchors: [["rcmp"]],
      },
      {
        factId: "F0-TITLE",
        field: "tender_title",
        description: "Backpacks for Cadets",
        expected: { kind: "text", value: "backpacks for cadets" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [1],
            sourceQuote: "Title – Sujet Backpacks for Cadets",
          },
        ],
        matchAnchors: [["backpacks for cadets"], ["cadets"]],
      },
      {
        factId: "F0-ISSUE",
        field: "issue_date",
        description: "发布日 2026-07-29",
        expected: { kind: "date", value: "2026-07-29" },
        critical: true,
        evidence: [
          { documentId: DOC, pageNumbers: [1], sourceQuote: "Date July 29, 2026" },
        ],
        matchAnchors: [["issue_date"], ["发布日"], ["july 29"]],
      },
      {
        factId: "F0-CLOSING",
        field: "closing_datetime",
        description: "截标 2026-08-18 14:00 MDT",
        expected: { kind: "datetime", date: "2026-08-18", time: "14:00", tz: "MDT" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [1],
            sourceQuote:
              "Solicitation Closes – L'invitation prend fin At /à : 14 :00 MDT (Mountain Daylight Time) On / le : August 18, 2026",
          },
        ],
        matchAnchors: [["closing"], ["截标"]],
      },
      {
        factId: "F0-ENQUIRY",
        field: "enquiry_deadline",
        description: "询价截止（closing−5）= 2026-08-13",
        expected: { kind: "date", value: "2026-08-13" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [23],
            sourceQuote: "enquiries must be submitted five calendar days before closing.",
          },
        ],
        matchAnchors: [["enquiry"], ["询价"]],
      },
      {
        factId: "F0-PERIOD",
        field: "contract_period",
        description: "主合同期 2026-10-02 至 2029-10-01",
        expected: { kind: "text", value: "october 2, 2026 to october 1, 2029" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [4, 23],
            sourceQuote:
              "The period of the Standing Offer is from October 2, 2026 to October 1, 2029",
          },
        ],
        matchAnchors: [["合同期"], ["standing offer", "october"]],
      },
      {
        factId: "F0-VALIDITY",
        field: "offer_validity",
        description: "报价有效期 90 天",
        expected: { kind: "duration", days: 90 },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [6],
            sourceQuote:
              "Offers will remain open for acceptance for a period of 90 days from the closing date.",
          },
        ],
        matchAnchors: [["90 days"], ["有效期"]],
      },
      {
        factId: "F0-3PDF",
        field: "submittal_requirements",
        description: "三份独立 PDF（Technical/Financial/Certifications）",
        expected: {
          kind: "text",
          value: "technical offer",
          aliases: ["section i: technical offer"],
        },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [8],
            sourceQuote:
              "Section I: Technical Offer (one soft copy in PDF format) Section II: Financial Offer…",
          },
        ],
        matchAnchors: [["三份"], ["technical offer"]],
      },
      {
        factId: "F0-5MB",
        field: "submittal_requirements",
        description: "邮件 ≤5MB、禁 ZIP/链接",
        expected: { kind: "text", value: "5mb", aliases: ["5 mb"] },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [8],
            sourceQuote: "Incoming e-mail messages must not exceed 5MB.",
          },
        ],
        matchAnchors: [["5mb"], ["5 mb"]],
      },
      {
        factId: "F0-PRICE-ONLY",
        field: "pricing_instructions",
        description: "价格只出现在 Financial Offer",
        expected: {
          kind: "text",
          value: "prices must appear in the financial offer",
          aliases: ["价格仅可出现"],
        },
        critical: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [8],
            sourceQuote: "Prices must appear in the financial offer only.",
          },
        ],
        matchAnchors: [["prices must appear"], ["价格仅可"]],
      },
      {
        factId: "F0-EVAL",
        field: "evaluation_method",
        description: "满足全部强制准则后最低评估价",
        expected: {
          kind: "text",
          value: "lowest evaluated price",
          aliases: ["最低评估价"],
        },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [12],
            sourceQuote:
              "The responsive offer with the lowest evaluated price will be recommended for issuance of a standing offer.",
          },
        ],
        matchAnchors: [["lowest evaluated price"], ["最低评估价"]],
      },
      {
        factId: "F0-ELIGIBILITY",
        field: "eligibility",
        description: "Reciprocal Procurement 资格限制",
        expected: {
          kind: "text",
          value: "reciprocal procurement",
          aliases: ["canadian suppliers"],
        },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [17, 2, 4],
            sourceQuote:
              "This solicitation of offers is only open to Canadian Suppliers and to Suppliers of an Applicable Trading Partner",
          },
        ],
        matchAnchors: [["reciprocal"]],
      },
      {
        factId: "F0-DDP",
        field: "delivery",
        description: "DDP Regina Incoterms 2020",
        expected: { kind: "text", value: "ddp", aliases: ["delivered duty paid"] },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [31, 36],
            sourceQuote:
              "Goods must be consigned Delivered Duty Paid (DDP) Regina, Saskatchewan Incoterms 2020",
          },
        ],
        matchAnchors: [["ddp"]],
      },
      {
        factId: "F0-LEAD-30",
        field: "delivery",
        description: "call-up 后 30 天交付（须引 30/34 页，不得引 23 页）",
        expected: { kind: "duration", days: 30 },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [30, 34],
            sourceQuote:
              "Delivery of the goods must be made in accordance with the call-up against the Standing Offer, within 30 days of call-up issuance.",
          },
        ],
        matchAnchors: [["30 days", "call-up"], ["交货期"]],
      },
      {
        factId: "F0-24H",
        field: "delivery",
        description: "24 小时内确认订单",
        expected: { kind: "text", value: "24 hours", aliases: ["24 小时"] },
        critical: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [34],
            sourceQuote: "Confirm the order by email within 24 hours to the Project Authority",
          },
        ],
        matchAnchors: [["24 hours"], ["24 小时"]],
      },
      {
        factId: "F0-ENV",
        field: "compliance",
        description: "环保包装 Mandatory",
        expected: {
          kind: "text",
          value: "environmentally preferable packaging",
          aliases: ["环保包装"],
        },
        critical: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [34, 4],
            sourceQuote: "9. ENVIRONMENTALLY PREFERABLE PACKAGING – MANDATORY",
          },
        ],
        matchAnchors: [["packaging"], ["环保包装"]],
      },
      {
        factId: "F0-FORCED-LABOUR",
        field: "compliance",
        description: "强迫劳动声明要求",
        expected: { kind: "boolean", value: true },
        critical: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [27],
            sourceQuote: "Forced Labour Requirement – Standing Offer 1. Offeror's Statement.",
          },
        ],
        matchAnchors: [["forced labour"], ["强迫劳动"]],
      },
      {
        factId: "F0-NO-SECURITY",
        field: "compliance",
        description: "无安全许可要求",
        expected: { kind: "boolean", value: true },
        critical: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [1, 4],
            sourceQuote: "THIS DOCUMENT DOES NOT CONTAIN A SECURITY REQUIREMENT",
          },
        ],
        matchAnchors: [["security requirement"], ["安全许可"]],
      },
      {
        factId: "F0-QTY-A",
        field: "quantity",
        description: "Annex A: Up to 1500 per contract period",
        expected: { kind: "text", value: "up to 1500 per contract period" },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "Required quantity: Up to 1500 per contract period",
          },
        ],
        matchAnchors: [["up to 1500"]],
      },
      {
        factId: "F0-QTY-ANNUAL",
        field: "quantity",
        description: "Annex B 年度评标量 1500",
        expected: { kind: "quantity", value: 1500, unit: null },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [36, 37],
            sourceQuote: "Standing Offer Year 1: … Each 1500 $ $",
          },
        ],
        matchAnchors: [["annex b", "1500"], ["annual", "1500"], ["评标", "1500"]],
      },
      {
        factId: "F0-QTY-7500",
        field: "quantity",
        description: "评标合计 7500 = 1500×5（解释性，非保证）",
        expected: { kind: "quantity", value: 7500, unit: null },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [36, 37],
            sourceQuote: "五行 Each 1500（3 个 Standing Offer 年 + 2 个 Option 年）",
          },
        ],
        matchAnchors: [["7500"], ["7,500"]],
      },
      {
        factId: "F0-QTY-NO-GUARANTEE",
        field: "quantity",
        description: "估计数量仅评标用，非保证",
        expected: {
          kind: "text",
          value: "does not constitute a guarantee",
          aliases: ["非保证", "不构成保证"],
        },
        critical: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [36],
            sourceQuote:
              "The estimated quantity is provided for evaluation purposes only and does not constitute a guarantee or commitment on behalf of Canada.",
          },
        ],
        matchAnchors: [["guarantee"], ["保证采购"], ["非保证"]],
      },
    ],
    goldenRequirements: [
      {
        goldenId: "R0-M1",
        text: "M1. Minimum capacity of 35 litres with labelled volume marking.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M1. Minimum capacity of 35 litres with labelled volume marking.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["capacity"], ["35 litres"]],
      },
      {
        goldenId: "R0-M2",
        text: "M2. Shell fabric shall be 1000D nylon or equivalent abrasion-resistant material.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M2. Shell fabric shall be 1000D nylon or equivalent abrasion-resistant material.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["1000d"], ["shell fabric"]],
      },
      {
        goldenId: "R0-M3",
        text: "M3. Water resistance: fabric and seams shall resist water penetration under stated test.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M3. Water resistance: fabric and seams shall resist water penetration under stated test.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["water resistance"], ["water penetration"]],
      },
      {
        goldenId: "R0-M4",
        text: "M4. Main zipper shall meet performance standards for strength and durability.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M4. Main zipper shall meet performance standards for strength and durability.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["zipper"]],
      },
      {
        goldenId: "R0-M5",
        text: "M5. Webbing and straps shall meet tensile strength requirements.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M5. Webbing and straps shall meet tensile strength requirements.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["webbing"], ["straps", "tensile"]],
      },
      {
        goldenId: "R0-M6",
        text: "M6. Thread and stitching shall meet specified performance standards.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M6. Thread and stitching shall meet specified performance standards.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["thread"], ["stitching"]],
      },
      {
        goldenId: "R0-M7",
        text: "M7. Dimensions shall be measured using the method described in Annex C.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M7. Dimensions shall be measured using the method described in Annex C.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["dimensions"], ["measured"]],
      },
      {
        goldenId: "R0-M8",
        text: "M8. Colour shall match the specified olive/black reference.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M8. Colour shall match the specified olive/black reference.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["colour"], ["olive"]],
      },
      {
        goldenId: "R0-M9",
        text: "M9. RCMP / Cadets marking or logo placement as specified.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M9. RCMP / Cadets marking or logo placement as specified.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["logo"], ["marking"]],
      },
      {
        goldenId: "R0-M10",
        text: "M10. Padded back panel and shoulder straps required.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M10. Padded back panel and shoulder straps required.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["padded back panel"], ["shoulder straps"]],
      },
      {
        goldenId: "R0-M11",
        text: "M11. External pockets/compartments as per technical drawing.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M11. External pockets/compartments as per technical drawing.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["pockets"], ["compartments"]],
      },
      {
        goldenId: "R0-M12",
        text: "M12. Buckles and fasteners shall be durable and field-replaceable where stated.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M12. Buckles and fasteners shall be durable and field-replaceable where stated.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["buckles"], ["fasteners"]],
      },
      {
        goldenId: "R0-M13",
        text: "M13. Maximum empty weight shall not exceed the specified limit.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M13. Maximum empty weight shall not exceed the specified limit.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["weight"]],
      },
      {
        goldenId: "R0-M14",
        text: "M14. Durability / abrasion performance evidence may be requested.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M14. Durability / abrasion performance evidence may be requested.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["durability"], ["abrasion"]],
      },
      {
        goldenId: "R0-M15",
        text: "M15. Sample may be required; confirm whether sample is required at bid time.",
        category: "mandatory_technical",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M15. Sample may be required; confirm whether sample is required at bid time.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["sample"]],
      },
      {
        goldenId: "R0-GEN-RESPONSIVE",
        text: "Offerors must meet all mandatory technical evaluation criteria to be declared responsive.",
        category: "submission",
        mandatory: true,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [12],
            sourceQuote:
              "Offerors must meet all mandatory technical evaluation criteria to be declared responsive.",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["responsive"], ["mandatory technical evaluation"]],
      },
    ],
    knownAmbiguities: [
      {
        ambiguityId: "AMB0-QTY",
        description:
          "Annex A 合同期上限 1500 vs Annex B 年度评标量 1500（合计 7500）口径歧义",
        expected: "CLARIFICATION_REQUIRED",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33, 36],
            sourceQuote:
              "Up to 1500 per contract period / Standing Offer Year 1..3 + Option Year 1..2 Each 1500",
          },
        ],
        matchAnchors: [["per contract period"], ["up to 1500"], ["数量", "歧义"]],
      },
    ],
    goldenRisks: [
      {
        riskId: "RISK0-QTY",
        severity: "IMPORTANT",
        description: "数量口径歧义 + 无保证采购（7500 只是评估合计）",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [36],
            sourceQuote: "does not constitute a guarantee or commitment",
          },
        ],
        matchAnchors: [["数量", "歧义"], ["非保证"], ["7,500"]],
      },
      {
        riskId: "RISK0-SUBMISSION",
        severity: "CRITICAL",
        description: "三份 PDF + 5MB 邮件上限的技术性废标风险",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [8],
            sourceQuote: "Incoming e-mail messages must not exceed 5MB.",
          },
        ],
        matchAnchors: [["5mb"], ["三份 pdf"]],
      },
      {
        riskId: "RISK0-DELIVERY",
        severity: "IMPORTANT",
        description: "DDP Regina + call-up 30 天交付的履约/物流压力",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [30, 31],
            sourceQuote: "within 30 days of call-up issuance",
          },
        ],
        matchAnchors: [["ddp"], ["履约"], ["30 days", "call-up"]],
      },
      {
        riskId: "RISK0-ELIGIBILITY",
        severity: "CRITICAL",
        description: "Reciprocal Procurement 供应商资格限制（GO/NO-GO 级）",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [17],
            sourceQuote:
              "only open to Canadian Suppliers and to Suppliers of an Applicable Trading Partner",
          },
        ],
        matchAnchors: [["reciprocal"], ["资格"], ["eligib"]],
      },
      {
        riskId: "RISK0-TECH-STANDARDS",
        severity: "IMPORTANT",
        description: "M 条款多处引用未给出的测试标准/附件（水阻、拉链、测量方法）",
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M3. Water resistance: … under stated test.",
          },
        ],
        matchAnchors: [["测试标准"], ["m1–m15"], ["标准不清"], ["样品/测试"]],
      },
    ],
    goldenClarifications: [
      {
        clarId: "CLAR0-CALLUP",
        topic: "call-up 最小/最大/典型数量",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [30],
            sourceQuote: "within 30 days of call-up issuance（未给量级）",
          },
        ],
        matchAnchors: [["call-up", "数量"], ["典型", "数量"]],
      },
      {
        clarId: "CLAR0-QTY-BASIS",
        topic: "Up to 1500 per contract period 的准确含义",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "Required quantity: Up to 1500 per contract period",
          },
        ],
        matchAnchors: [["per contract period"], ["up to 1500"]],
      },
      {
        clarId: "CLAR0-SAMPLE",
        topic: "投标阶段是否必须交样（fixture M15 明示需确认）",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote:
              "M15. Sample may be required; confirm whether sample is required at bid time.",
          },
        ],
        matchAnchors: [["样品"], ["sample"]],
      },
      {
        clarId: "CLAR0-WATER-TEST",
        topic: "防水测试依据的具体标准（M3 stated test 未给出）",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M3. Water resistance: … under stated test.",
          },
        ],
        matchAnchors: [["防水"], ["water resist"]],
      },
      {
        clarId: "CLAR0-OVERSEAS",
        topic: "海外制造与 Reciprocal Procurement 资格衔接",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [17],
            sourceQuote: "only open to Canadian Suppliers…",
          },
        ],
        matchAnchors: [["海外制造"], ["overseas"]],
      },
      {
        clarId: "CLAR0-1000D",
        topic: "1000D 面料适用范围（M2 equivalent 判定口径）",
        necessity: "USEFUL",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M2. Shell fabric shall be 1000D nylon or equivalent…",
          },
        ],
        matchAnchors: [["1000d"]],
      },
      {
        clarId: "CLAR0-MEASURE",
        topic: "尺寸测量方法（M7 引用的 Annex C 不在包内）",
        necessity: "USEFUL",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M7. Dimensions shall be measured using the method described in Annex C.",
          },
        ],
        matchAnchors: [["测量"], ["measure"]],
      },
      {
        clarId: "CLAR0-ZIPPER",
        topic: "拉链/织带/缝线性能标准（M4–M6 标准号未给）",
        necessity: "USEFUL",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [33],
            sourceQuote: "M4. Main zipper shall meet performance standards…",
          },
        ],
        matchAnchors: [["拉链"], ["zipper"]],
      },
      {
        clarId: "CLAR0-7500",
        topic: "7500 仅评标用的书面确认",
        necessity: "USEFUL",
        answeredInDocument: false,
        evidence: [
          {
            documentId: DOC,
            pageNumbers: [36],
            sourceQuote: "estimated quantity is provided for evaluation purposes only",
          },
        ],
        matchAnchors: [["7,500"], ["7500"]],
      },
    ],
    expectedUnknowns: [
      {
        field: "warranty",
        description: "fixture 无质保条款",
        forbiddenClaimAnchors: [["warranty"], ["质保"]],
      },
      {
        field: "bid_bond",
        description: "fixture 无投标保证金要求",
        forbiddenClaimAnchors: [["bid bond"], ["投标保证金"]],
      },
      {
        field: "budget",
        description: "无预算披露",
        forbiddenClaimAnchors: [["预算为"], ["budget is"]],
      },
    ],
    hallucinationProbes: [],
    notes:
      "过拟合对照组：管线规则按本 fixture 手写，本 case 得分应接近满分；与 CASE A-REAL 的分差即过拟合幅度。",
  }),
};
