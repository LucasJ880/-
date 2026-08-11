/**
 * CASE A-REAL — RCMP "Backpacks for Cadets" RISO（真实 43 页原件）
 *
 * 文档：M5000-25-3574-A（公开政府招标文件），本地私有路径加载（见 real-pdf.ts），
 * PDF 缺失 → SKIPPED，绝不合成顶替。
 *
 * Golden 来源：由评审者逐页阅读真实 PDF 文本转录（页码 + 原文引文逐条可核）；
 * 不来自任何抽取器/AI 输出。状态 PENDING_HUMAN_CONFIRMATION —— 待 Lucas 逐条确认
 * 后升级为 HUMAN_CONFIRMED。
 *
 * 与 committed 合成 fixture 的关键差异（评审时注意）：
 * - 真实 M1–M15（p13–14）与 fixture 版本内容不同：真实 M3 = 37–55 L（fixture 写
 *   "minimum 35 litres"）；真实 M11 = dark blue or black（fixture 写 olive/black）。
 * - 真实文档无 warranty / 无 bid bond / 无 sample 要求；保险明确 "No Specific
 *   Requirement"（p32）。
 */

import type { CaseModule, CaseSkip, TenderEvalCase } from "../contract";
import { loadRealPdfPages } from "../real-pdf";

const DOC = "doc_real_rcmp_rfp";

export const caseARcmpRisoReal: CaseModule = {
  caseId: "case-a-rcmp-riso-real",
  load: async (): Promise<TenderEvalCase | CaseSkip> => {
    const loaded = await loadRealPdfPages(DOC);
    if (!loaded) {
      return {
        caseId: "case-a-rcmp-riso-real",
        skipped: true,
        reason:
          "real PDF fixture not present (fixtures/private, TENDER_FIXTURE_PDF_PATH)",
      };
    }
    return {
      contractVersion: "tender-eval/v1",
      caseId: "case-a-rcmp-riso-real",
      title: "RCMP Backpacks for Cadets — RISO M5000-25-3574-A（真实原件 43 页）",
      projectType: "goods-standing-offer",
      provenance: {
        kind: "REAL",
        source:
          "fixtures/private/M5000-25-3574 - A - RFP - English.pdf（公开政府招标原件，本地加载，不提交）",
        redaction: "NONE",
        goldenAnswerMethod: "PENDING_HUMAN_CONFIRMATION",
        confirmedBy: null,
        confirmedAt: null,
      },
      documentSet: [
        {
          documentId: DOC,
          role: "MAIN",
          title: "RFSO M5000-25-3574-A (43 pages)",
          pages: loaded.pages,
        },
      ],
      goldenFacts: [
        {
          factId: "F-BUYER",
          field: "buyer",
          description: "采购单位 = Royal Canadian Mounted Police (RCMP)",
          expected: {
            kind: "text",
            value: "royal canadian mounted police",
            aliases: ["rcmp"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1, 4],
              sourceQuote: "Offer to: Royal Canadian Mounted Police",
            },
          ],
          matchAnchors: [["rcmp"], ["royal canadian mounted police"]],
        },
        {
          factId: "F-NUMBER",
          field: "tender_number",
          description: "招标编号 M5000-25-3574-A",
          expected: { kind: "text", value: "m5000-25-3574-a" },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [],
              sourceQuote: "Solicitation No. – Nº de l'invitation M5000-25-3574-A",
            },
          ],
          matchAnchors: [["m5000"]],
        },
        {
          factId: "F-TITLE",
          field: "tender_title",
          description: "项目名称 Backpacks for Cadets",
          expected: { kind: "text", value: "backpacks for cadets" },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1, 33],
              sourceQuote: "Title – Sujet Backpacks for Cadets",
            },
          ],
          matchAnchors: [["backpacks for cadets"], ["cadets", "背包"]],
        },
        {
          factId: "F-TYPE",
          field: "solicitation_type",
          description: "招标形式 = Request for Standing Offer / RISO",
          expected: {
            kind: "text",
            value: "standing offer",
            aliases: ["riso", "rfso"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1],
              sourceQuote:
                "REQUEST FOR STANDING OFFER Regional Individual Standing Offer (RISO)",
            },
          ],
          matchAnchors: [["standing offer"], ["riso"]],
        },
        {
          factId: "F-ISSUE-DATE",
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
          factId: "F-CLOSING",
          field: "closing_datetime",
          description: "截标 2026-08-18 14:00 MDT",
          expected: {
            kind: "datetime",
            date: "2026-08-18",
            time: "14:00",
            tz: "MDT",
          },
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
          factId: "F-ENQUIRY-DEADLINE",
          field: "enquiry_deadline",
          description:
            "询价截止：截标前 5 个日历日（规则原文）→ 归一化 2026-08-13",
          expected: { kind: "date", value: "2026-08-13" },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [6],
              sourceQuote:
                "All enquiries must be submitted in writing to the Standing Offer Authority no later than five (5) calendar days before the Request for Standing Offers (RFSO) closing date.",
            },
          ],
          matchAnchors: [["enquiry"], ["询价"], ["澄清截止"]],
          notes:
            "文档给规则非日期；系统按 closing−5 推导为 2026-08-13 视为等价（须标注 DOCUMENT_INTERPRETATION 口径）",
        },
        {
          factId: "F-SUBMIT-EMAIL",
          field: "submittal_requirements",
          description: "投标提交方式 = 邮箱 NWR_Procurement_Bids@rcmp-grc.gc.ca（传真不接受）",
          expected: {
            kind: "text",
            value: "nwr_procurement_bids@rcmp-grc.gc.ca",
            aliases: ["nwr_procurement_bids"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1],
              sourceQuote:
                "RETURN OFFERS TO: … Offer Receiving/Réception d'offres Email/Courriel: NWR_Procurement_Bids@rcmp-grc.gc.ca",
            },
            {
              documentId: DOC,
              pageNumbers: [6],
              sourceQuote:
                "Offers transmitted by facsimile to RCMP will not be accepted.",
            },
          ],
          matchAnchors: [["提交", "邮箱"], ["submission", "email"], ["nwr_procurement"]],
        },
        {
          factId: "F-VALIDITY",
          field: "offer_validity",
          description: "报价有效期 90 days（由标准条款 60 天修订为 90 天）",
          expected: { kind: "duration", days: 90 },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [6],
              sourceQuote: "Delete: 60 days Insert: 90 days",
            },
          ],
          matchAnchors: [["90 days"], ["有效期"], ["validity"]],
        },
        {
          factId: "F-PERIOD",
          field: "contract_period",
          description: "主合同期 2026-10-02 至 2029-10-01",
          expected: {
            kind: "text",
            value: "october 2, 2026 to october 1, 2029",
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [4, 23, 30],
              sourceQuote:
                "The period for making call-ups against the Standing Offer is from October 2, 2026 to October 1, 2029",
            },
          ],
          matchAnchors: [["合同期"], ["standing offer", "october"], ["period"]],
        },
        {
          factId: "F-OPTIONS",
          field: "contract_period",
          description: "2 个 1 年期选择期（至 2030-10-01 / 2031-10-01）",
          expected: {
            kind: "text",
            value: "october 2, 2029 to october 1, 2030",
            aliases: ["two (2) additional one (1) year periods"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [4, 23, 30],
              sourceQuote:
                "option to extend the Standing Offer for up to two (2) additional one (1) year periods, from October 2, 2029 to October 1, 2030, and from October 2, 2030 to October 1, 2031",
            },
          ],
          matchAnchors: [["选择期"], ["option period"], ["option_period"]],
        },
        {
          factId: "F-DELIVERY-POINT",
          field: "location",
          description:
            "交货地点 RCMP Depot / 5600–11th Avenue, Regina SK S4P 3J7",
          expected: {
            kind: "text",
            value: "regina",
            aliases: ["5600", "s4p 3j7"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [33, 34],
              sourceQuote:
                "Royal Canadian Mounted Police (RCMP) Depot Stores Services RCMP TRAINING ACADEMY \"C\" BLOCK 5600 – 11th Avenue Regina, SK, CANADA S4P 3J7",
            },
          ],
          matchAnchors: [["delivery point"], ["交货地点"], ["5600"], ["s4p 3j7"]],
        },
        {
          factId: "F-QTY-ANNEX-A",
          field: "quantity",
          description: "Annex A 数量：Up to 1500 per contract period（上限表述）",
          expected: { kind: "text", value: "up to 1500 per contract period" },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [33],
              sourceQuote: "Required quantity: Up to 1500 per contract period",
            },
          ],
          matchAnchors: [["up to 1500"], ["annex a", "1500"]],
        },
        {
          factId: "F-QTY-ANNUAL",
          field: "quantity",
          description: "Annex B 各评标年 Estimated Annual Quantity = 1500",
          expected: { kind: "quantity", value: 1500, unit: null },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36, 37],
              sourceQuote:
                "Estimated Annual Quantity (C) … Each 1500（Table 1 / Table 2 各年度行）",
            },
          ],
          matchAnchors: [["annex b", "1500"], ["annual", "1500"], ["评标", "1500"]],
        },
        {
          factId: "F-QTY-AGGREGATE",
          field: "quantity",
          description:
            "评标合计 = 1500 × 5 期 = 7500（计算解释，文件无字面 7,500，非保证）",
          expected: { kind: "quantity", value: 7500, unit: null },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36, 37],
              sourceQuote:
                "The total evaluated price: E1 + E2 (applicable taxes excluded)（5 行 Each 1500）",
            },
          ],
          matchAnchors: [["7500"], ["7,500"]],
          notes: "必须为 DOCUMENT_INTERPRETATION 口径，不得写成原文事实",
        },
        {
          factId: "F-QTY-NO-GUARANTEE",
          field: "quantity",
          description: "估计数量仅供评标，不构成采购保证",
          expected: {
            kind: "text",
            value: "does not constitute a guarantee",
            aliases: ["非保证", "不构成保证", "not a guarantee"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36],
              sourceQuote:
                "The estimated quantity is provided for evaluation purposes only and does not constitute a guarantee or commitment on behalf of Canada.",
            },
            {
              documentId: DOC,
              pageNumbers: [7],
              sourceQuote:
                "The inclusion of this data in this solicitation does not represent a commitment by Canada",
            },
          ],
          matchAnchors: [["guarantee"], ["保证采购"], ["非保证"]],
        },
        {
          factId: "F-EVAL-METHOD",
          field: "evaluation_method",
          description:
            "评标：满足全部强制技术准则的响应性报价中最低评估价中标",
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
          matchAnchors: [["lowest evaluated price"], ["最低评估价"], ["评标方式"]],
        },
        {
          factId: "F-SUBMIT-3PDF",
          field: "submittal_requirements",
          description: "投标分三份独立 PDF：Technical / Financial / Certifications",
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
                "Section I: Technical Offer (one soft copy in PDF format) Section II: Financial Offer (one soft copy in PDF format) Section III: Certifications (one soft copy in PDF format)",
            },
          ],
          matchAnchors: [["三份"], ["technical offer", "financial offer"]],
        },
        {
          factId: "F-EMAIL-5MB",
          field: "submittal_requirements",
          description: "邮件含附件不得超过 5MB；超限被邮件系统拦截视为未收到",
          expected: { kind: "text", value: "5mb", aliases: ["5 mb"] },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "The maximum e-mail message size including all file attachments must not exceed 5MB.",
            },
          ],
          matchAnchors: [["5mb"], ["5 mb"]],
        },
        {
          factId: "F-NO-ZIP",
          field: "submittal_requirements",
          description: "不接受 ZIP 或链接",
          expected: {
            kind: "text",
            value: "zip files or links to offer documents will not be accepted",
            aliases: ["不接受 zip"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "Zip files or links to Offer documents will not be accepted.",
            },
          ],
          matchAnchors: [["zip"]],
        },
        {
          factId: "F-PRICE-ONLY-FINANCIAL",
          field: "pricing_instructions",
          description: "价格只允许出现在 Financial Offer",
          expected: {
            kind: "text",
            value: "prices must appear in the financial offer",
            aliases: ["价格仅可出现在 financial offer"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "Prices must appear in the financial offer only. No prices must be indicated in any other section of the Offer.",
            },
          ],
          matchAnchors: [["prices must appear"], ["价格仅可"]],
        },
        {
          factId: "F-PRICING-CAD-DDP",
          field: "pricing_instructions",
          description:
            "报价：加元、单一固定全包单价；评估不含税、含关税；DDP 目的地",
          expected: {
            kind: "text",
            value: "canadian dollars",
            aliases: ["加元", "applicable taxes excluded"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10],
              sourceQuote:
                "Offerors must include a single, firm, all-inclusive rate quoted in Canadian dollars in each cell requiring an entry in the pricing tables.",
            },
            {
              documentId: DOC,
              pageNumbers: [12],
              sourceQuote:
                "The price of the offer will be evaluated in Canadian dollars, Applicable Taxes excluded, DDP destination, Canadian customs duties and excise taxes included.",
            },
          ],
          matchAnchors: [["canadian dollars"], ["加元"], ["taxes excluded"]],
        },
        {
          factId: "F-DELIVERY-LEAD",
          field: "delivery",
          description: "交付：call-up 签发后 30 天内（页 30/34；不得引 23 页）",
          expected: { kind: "duration", days: 30 },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [30, 34],
              sourceQuote:
                "Delivery must be completed in accordance with the call-up against the Standing Offer, within 30 days of call-up issuance.",
            },
          ],
          matchAnchors: [["30 days", "call-up"], ["交货期"], ["delivery_lead"]],
          notes:
            "p23 有两处 30 天干扰源（展期通知 30 天前 / 季报 30 日历日）——引用 p23 = 证据错误",
        },
        {
          factId: "F-CALLUP-CONFIRM",
          field: "delivery",
          description: "收到 call-up 后 24 小时内邮件确认订单并给交付预估",
          expected: {
            kind: "text",
            value: "24 hours",
            aliases: ["24 小时", "24小时"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [34],
              sourceQuote:
                "Confirm the order by email within 24 hours to the Project Authority identified in the call-up and provide an estimated date of delivery.",
            },
          ],
          matchAnchors: [["24 hours"], ["24 小时"]],
        },
        {
          factId: "F-DDP",
          field: "delivery",
          description: "DDP Regina, Saskatchewan Incoterms 2020",
          expected: {
            kind: "text",
            value: "ddp",
            aliases: ["delivered duty paid"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [31, 36],
              sourceQuote:
                "Delivered Duty Paid (DDP) Regina, Saskatchewan Incoterms 2020 for shipments from a commercial contractor.",
            },
          ],
          matchAnchors: [["ddp"], ["incoterms"]],
        },
        {
          factId: "F-CALLUP-MAX",
          field: "commercial_requirements",
          description: "单笔 call-up 上限 $400,000（含税）",
          expected: { kind: "money", amount: 400000, currency: "CAD" },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [26],
              sourceQuote:
                "Individual call-ups against the Standing Offer must not exceed $400,000.00 (Applicable Taxes included).",
            },
          ],
          matchAnchors: [["400,000"], ["400000"], ["call-up", "上限"]],
        },
        {
          factId: "F-CALLUP-10K",
          field: "commercial_requirements",
          description: "超过 $10,000 的 call-up 须经采购官处理",
          expected: { kind: "money", amount: 10000, currency: "CAD" },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [26],
              sourceQuote:
                "Call-Ups exceeding $10,000.00 must be processed by a procurement officer.",
            },
          ],
          matchAnchors: [["10,000"], ["10000"], ["10k"]],
        },
        {
          factId: "F-NO-SECURITY",
          field: "compliance",
          description: "无安全许可要求",
          expected: { kind: "boolean", value: true },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1, 4, 22],
              sourceQuote:
                "THIS DOCUMENT DOES NOT CONTAIN A SECURITY REQUIREMENT / There is no security requirement applicable to the Standing Offer",
            },
          ],
          matchAnchors: [["security requirement"], ["安全许可"]],
        },
        {
          factId: "F-INSURANCE-NONE",
          field: "insurance",
          description: "保险：明确 No Specific Requirement（承包商自行决定）",
          expected: { kind: "boolean", value: true },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [32],
              sourceQuote: "6.19 Insurance – No Specific Requirement",
            },
          ],
          matchAnchors: [["insurance"], ["保险"]],
        },
        {
          factId: "F-ELIGIBILITY",
          field: "eligibility",
          description:
            "供应商资格：仅 Canadian Suppliers / Applicable Trading Partner；Non-Trading Partner 投标被拒",
          expected: {
            kind: "text",
            value: "reciprocal procurement",
            aliases: ["canadian suppliers"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [2, 4, 17],
              sourceQuote:
                "only Canadian Suppliers and suppliers of an Applicable Trading Partner … are eligible for this solicitation of Bids. Bids submitted by Suppliers of a Non-Trading Partner will be rejected.（p2 Important Notice §2 / p4 §1.5 / p17 §5.1.3.2）",
            },
          ],
          matchAnchors: [["reciprocal"], ["资格"]],
        },
        {
          factId: "F-FORCED-LABOUR",
          field: "compliance",
          description: "反强迫劳动条款（6.12）",
          expected: { kind: "boolean", value: true },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [27, 28],
              sourceQuote: "6.12 Anti-forced Labour Requirement – Standing Offer",
            },
          ],
          matchAnchors: [["forced labour"], ["强迫劳动"]],
        },
        {
          factId: "F-ENV-PACKAGING",
          field: "compliance",
          description: "环保包装 Mandatory（含回收/复用/退回定义与承包商回收责任）",
          expected: {
            kind: "text",
            value: "environmentally preferable packaging",
            aliases: ["环保包装"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [4, 34, 35],
              sourceQuote:
                "1.3 Environmental Packaging – Mandatory / 9. ENVIRONMENTALLY PREFERABLE PACKAGING – MANDATORY",
            },
          ],
          matchAnchors: [["packaging"], ["环保包装"]],
        },
        {
          factId: "F-QUARTERLY-REPORT",
          field: "commercial_requirements",
          description: "季度用量报告：季末 30 日历日内提交（无业务须报 nil）",
          expected: {
            kind: "text",
            value: "quarterly",
            aliases: ["季度"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [22, 23],
              sourceQuote:
                "The data must be submitted on a quarterly basis … no later than 30 calendar days after the end of the reporting period.",
            },
          ],
          matchAnchors: [["quarterly"], ["季度"]],
        },
        {
          factId: "F-LAWS",
          field: "compliance",
          description: "适用法律默认 Alberta（可自选省份替换）",
          expected: { kind: "text", value: "alberta" },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [7],
              sourceQuote:
                "the relations between the parties determined, by the laws in force in Alberta",
            },
          ],
          matchAnchors: [["alberta"], ["适用法律"]],
        },
        {
          factId: "F-FX-BAN",
          field: "commercial_requirements",
          description:
            "不提供汇率波动风险缓解；含此类条款的报价 = 非响应",
          expected: {
            kind: "text",
            value: "exchange rate fluctuation",
            aliases: ["汇率"],
          },
          critical: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10],
              sourceQuote:
                "The requirement does not offer exchange rate fluctuation risk mitigation. … All bids including such provision will render the bid non-responsive.",
            },
          ],
          matchAnchors: [["exchange rate"], ["汇率"]],
        },
        {
          factId: "F-PAYMENT",
          field: "commercial_requirements",
          description:
            "付款：固定单价；关税/交付/卸货含内、税另计；完成交付后单笔支付",
          expected: {
            kind: "text",
            value: "firm unit price",
            aliases: ["固定单价"],
          },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [31, 36],
              sourceQuote:
                "the Contractor will be paid a firm unit price … Customs duties, delivery and offloading are included, and Applicable Taxes are extra.",
            },
          ],
          matchAnchors: [["firm unit price"], ["单价"]],
        },
        {
          factId: "F-CONTACT",
          field: "buyer",
          description: "询价联系人 Shahlar Mammadov（Standing Offer Authority）",
          expected: { kind: "text", value: "shahlar mammadov" },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1, 24],
              sourceQuote:
                "Address Inquiries to – … Shahlar Mammadov shahlar.mammadov@rcmp-grc.gc.ca",
            },
          ],
          matchAnchors: [["mammadov"], ["联系人"]],
        },
        {
          factId: "F-CLIENT-REF",
          field: "tender_number",
          description: "Client Reference No. 202503574",
          expected: { kind: "text", value: "202503574" },
          critical: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1],
              sourceQuote:
                "Client Reference No. - No. De Référence du Client 202503574",
            },
          ],
          matchAnchors: [["202503574"], ["client reference"]],
        },
      ],
      goldenRequirements: [
        // —— 强制技术准则 M1–M15（p13–14 = Attachment 1 to Part 4；p33–34 Annex A 重复） ——
        {
          goldenId: "R-M1",
          text: "Main Compartment size must be: Minimum 20\" H x 12.5\" L x 8\" D, Maximum 23\" H x 13.5 L x 8.5 D and must include an internal padded section for a laptop as well as dual zippers",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 33],
              sourceQuote:
                "M1 Main Compartment size must be: Minimum 20\" H x 12.5\" L x 8\" D, Maximum 23\" H x 13.5 L x 8.5 D…",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["main compartment"]],
        },
        {
          goldenId: "R-M2",
          text: "Front pocket size must be: Minimum 12.5\" H x 11\" L x 2\" D, Maximum 15.5\" H x 11.5\" L x 2\" D with dual zipper closure",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 33],
              sourceQuote: "M2 Front pocket size must be: Minimum 12.5\" H x 11\" L x 2\" D…",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["front pocket", "size"], ["front pocket", "12.5"]],
        },
        {
          goldenId: "R-M3",
          text: "Total bag capacity must be: 37 – 55 liters",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 33],
              sourceQuote: "M3 Total bag capacity must be: 37 – 55 liters",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["capacity"], ["liters"], ["litres"]],
          notes: "注意：合成 fixture 写的是 minimum 35 litres——与真实文档不符",
        },
        {
          goldenId: "R-M4",
          text: "Empty Bag Weight must be: Maximum 6 lbs",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 33],
              sourceQuote: "M4 Empty Bag Weight must be: Maximum 6 lbs",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["weight"], ["6 lbs"], ["6lbs"]],
        },
        {
          goldenId: "R-M5",
          text: "Must be minimum 1000D water-repellent nylon cloth",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 34],
              sourceQuote: "M5 Must be minimum 1000D water-repellent nylon cloth",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["1000d"]],
        },
        {
          goldenId: "R-M6",
          text: "Must have a carry handle sewn into top of the bag",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 34],
              sourceQuote: "M6 Must have a carry handle sewn into top of the bag",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["carry handle"]],
        },
        {
          goldenId: "R-M7",
          text: "Must fit at minimum 15\" laptop in the internal padded sleeve",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 34],
              sourceQuote: "M7 Must fit at minimum 15\" laptop in the internal padded sleeve",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["laptop"]],
        },
        {
          goldenId: "R-M8",
          text: "Must have a yoke harness with adjustable two padded shoulder straps",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 34],
              sourceQuote:
                "M8 Must have a yoke harness with adjustable two padded shoulder straps",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["yoke harness"], ["shoulder straps"]],
        },
        {
          goldenId: "R-M9",
          text: "Must have a sternum strap with plastic quick-fasten buckle",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13, 34],
              sourceQuote: "M9 Must have a sternum strap with plastic quick-fasten buckle",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["sternum strap"]],
        },
        {
          goldenId: "R-M10",
          text: "Must have no waistbelt or waistbelt that is removable or can be stowed away to not hinder access to police belt",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote:
                "M10 Must have no waistbelt or waistbelt that is removable or can be stowed away to not hinder access to police belt.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["waistbelt"]],
        },
        {
          goldenId: "R-M11",
          text: "Must be dark blue or black in colour",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote: "M11 Must be dark blue or black in colour",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["dark blue"], ["colour"], ["color"]],
          notes: "合成 fixture 写 olive/black——与真实文档不符",
        },
        {
          goldenId: "R-M12",
          text: "Must have a minimum of one hook and loop patch on the outside of bag for a name tape. Minimum size: 6\"x1\"",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote:
                "M12 Must have a minimum of one hook and loop patch on the outside of bag for a name tape. Minimum size: 6\"x1\"",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["name tape"], ["hook and loop"]],
        },
        {
          goldenId: "R-M13",
          text: "Front pocket must have at least one zippered internal pocket",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote: "M13 Front pocket must have at least one zippered internal pocket",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [
            ["zippered internal pocket"],
            ["internal pocket"],
            ["front pocket", "zippered"],
          ],
        },
        {
          goldenId: "R-M14",
          text: "External front and sides of backpack must have Pouch Attachment Ladder System (PALS) webbing sewn on that is compatible with the Modular Lightweight Load-carrying Equipment (MOLLE) system",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote:
                "M14 External front and sides of backpack must have Pouch Attachment Ladder System (PALS) webbing…",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["pals"], ["molle"], ["external front and sides"]],
        },
        {
          goldenId: "R-M15",
          text: "One soft lined eyewear pocket located inside the bag to avoid eyewear getting scratched",
          category: "mandatory_technical",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [14, 34],
              sourceQuote:
                "M15 One soft lined eyewear pocket located inside the bag to avoid eyewear getting scratched.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["eyewear"]],
        },
        // —— 提交 / 商务 / 资格强制要求 ——
        {
          goldenId: "R-SUB-EMAIL-DEADLINE",
          text: "Offers must be received at the destination identified by the date, time and place indicated on page 1 (email; closing Aug 18, 2026 14:00 MDT); late offers not Canada's responsibility",
          category: "submission",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [6],
              sourceQuote:
                "offers must be received at the destination identified by the date, time and place indicated on page 1 of the solicitation",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["closing"], ["截标"], ["received", "destination"]],
        },
        {
          goldenId: "R-SUB-3PDF",
          text: "Submit complete email Offer in separately saved sections: Section I Technical Offer, Section II Financial Offer, Section III Certifications (each one soft copy in PDF)",
          category: "submission",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "Section I: Technical Offer (one soft copy in PDF format) Section II: Financial Offer…",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["technical offer"], ["三份", "pdf"]],
        },
        {
          goldenId: "R-SUB-5MB",
          text: "Maximum e-mail message size including all attachments must not exceed 5MB; zip files or links not accepted; blocked email = offer not received",
          category: "submission",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "The maximum e-mail message size including all file attachments must not exceed 5MB. Zip files or links to Offer documents will not be accepted.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["5mb"], ["zip files"]],
        },
        {
          goldenId: "R-SUB-PRICE-SEPARATION",
          text: "Prices must appear in the financial offer only; no prices in any other section",
          category: "submission",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "Prices must appear in the financial offer only. No prices must be indicated in any other section of the Offer.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["prices must appear"], ["financial offer", "only"]],
        },
        {
          goldenId: "R-SUB-SUBSTANTIATION",
          text: "Technical offer must substantiate compliance with each mandatory criterion (Attachment 1 to Part 4 format); repetition of requirement text insufficient; incomplete substantiation = non-responsive and disqualified; links to web pages assessed NOT MET",
          category: "submission",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10],
              sourceQuote:
                "The substantiation must not simply be a repetition of the requirement(s)… the Offeror will be considered non-responsive and disqualified.",
            },
            {
              documentId: DOC,
              pageNumbers: [13],
              sourceQuote:
                "Links to web pages are not accepted and will be assessed a \"NOT MET\" rating.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["substantiat"], ["证明", "合规"], ["not met"], ["pamphlets"]],
        },
        {
          goldenId: "R-SUB-PRICING-TABLE",
          text: "Offeror must insert firm all-inclusive unit price (CAD) in every pricing table cell (column D) and complete extended price (column E); failure to complete tables in full = non-responsive",
          category: "commercial",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36],
              sourceQuote:
                "Failure to complete the tables in full will result in the offer being deemed non-responsive and given no further consideration.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["pricing table"], ["报价表"], ["column d"], ["unit price", "table"]],
        },
        {
          goldenId: "R-COM-FX",
          text: "No exchange rate fluctuation risk mitigation; bids including such provision will be non-responsive",
          category: "commercial",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10],
              sourceQuote:
                "All bids including such provision will render the bid non-responsive.",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["exchange rate"], ["汇率"]],
        },
        {
          goldenId: "R-CERT-INTEGRITY",
          text: "Provide list of names for integrity verification per Ineligibility and Suspension Policy; certifications subject to verification; untrue certification = non-responsive / set-aside / default",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [15],
              sourceQuote:
                "a List of names for integrity verification that includes all information required by the Policy",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["integrity"], ["ineligibility"], ["诚信"]],
        },
        {
          goldenId: "R-CERT-FCP",
          text: "Federal Contractors Program for Employment Equity certification (by submitting an offer, Offeror certifies FCP compliance)",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [16],
              sourceQuote:
                "5.1.2 Federal Contractors Program for Employment Equity - Standing Offer Certification",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["federal contractors"], ["employment equity"]],
        },
        {
          goldenId: "R-CERT-RECIPROCAL-DECL",
          text: "Complete and submit Declaration – Reciprocal Procurement (Attachment 2 to Part 5), with bid or within 2 business days of request",
          category: "eligibility",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [17],
              sourceQuote:
                "Bidders must complete and submit the declaration at Attachment 2 to Part 5.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["reciprocal", "declaration"], ["attachment 2"]],
        },
        {
          goldenId: "R-CERT-ENV-DECL",
          text: "Complete Attachment 3 to Part 5 Declaration – Environmentally Preferable Packaging and submit WITH the bid",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [17],
              sourceQuote:
                "Offerors must complete Attachment 3 to Part 5, Declaration – Environmentally Preferable Packaging and submit it with their bid.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["attachment 3"], ["packaging", "declaration"]],
        },
        {
          goldenId: "R-ELIG-RECIPROCAL",
          text: "Only Canadian Suppliers and Suppliers of an Applicable Trading Partner eligible; Non-Trading Partner bids rejected",
          category: "eligibility",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [2, 4, 17],
              sourceQuote:
                "Bids submitted by Suppliers of a Non-Trading Partner will be rejected.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["reciprocal"], ["canadian suppliers"]],
        },
        {
          goldenId: "R-PERF-30DAYS",
          text: "Delivery must be completed within 30 days of call-up issuance",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [30, 34],
              sourceQuote:
                "Delivery must be completed in accordance with the call-up against the Standing Offer, within 30 days of call-up issuance.",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["30 days", "call-up"]],
        },
        {
          goldenId: "R-PERF-CONFIRM-24H",
          text: "Upon receipt of a call-up, confirm the order by email within 24 hours to the Project Authority and provide estimated delivery date; notify of any potential shortages/delays",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [34],
              sourceQuote:
                "Confirm the order by email within 24 hours to the Project Authority identified in the call-up",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["24 hours"], ["24 小时"]],
        },
        {
          goldenId: "R-PERF-DDP",
          text: "Goods consigned Delivered Duty Paid (DDP) Regina, Saskatchewan Incoterms 2020",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [31, 36],
              sourceQuote:
                "Delivered Duty Paid (DDP) Regina, Saskatchewan Incoterms 2020",
            },
          ],
          importance: "CRITICAL",
          matchAnchors: [["ddp"]],
        },
        {
          goldenId: "R-PERF-PACKING-SLIP",
          text: "A packing slip indicating Standing Offer number, Call-up number, shipping date and quantity must be included with each shipment",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [31],
              sourceQuote:
                "A packing slip indicating the Standing Offer number, the Call-up number, the shipping date, and quantity of deliverables must be included with each shipment.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["packing slip"]],
        },
        {
          goldenId: "R-PERF-UNLOADING",
          text: "Delivery trucks must be equipped with unloading device; sufficient personnel to unload without federal government assistance",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [31],
              sourceQuote:
                "Delivery trucks must be equipped with an unloading device…",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["unloading"]],
        },
        {
          goldenId: "R-PERF-ENV-PACKAGING",
          text: "All packaging must be reusable, returnable or recyclable (excl. packaging tape); Contractor must take back non-recyclable/non-reusable packaging at no cost to Canada",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [34, 35],
              sourceQuote:
                "All packaging material related to this requirement must be reusable, returnable or recyclable…",
            },
          ],
          importance: "HIGH",
          matchAnchors: [["packaging"]],
        },
        {
          goldenId: "R-PERF-QUARTERLY",
          text: "Compile and provide quarterly Standing Offer usage reports within 30 calendar days after each quarter (nil reports required)",
          category: "commercial",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [22, 23],
              sourceQuote:
                "The data must be submitted on a quarterly basis to the Standing Offer Authority.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [
            ["quarterly"],
            ["季度"],
            ["reporting requirements"],
            ["nil report"],
            ["provide a", "nil"],
            ["compile and maintain records"],
          ],
        },
        {
          goldenId: "R-PERF-FORCED-LABOUR",
          text: "Anti-forced labour: Offeror states goods are not produced with forced labour; breach may set aside the Standing Offer",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [27, 28],
              sourceQuote: "6.12 Anti-forced Labour Requirement – Standing Offer",
            },
          ],
          importance: "HIGH",
          matchAnchors: [
            ["forced labour"],
            ["强迫劳动"],
            ["deliver offered goods"],
            ["notify", "investigation"],
          ],
        },
        {
          goldenId: "R-CERT-SUBMIT-PART5",
          text: "Offerors must submit the certifications and additional information required under Part 5 (with the offer; verifiable at all times)",
          category: "compliance",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10, 15, 17],
              sourceQuote:
                "Section III: Certifications — Offerors must submit the certifications and additional information required under Part 5. / Offerors must provide the required certifications and additional information to be issued a standing offer.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [
            ["certifications", "part 5"],
            ["certifications", "with their offer"],
            ["required certifications"],
          ],
        },
        {
          goldenId: "R-PERF-CALLUP-ITEMS",
          text: "The Contractor must provide the items detailed in the call-up against the Standing Offer",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [30],
              sourceQuote:
                "The Contractor must provide the items detailed in the call-up against the Standing Offer.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["items detailed in the call-up"]],
        },
        {
          goldenId: "R-PERF-SUPPLY-ASWHEN",
          text: "The Offeror must supply the Backpacks as and when required throughout the 3-year main period of the Standing Offer, including two 1-year option periods",
          category: "delivery",
          mandatory: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [33],
              sourceQuote:
                "The Offeror must supply the Backpacks as and when required throughout the 3-year main period of the Standing Offer, including two (2) one 1-year option periods.",
            },
          ],
          importance: "NORMAL",
          matchAnchors: [["as and when required"]],
        },
      ],
      knownAmbiguities: [
        {
          ambiguityId: "AMB-QTY-BASIS",
          description:
            "Annex A「Up to 1500 per contract period」（上限）与 Annex B 各年度评标量 1500（评估合计 7500）并存——per contract period 的准确含义须澄清",
          expected: "CLARIFICATION_REQUIRED",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [33],
              sourceQuote: "Required quantity: Up to 1500 per contract period",
            },
            {
              documentId: DOC,
              pageNumbers: [36, 37],
              sourceQuote: "Estimated Annual Quantity … Each 1500（×5 行）",
            },
          ],
          matchAnchors: [["per contract period"], ["up to 1500"], ["数量", "歧义"]],
        },
        {
          ambiguityId: "AMB-FIRM-VS-ESTIMATED",
          description:
            "Annex B Table 1 标题写「Firm Quantities」而正文写「estimated quantity … does not constitute a guarantee」——表述紧张须至少标记",
          expected: "FLAGGED",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36],
              sourceQuote:
                "Table 1: Initial Requirement (Firm Quantities) … The estimated quantity is provided for evaluation purposes only",
            },
          ],
          matchAnchors: [["firm quantities"], ["estimated", "guarantee"], ["非保证"]],
        },
      ],
      goldenRisks: [
        {
          riskId: "RISK-ELIGIBILITY",
          severity: "CRITICAL",
          description:
            "供应商资格门槛：仅 Canadian Supplier / Applicable Trading Partner；Non-Trading Partner 投标直接拒收——对依赖海外供应链的投标人是 GO/NO-GO 级风险",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [4, 17],
              sourceQuote:
                "Bids submitted by Suppliers of a Non-Trading Partner will be rejected.",
            },
          ],
          matchAnchors: [["reciprocal"], ["资格"], ["eligib"]],
        },
        {
          riskId: "RISK-SUBMISSION-REJECT",
          severity: "CRITICAL",
          description:
            "提交技术性废标：5MB 上限 + 禁 ZIP/链接 + 三份 PDF + 被邮件系统拦截即视为未收到",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [8],
              sourceQuote:
                "An Offer transmitted by e-mail that gets blocked by the RCMP e-mail system will be considered not received.",
            },
          ],
          matchAnchors: [["5mb"], ["三份 pdf"], ["zip"]],
        },
        {
          riskId: "RISK-SUBSTANTIATION",
          severity: "CRITICAL",
          description:
            "技术证明不足即失格：逐条 substantiation 不能只重复要求文本；网页链接=NOT MET；不完整=non-responsive",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10, 13],
              sourceQuote:
                "Where Canada determines that the substantiation is not complete, the Offeror will be considered non-responsive and disqualified.",
            },
          ],
          matchAnchors: [["substantiat"], ["not met"], ["证明", "失格"]],
        },
        {
          riskId: "RISK-PRICING-TABLE",
          severity: "CRITICAL",
          description: "报价表任一单元格缺失 = non-responsive（五个年度行全部要填）",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36],
              sourceQuote:
                "Failure to complete the tables in full will result in the offer being deemed non-responsive",
            },
          ],
          matchAnchors: [["报价表"], ["pricing table"], ["tables in full"]],
        },
        {
          riskId: "RISK-QTY-NO-GUARANTEE",
          severity: "IMPORTANT",
          description:
            "数量不保证：评估量仅评标用；volumetric data 免责——商业计划不得按 7500 建模",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [7, 36],
              sourceQuote:
                "does not constitute a guarantee or commitment on behalf of Canada",
            },
          ],
          matchAnchors: [["数量", "歧义"], ["非保证"], ["guarantee"], ["7,500"]],
        },
        {
          riskId: "RISK-DELIVERY-PRESSURE",
          severity: "IMPORTANT",
          description:
            "履约压力：call-up 后 30 天交付 + DDP Regina + 24h 确认，对库存/跨境物流构成压力",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [30, 31, 34],
              sourceQuote: "within 30 days of call-up issuance",
            },
          ],
          matchAnchors: [["履约"], ["ddp"], ["30 days", "call-up"], ["30 天", "交付"]],
        },
        {
          riskId: "RISK-FX",
          severity: "IMPORTANT",
          description:
            "汇率风险全由投标人承担：禁止任何汇率波动条款（含之即非响应），CAD 固定单价贯穿最长 5 年",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [10],
              sourceQuote:
                "The requirement does not offer exchange rate fluctuation risk mitigation.",
            },
          ],
          matchAnchors: [["exchange rate"], ["汇率"]],
        },
        {
          riskId: "RISK-ADMIN-REPORTING",
          severity: "IMPORTANT",
          description: "行政合规负担：季度用量报告（nil 也须报）+ 诚信核查名单等",
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [22, 23],
              sourceQuote: "the Offeror must provide a \"nil\" report",
            },
          ],
          matchAnchors: [["季度"], ["quarterly"], ["usage report"]],
        },
      ],
      goldenClarifications: [
        {
          clarId: "CLAR-CALLUP-VOLUME",
          topic: "典型 call-up 量级 / 年度预期量（volumetric data 免责后商业必问）",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [7],
              sourceQuote:
                "It is provided purely for information purposes.（volumetric data 免责）",
            },
          ],
          matchAnchors: [["call-up", "数量"], ["典型", "数量"], ["typical", "volume"]],
        },
        {
          clarId: "CLAR-QTY-BASIS",
          topic: "「Up to 1500 per contract period」精确含义（上限口径 vs 年度评标量）",
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
          clarId: "CLAR-OVERSEAS",
          topic: "海外制造与 Reciprocal Procurement 资格衔接（供应商属地 vs 货物原产地）",
          necessity: "NECESSARY",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [4, 17],
              sourceQuote:
                "only Canadian Suppliers and suppliers of an Applicable Trading Partner … are eligible",
            },
          ],
          matchAnchors: [["海外制造"], ["overseas"], ["原产地"], ["origin"]],
        },
        {
          clarId: "CLAR-7500-CONFIRM",
          topic: "书面确认 7500 / 年度 1500 仅用于评标、非采购承诺",
          necessity: "USEFUL",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [36],
              sourceQuote:
                "estimated quantity is provided for evaluation purposes only",
            },
          ],
          matchAnchors: [["7,500"], ["7500"]],
          notes: "文档其实已声明非保证；再确认属 USEFUL 而非 NECESSARY",
        },
        {
          clarId: "CLAR-WATER-REPELLENT",
          topic: "1000D water-repellent 的验收/证明口径（M5 无测试标准）",
          necessity: "USEFUL",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13],
              sourceQuote: "M5 Must be minimum 1000D water-repellent nylon cloth",
            },
          ],
          matchAnchors: [["防水"], ["water resist"], ["water-repell"]],
        },
        {
          clarId: "CLAR-1000D-SCOPE",
          topic: "1000D 面料适用范围（整包 vs 主面料）",
          necessity: "USEFUL",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13],
              sourceQuote: "M5 Must be minimum 1000D water-repellent nylon cloth",
            },
          ],
          matchAnchors: [["1000d"]],
        },
        {
          clarId: "CLAR-MEASUREMENT",
          topic: "M1/M2 尺寸的官方测量方法（文档未给测量规程）",
          necessity: "USEFUL",
          answeredInDocument: false,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [13],
              sourceQuote: "M1 Main Compartment size must be: Minimum 20\" H x 12.5\" L x 8\" D…",
            },
          ],
          matchAnchors: [["测量"], ["measure"]],
        },
        {
          clarId: "CLAR-AA-INSURANCE",
          topic: "保险要求（文档已明确：No Specific Requirement）",
          necessity: "USEFUL",
          answeredInDocument: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [32],
              sourceQuote: "6.19 Insurance – No Specific Requirement",
            },
          ],
          matchAnchors: [["保险", "要求"], ["insurance", "required"]],
        },
        {
          clarId: "CLAR-AA-SECURITY",
          topic: "安全许可要求（文档已明确：无）",
          necessity: "USEFUL",
          answeredInDocument: true,
          evidence: [
            {
              documentId: DOC,
              pageNumbers: [1, 4],
              sourceQuote: "THIS DOCUMENT DOES NOT CONTAIN A SECURITY REQUIREMENT",
            },
          ],
          matchAnchors: [["安全许可"], ["security clearance"]],
        },
      ],
      expectedUnknowns: [
        {
          field: "warranty",
          description: "全文无任何质保条款——系统不得声称质保要求",
          forbiddenClaimAnchors: [["warranty"], ["质保"]],
        },
        {
          field: "bid_bond",
          description: "无投标保证金/履约保证要求（Annex C 仅为定义性文本）",
          forbiddenClaimAnchors: [["bid bond"], ["投标保证金"], ["bond required"]],
        },
        {
          field: "site_visit",
          description: "货物采购，无现场踏勘安排",
          forbiddenClaimAnchors: [["site visit"], ["现场踏勘"], ["实地考察"]],
        },
        {
          field: "sample",
          description: "全文无样品要求——系统不得声称需提交样品",
          forbiddenClaimAnchors: [["样品", "必须"], ["sample", "required"]],
        },
        {
          field: "budget",
          description: "未披露预算——系统不得给出预算数字",
          forbiddenClaimAnchors: [["预算为"], ["budget is"]],
        },
      ],
      hallucinationProbes: [
        // 合成 fixture 遗留的、真实文档不存在的主题
        ["样品", "m15"],
        ["sample", "bid time"],
        ["olive"],
        ["35 litres"],
        ["35 liters"],
      ],
      notes:
        "真实原件基线 case。评估的是生产确定性管线对真实文档的表现；黄金集待人工确认（PENDING_HUMAN_CONFIRMATION）。",
    };
  },
};
