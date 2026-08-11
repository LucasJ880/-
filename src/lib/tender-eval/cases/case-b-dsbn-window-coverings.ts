/**
 * CASE B — DSBN 窗饰供应与安装 RFP（青砚真实业务域：window coverings）
 *
 * 文档来源：repo 已提交的 scripts/intelligence-report-eval/sample-input-01-curtain-tender.json
 * （真实 DSBN 招标的浓缩转写 + Addendum-01 四条 Q&A）。运行时直接读该 JSON，
 * 不复制文本，单一事实源。
 *
 * 本 case 的意义：现有抽取管线从未见过窗饰类标书——这是对「泛化到真实业务域」
 * 的第一次测量。含补遗覆盖考点（Addendum 明确样品投标阶段不需要、保险 $2M、
 * 本地安装非强制、Flameproofing Affidavit 付款前置）。
 *
 * Golden 来源：逐行阅读上述 JSON 文本；PENDING_HUMAN_CONFIRMATION。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PageInput } from "@/lib/tender-auto-analysis/extract/types";

import type { CaseModule, TenderEvalCase } from "../contract";

const MAIN_DOC = "doc_dsbn_rfp_main";
const ADDENDUM_DOC = "doc_dsbn_addendum_01";

type SampleInput = {
  documents: { title: string; contentText: string }[];
};

function loadSamplePages(): { main: PageInput[]; addendum: PageInput[] } {
  const raw = readFileSync(
    join(
      process.cwd(),
      "scripts/intelligence-report-eval/sample-input-01-curtain-tender.json",
    ),
    "utf-8",
  );
  const parsed = JSON.parse(raw) as SampleInput;
  const main = parsed.documents[0]!;
  const addendum = parsed.documents[1]!;
  return {
    main: [{ documentId: MAIN_DOC, pageNumber: 1, contentText: main.contentText }],
    addendum: [
      { documentId: ADDENDUM_DOC, pageNumber: 1, contentText: addendum.contentText },
    ],
  };
}

export const caseBDsbnWindowCoverings: CaseModule = {
  caseId: "case-b-dsbn-window-coverings",
  load: async (): Promise<TenderEvalCase> => {
    const pages = loadSamplePages();
    return {
      contractVersion: "tender-eval/v1",
      caseId: "case-b-dsbn-window-coverings",
      title: "DSBN 窗饰供应与安装 RFP + Addendum-01（业务域泛化）",
      projectType: "window-coverings-supply-install",
      provenance: {
        kind: "NEAR_REAL_RECONSTRUCTED",
        source:
          "scripts/intelligence-report-eval/sample-input-01-curtain-tender.json（真实 DSBN 招标浓缩转写，非完整原件）",
        redaction: "EXCERPTED",
        goldenAnswerMethod: "PENDING_HUMAN_CONFIRMATION",
        confirmedBy: null,
        confirmedAt: null,
      },
      documentSet: [
        {
          documentId: MAIN_DOC,
          role: "MAIN",
          title: "RFP-2024-001 Tender Document",
          pages: pages.main,
        },
        {
          documentId: ADDENDUM_DOC,
          role: "ADDENDUM",
          title: "Addendum-01",
          pages: pages.addendum,
        },
      ],
      goldenFacts: [
        {
          factId: "FB-BUYER",
          field: "buyer",
          description: "采购方 District School Board of Niagara (DSBN)",
          expected: {
            kind: "text",
            value: "district school board of niagara",
            aliases: ["dsbn"],
          },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "The District School Board of Niagara (DSBN) invites proposals from qualified firms",
            },
          ],
          matchAnchors: [["dsbn"], ["niagara"]],
        },
        {
          factId: "FB-CLOSING",
          field: "closing_datetime",
          description: "提交截止 2026-11-30（未给时间/时区/方式）",
          expected: { kind: "date", value: "2026-11-30" },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Submission Deadline: November 30, 2026",
            },
          ],
          matchAnchors: [["submission deadline"], ["截标"], ["closing"], ["november 30"]],
        },
        {
          factId: "FB-TERM",
          field: "contract_period",
          description: "合同期 3 年 + 最多 3 次 1 年续约",
          expected: {
            kind: "text",
            value: "three (3) years",
            aliases: ["3 年", "three years"],
          },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Contract Term: Three (3) years with the option to renew for up to three (3) additional one-year periods.",
            },
          ],
          matchAnchors: [["contract term"], ["合同期"], ["three (3) years"]],
        },
        {
          factId: "FB-SCOPE",
          field: "scope",
          description:
            "范围：窗饰供应+安装+维护（含卷帘/斑马帘/电动遮阳等 12 类产品）",
          expected: {
            kind: "text",
            value: "roller shades",
            aliases: ["window coverings"],
          },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "blinds, roller shades, zebra shades, motorized shading systems, solar shades, blackout shades, skylight shading systems, draperies, valances, privacy curtains, hospital cubicle curtains, and office partition curtains",
            },
          ],
          matchAnchors: [["roller shades"], ["window coverings"], ["窗帘"], ["卷帘"]],
        },
        {
          factId: "FB-MOTORIZED",
          field: "motorized_or_manual",
          description: "范围含电动遮阳系统（但全文无电机技术规格）",
          expected: {
            kind: "text",
            value: "motorized",
            aliases: ["电动"],
          },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "motorized shading systems, solar shades",
            },
          ],
          matchAnchors: [["motorized"], ["电动"]],
        },
        {
          factId: "FB-NFPA",
          field: "fabric_requirements",
          description: "所有材料须通过 NFPA 701 垂直燃烧测试（PASS）",
          expected: { kind: "text", value: "nfpa 701" },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "All materials shall be tested in accordance with NFPA 701 – Vertical Burn Test and rated 'PASS'.",
            },
          ],
          matchAnchors: [["nfpa"]],
        },
        {
          factId: "FB-FIRE-CODE",
          field: "compliance",
          description: "符合最新版 Ontario Fire Code",
          expected: { kind: "text", value: "ontario fire code" },
          critical: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "All materials and workmanship must comply with the latest version of the Ontario Fire Code.",
            },
          ],
          matchAnchors: [["ontario fire code"]],
        },
        {
          factId: "FB-WARRANTY",
          field: "warranty",
          description: "质保：产品与安装至少 1 年",
          expected: {
            kind: "text",
            value: "one (1) year",
            aliases: ["1 year", "一年"],
          },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Warranty: Minimum one (1) year on all products and installation.",
            },
          ],
          matchAnchors: [["warranty"], ["质保"]],
        },
        {
          factId: "FB-EVAL-TOTAL",
          field: "evaluation_method",
          description: "评分制共 70 分（服务响应 20 / 人员 15 / 经验 20 / 价格 15）",
          expected: { kind: "quantity", value: 70, unit: null },
          critical: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Evaluation Criteria (Total 70 points): - Service response time (20 pts) - Staff qualifications (15 pts) - Experience and references (20 pts) - Price (15 pts)",
            },
          ],
          matchAnchors: [["70 points"], ["evaluation criteria"], ["评分"]],
        },
        {
          factId: "FB-EVAL-PRICE-WEIGHT",
          field: "evaluation_method",
          description: "价格权重仅 15/70（服务能力主导评标）",
          expected: { kind: "quantity", value: 15, unit: null },
          critical: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Price (15 pts)",
            },
          ],
          matchAnchors: [["price", "15"], ["价格", "15"]],
        },
        {
          factId: "FB-INSURANCE",
          field: "insurance",
          description: "商业综合责任险最低 $2,000,000（Addendum 回答）",
          expected: { kind: "money", amount: 2000000, currency: "CAD" },
          critical: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Insurance requirements? A: Minimum $2,000,000 general liability insurance required.",
            },
          ],
          matchAnchors: [["insurance"], ["保险"], ["liability"]],
        },
        {
          factId: "FB-SAMPLES",
          field: "samples",
          description:
            "投标阶段不需要样品；仅入围者被要求提供（Addendum 覆盖主文件的 may be required）",
          expected: {
            kind: "text",
            value: "shortlisted",
            aliases: ["入围"],
          },
          critical: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Are samples required at time of bid? A: No. Samples will only be requested from shortlisted proponents.",
            },
          ],
          matchAnchors: [["sample"], ["样品"]],
          notes: "补遗覆盖考点：正确答案必须反映 Addendum 口径，不是主文件口径",
        },
        {
          factId: "FB-LOCAL-INSTALL",
          field: "installation",
          description: "本地安装队伍：优先但非强制；可分包给合格本地安装商",
          expected: {
            kind: "text",
            value: "preferred but not mandatory",
            aliases: ["非强制"],
          },
          critical: false,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Is local installation team required? A: Preferred but not mandatory. Subcontracting to qualified local installers is acceptable.",
            },
          ],
          matchAnchors: [["local install"], ["本地", "安装"]],
        },
        {
          factId: "FB-AFFIDAVIT",
          field: "mandatory_forms",
          description: "Flameproofing Affidavit 须在任何付款前提交（Addendum）",
          expected: { kind: "text", value: "flameproofing affidavit" },
          critical: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Flameproofing Affidavit must be provided before any payment is processed.",
            },
          ],
          matchAnchors: [["flameproofing"], ["affidavit"]],
        },
        {
          factId: "FB-ADDENDA-COUNT",
          field: "addenda_count",
          description: "补遗数量 = 1（Addendum #1）",
          expected: { kind: "quantity", value: 1, unit: null },
          critical: false,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "Addendum #1 – Clarifications",
            },
          ],
          matchAnchors: [["addendum"], ["补遗"]],
        },
      ],
      goldenRequirements: [
        {
          goldenId: "RB-NFPA",
          text: "All materials shall be tested in accordance with NFPA 701 – Vertical Burn Test and rated 'PASS'",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "All materials shall be tested in accordance with NFPA 701 – Vertical Burn Test and rated 'PASS'.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["nfpa"]],
        },
        {
          goldenId: "RB-FIRE-CODE",
          text: "All materials and workmanship must comply with the latest version of the Ontario Fire Code",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "All materials and workmanship must comply with the latest version of the Ontario Fire Code.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["ontario fire code"], ["fire code"]],
        },
        {
          goldenId: "RB-CSA",
          text: "Products shall meet CSA and CSGA standards",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Products shall meet CSA and CSGA standards.",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["csa"]],
        },
        {
          goldenId: "RB-WARRANTY",
          text: "Warranty: Minimum one (1) year on all products and installation",
          category: "warranty",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Warranty: Minimum one (1) year on all products and installation.",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["warranty"], ["质保"]],
        },
        {
          goldenId: "RB-FIRST-QUALITY",
          text: "All materials used to be of first quality",
          category: "technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "All materials used to be of first quality.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["first quality"]],
        },
        {
          goldenId: "RB-BATON",
          text: "System shall be operated by 3/8\" thick fiberglass baton",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "System shall be operated by 3/8\" thick fiberglass baton.",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["fiberglass"], ["baton"]],
        },
        {
          goldenId: "RB-MEASURE",
          text: "Provide on-site measurements as required",
          category: "technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Provide on-site measurements as required.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["on-site measurements"], ["measurements"]],
        },
        {
          goldenId: "RB-REMOVAL",
          text: "Remove and dispose of existing window coverings, repair wall surfaces as needed",
          category: "technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Remove and dispose of existing window coverings, repair wall surfaces as needed.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["remove", "dispose"], ["拆旧"]],
        },
        {
          goldenId: "RB-SUPPLY-INSTALL",
          text: "Supply and install new window coverings including blinds, roller shades, zebra shades, motorized shading systems, solar shades, blackout shades, skylight shading systems, draperies, valances, privacy curtains, hospital cubicle curtains, and office partition curtains",
          category: "technical",
          mandatory: true,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Supply and install new window coverings including but not limited to: blinds, roller shades…",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["supply and install"], ["window coverings"]],
        },
        {
          goldenId: "RB-INSURANCE",
          text: "Minimum $2,000,000 general liability insurance required (Addendum #1)",
          category: "commercial",
          mandatory: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "Minimum $2,000,000 general liability insurance required.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["2,000,000"], ["liability insurance"]],
        },
        {
          goldenId: "RB-AFFIDAVIT",
          text: "Flameproofing Affidavit must be provided before any payment is processed (Addendum #1)",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Flameproofing Affidavit must be provided before any payment is processed.",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["flameproofing"], ["affidavit"]],
        },
        {
          goldenId: "RB-SAMPLES-SHORTLIST",
          text: "Samples not required at bid time; will only be requested from shortlisted proponents (Addendum #1 supersedes main doc 'may be required to submit a sample')",
          category: "submission",
          mandatory: false,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "A: No. Samples will only be requested from shortlisted proponents.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["sample"], ["样品"]],
        },
      ],
      knownAmbiguities: [
        {
          ambiguityId: "AMBB-QUANTITIES",
          description:
            "框架协议全程未给任何数量/设施清单/年度体量——报价基础缺失",
          expected: "CLARIFICATION_REQUIRED",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "across its facilities（无数量、无清单、无历史用量）",
            },
          ],
          matchAnchors: [["数量"], ["quantit"], ["volume"], ["facilities", "清单"]],
        },
        {
          ambiguityId: "AMBB-MOTOR-SPECS",
          description:
            "范围含 motorized shading systems 但全文无电机/电源/控制规格",
          expected: "CLARIFICATION_REQUIRED",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "motorized shading systems, solar shades",
            },
          ],
          matchAnchors: [["motor"], ["电动", "规格"], ["电机"]],
        },
        {
          ambiguityId: "AMBB-SUBMISSION-METHOD",
          description: "只给了截止日期，无提交方式/地点/时间",
          expected: "CLARIFICATION_REQUIRED",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Submission Deadline: November 30, 2026（无方式）",
            },
          ],
          matchAnchors: [["提交", "方式"], ["submission", "method"], ["how to submit"]],
        },
      ],
      goldenRisks: [
        {
          riskId: "RISKB-NO-QUANTITIES",
          severity: "CRITICAL",
          description:
            "商业基础缺失：框架协议无数量/设施/年度体量——无法测算收入与产能，报价风险极高",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "supply, installation, and maintenance of window coverings across its facilities",
            },
          ],
          matchAnchors: [["数量"], ["quantit"], ["volume", "unknown"]],
        },
        {
          riskId: "RISKB-SERVICE-WEIGHTED",
          severity: "CRITICAL",
          description:
            "评标 55/70 分与价格无关（服务响应/人员/经验）——远程/无本地服务能力的投标人结构性劣势",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Service response time (20 pts) - Staff qualifications (15 pts) - Experience and references (20 pts) - Price (15 pts)",
            },
          ],
          matchAnchors: [["service response"], ["评分", "服务"], ["55"], ["20 pts"]],
        },
        {
          riskId: "RISKB-MOTOR-SPECS",
          severity: "IMPORTANT",
          description: "电动系统无规格：电源/控制/认证责任不明，安装界面风险",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "motorized shading systems",
            },
          ],
          matchAnchors: [["motor"], ["电动"]],
        },
        {
          riskId: "RISKB-FIRE-CERT",
          severity: "IMPORTANT",
          description:
            "每种面料都需 NFPA 701 PASS 证明 + Flameproofing Affidavit 付款前置——文档合规链条重",
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "NFPA 701 – Vertical Burn Test and rated 'PASS'",
            },
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote:
                "Flameproofing Affidavit must be provided before any payment is processed.",
            },
          ],
          matchAnchors: [["nfpa"], ["防火"], ["flameproofing"]],
        },
        {
          riskId: "RISKB-ADDENDUM-TRACKING",
          severity: "IMPORTANT",
          description:
            "Addendum 覆盖主文件条款（样品/保险/本地安装）——版本口径若不跟踪会答错要求",
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "Addendum #1 – Clarifications",
            },
          ],
          matchAnchors: [["addendum"], ["补遗"]],
        },
      ],
      goldenClarifications: [
        {
          clarId: "CLARB-QUANTITIES",
          topic: "设施清单/预计数量/年度体量（报价基础）",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "across its facilities（无量）",
            },
          ],
          matchAnchors: [["数量"], ["quantit"], ["volume"], ["设施", "清单"], ["facilities"]],
        },
        {
          clarId: "CLARB-PRICING-FORMAT",
          topic: "报价格式（单价表/目录折扣/按类目？价格仅 15 分如何计分）",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Price (15 pts)（未给报价格式）",
            },
          ],
          matchAnchors: [["报价", "格式"], ["pricing", "format"], ["unit price", "schedule"]],
        },
        {
          clarId: "CLARB-MOTOR",
          topic: "电动系统规格：电源/控制协议/电气接线责任方",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "motorized shading systems",
            },
          ],
          matchAnchors: [["motor"], ["电动"], ["电源"], ["wiring"]],
        },
        {
          clarId: "CLARB-SUBMISSION",
          topic: "提交方式/地点/截止时刻（文档只给日期）",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Submission Deadline: November 30, 2026",
            },
          ],
          matchAnchors: [["提交", "方式"], ["submission", "method"], ["submit", "where"]],
        },
        {
          clarId: "CLARB-WARRANTY-START",
          topic: "质保起算点（逐单验收 vs 整体合同）",
          necessity: "USEFUL",
          answeredInDocument: false,
          evidence: [
            {
              documentId: MAIN_DOC,
              pageNumbers: [1],
              sourceQuote: "Warranty: Minimum one (1) year on all products and installation.",
            },
          ],
          matchAnchors: [["质保", "起算"], ["warranty", "start"], ["warranty", "commence"]],
        },
        {
          clarId: "CLARB-AA-SAMPLES",
          topic: "投标是否需交样（Addendum-01 已回答：不需要，仅入围后）",
          necessity: "USEFUL",
          answeredInDocument: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "Are samples required at time of bid? A: No.",
            },
          ],
          matchAnchors: [["样品"], ["sample"]],
        },
        {
          clarId: "CLARB-AA-INSURANCE",
          topic: "保险要求（Addendum-01 已回答：$2M GL）",
          necessity: "USEFUL",
          answeredInDocument: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "A: Minimum $2,000,000 general liability insurance required.",
            },
          ],
          matchAnchors: [["保险"], ["insurance"]],
        },
        {
          clarId: "CLARB-AA-LOCAL",
          topic: "本地安装是否强制（Addendum-01 已回答：优先非强制，可分包）",
          necessity: "USEFUL",
          answeredInDocument: true,
          evidence: [
            {
              documentId: ADDENDUM_DOC,
              pageNumbers: [1],
              sourceQuote: "A: Preferred but not mandatory.",
            },
          ],
          matchAnchors: [["本地", "安装"], ["local install"], ["subcontract"]],
        },
      ],
      expectedUnknowns: [
        {
          field: "quantity",
          description: "文档无任何数量——系统不得给出数量数字（1500/7500 为 RCMP 遗留）",
          forbiddenClaimAnchors: [["1500"], ["7,500"], ["7500"]],
        },
        {
          field: "submission_method",
          description: "未给提交方式——不得声称邮箱/门户/纸质",
          forbiddenClaimAnchors: [["提交", "邮箱"], ["submit", "email"], ["5mb"]],
        },
        {
          field: "bid_bond",
          description: "无投标保证金要求",
          forbiddenClaimAnchors: [["bid bond"], ["投标保证金"]],
        },
        {
          field: "site_visit",
          description: "无现场踏勘安排",
          forbiddenClaimAnchors: [["site visit", "required"], ["现场踏勘"]],
        },
        {
          field: "enquiry_deadline",
          description: "未给询价截止——不得输出具体询价截止日期",
          forbiddenClaimAnchors: [["询价", "2026-11-25"], ["enquiry deadline", "2026"]],
        },
      ],
      hallucinationProbes: [
        // RCMP 背包域的遗留主题——出现在 DSBN 输出中即为幻觉
        ["1000d"],
        ["backpack"],
        ["背包"],
        ["call-up"],
        ["up to 1500"],
        ["7,500"],
        ["拉链"],
        ["zipper"],
        ["ddp"],
        ["regina"],
        ["m1–m15"],
        ["reciprocal procurement"],
        ["海外制造"],
      ],
      notes:
        "青砚实际业务域（窗饰）的首个 benchmark case。文本为浓缩转写（NEAR_REAL），量级小但覆盖补遗覆盖、评分制、防火认证等真实考点；待真实完整窗饰标书补充后应升级为 REAL case。",
    };
  },
};
