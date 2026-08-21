/**
 * CASE C — HRM-2026-0395 Media Monitoring Tool RFQ（真实服务类 RFQ，57 页）
 *
 * 文档：Halifax Regional Municipality 公开 RFQ 原件（26 页）+ Purchase Order
 * Terms and Conditions – Services（24 页）+ Supplier Code of Conduct（7 页）。
 * 页文本由 scripts/tender-eval-export-case.ts 从产品解析结果导出到本地私有目录
 * fixtures/private/tender-eval/case-c-hrm-media-monitoring/（gitignored，缺失 → SKIPPED，
 * 绝不合成顶替）。
 *
 * 本 case 的意义：现有三个 case 全是货物类（背包/窗饰）；这是第一个**服务类 / SaaS**
 * 真实原件，且正是青砚当前在投的标——覆盖批次二新增槽位（incumbent_supplier /
 * evaluation_criteria）与 PO 条款里的数据驻留、IP、无因终止等服务类风险。
 *
 * Golden 来源：评审者逐页阅读导出文本转录（页码 + 原文引文逐条可核），不来自任何
 * 抽取器/AI 输出。状态 PENDING_HUMAN_CONFIRMATION —— 待 Lucas 逐条确认后升级。
 *
 * 读文注意点（评审时对照）：
 * - 截标是 2026-09-08 14:00 Atlantic（RFQ p1/p3/p20），项目名里的「09-05」并非文件口径。
 * - 文件**未给**提问截止日（p9 只说经 Submit a Question 提交）——系统若给出具体日期即
 *   unsupported claim。
 * - 现任供应商**未具名**（p18 只说 since November 2021 / expires November 1, 2026）——
 *   系统若说出 Meltwater 等名称即幻觉（名称来自调查室人工线索，不在文件里）。
 * - RFQ 第 5 节 1.4 保险「Not Applicable」（p17）与 PO §13 最低保险清单（PO p14）相互
 *   矛盾——期望系统标歧义/产生澄清。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PageInput } from "@/lib/tender-auto-analysis/extract/types";

import type { CaseModule, CaseSkip, TenderEvalCase } from "../contract";

const CASE_ID = "case-c-hrm-media-monitoring";
const FIXTURE_DIR = join(process.cwd(), "fixtures/private/tender-eval", CASE_ID);

/** 稳定的 case 内文档 id（与导出时的生产 documentId 解耦，按标题映射） */
const RFQ = "doc_hrm_rfq_main";
const PO = "doc_hrm_po_terms";
const CODE = "doc_hrm_code_of_conduct";

type ExportedDoc = { documentId: string; title: string; pageCount: number };

function roleOfTitle(title: string): { id: string; role: "MAIN" | "ANNEX"; title: string } | null {
  const t = title.toLowerCase();
  if (t.includes("hrm-2026-0395")) return { id: RFQ, role: "MAIN", title: "RFQ HRM-2026-0395 Media Monitoring Tool (26 pages)" };
  if (t.includes("purchase order terms")) return { id: PO, role: "ANNEX", title: "Purchase Order Terms and Conditions – Services (24 pages)" };
  if (t.includes("supplier code of conduct")) return { id: CODE, role: "ANNEX", title: "Supplier Code of Conduct (7 pages)" };
  return null;
}

function loadFixture(): TenderEvalCase["documentSet"] | null {
  const pagesPath = join(FIXTURE_DIR, "pages.json");
  const docsPath = join(FIXTURE_DIR, "documents.json");
  if (!existsSync(pagesPath) || !existsSync(docsPath)) return null;
  const pages = JSON.parse(readFileSync(pagesPath, "utf-8")) as PageInput[];
  const docs = JSON.parse(readFileSync(docsPath, "utf-8")) as ExportedDoc[];
  const out: TenderEvalCase["documentSet"] = [];
  for (const d of docs) {
    const mapped = roleOfTitle(d.title);
    if (!mapped) continue;
    const docPages = pages
      .filter((p) => p.documentId === d.documentId)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => ({ documentId: mapped.id, pageNumber: p.pageNumber, contentText: p.contentText }));
    if (docPages.length === 0) continue;
    out.push({ documentId: mapped.id, role: mapped.role, title: mapped.title, pages: docPages });
  }
  // MAIN 必须在场
  if (!out.some((d) => d.documentId === RFQ)) return null;
  // MAIN 排首位
  out.sort((a, b) => (a.role === "MAIN" ? -1 : b.role === "MAIN" ? 1 : 0));
  return out;
}

const ev = (documentId: string, pageNumbers: number[], sourceQuote: string) => ({
  documentId,
  pageNumbers,
  sourceQuote,
});

export const caseCHrmMediaMonitoring: CaseModule = {
  caseId: CASE_ID,
  load: async (): Promise<TenderEvalCase | CaseSkip> => {
    const documentSet = loadFixture();
    if (!documentSet) {
      return {
        caseId: CASE_ID,
        skipped: true,
        reason:
          "private fixture not present (fixtures/private/tender-eval/case-c-hrm-media-monitoring — run scripts/tender-eval-export-case.ts)",
      };
    }
    return {
      contractVersion: "tender-eval/v1",
      caseId: CASE_ID,
      title: "HRM-2026-0395 Media Monitoring Tool RFQ（真实服务类原件 57 页）",
      projectType: "saas-media-monitoring-services",
      provenance: {
        kind: "REAL",
        source:
          "fixtures/private/tender-eval/case-c-hrm-media-monitoring/（HRM 公开 RFQ 原件 26 页 + PO 服务条款 24 页 + 供应商行为准则 7 页；产品解析页文本导出，不提交）",
        redaction: "NONE",
        goldenAnswerMethod: "PENDING_HUMAN_CONFIRMATION",
        confirmedBy: null,
        confirmedAt: null,
      },
      documentSet,

      goldenFacts: [
        {
          factId: "FC-BUYER",
          field: "buyer",
          description: "采购方 Halifax Regional Municipality (HRM)",
          expected: { kind: "text", value: "halifax regional municipality", aliases: ["hrm", "halifax"] },
          critical: true,
          evidence: [ev(RFQ, [3], "The Halifax Regional Municipality (HRM) uses the Bids&Tenders Bidding System")],
          matchAnchors: [["halifax"], ["hrm"]],
        },
        {
          factId: "FC-NUMBER",
          field: "tender_number",
          description: "RFQ 编号 HRM-2026-0395",
          expected: { kind: "text", value: "hrm-2026-0395" },
          critical: true,
          evidence: [ev(RFQ, [1, 2], "RFQ Number: HRM-2026-0395")],
          matchAnchors: [["hrm-2026-0395"]],
        },
        {
          factId: "FC-TITLE",
          field: "tender_title",
          description: "项目名 Media Monitoring Tool",
          expected: { kind: "text", value: "media monitoring tool", aliases: ["media monitoring"] },
          critical: true,
          evidence: [ev(RFQ, [1], "Media Monitoring Tool")],
          matchAnchors: [["media monitoring"]],
        },
        {
          factId: "FC-TYPE",
          field: "solicitation_type",
          description: "采购形式 Request for Quotation（RFQ，按 best value 评分）",
          expected: { kind: "text", value: "request for quotation", aliases: ["rfq", "quotation"] },
          critical: false,
          evidence: [ev(RFQ, [1], "REQUEST FOR QUOTATION")],
          matchAnchors: [["request for quotation"], ["rfq"]],
        },
        {
          factId: "FC-ISSUE",
          field: "issue_date",
          description: "发布日 2026-08-17",
          expected: { kind: "date", value: "2026-08-17" },
          critical: false,
          evidence: [ev(RFQ, [1], "Date Issued: August 17, 2026")],
          matchAnchors: [["date issued"], ["august 17"], ["issued"]],
        },
        {
          factId: "FC-CLOSING",
          field: "closing_datetime",
          description: "截标 2026-09-08 14:00 Atlantic（经 Bids&Tenders 上传）",
          expected: { kind: "datetime", date: "2026-09-08", time: "14:00", tz: null },
          critical: true,
          evidence: [
            ev(RFQ, [1], "Deadline for Bids: September 8, 2026 - 2:00 PM Atlantic Time Zone"),
            ev(RFQ, [3], "Bids will only be received up to and including 2:00 p.m. local time on September 8, 2026"),
          ],
          matchAnchors: [["september 8"], ["deadline for bids"], ["closing"], ["截标"], ["2026-09-08"]],
        },
        {
          factId: "FC-SITEVISIT",
          field: "site_visit",
          description: "无标前会/现场踏勘（Not Applicable）",
          expected: { kind: "boolean", value: false },
          critical: false,
          evidence: [ev(RFQ, [3], "1.5 PRE-BID MEETING AND SITE VISIT .1 Not Applicable")],
          matchAnchors: [["site visit"], ["pre-bid"], ["现场"]],
        },
        {
          factId: "FC-SUBMISSION",
          field: "submittal_requirements",
          description: "仅接受经 Bids&Tenders 系统电子上传，不接受纸质",
          expected: {
            kind: "text",
            value: "electronic upload via bids&tenders bidding system only",
            aliases: ["bids&tenders", "bidsandtenders", "only electronic bids", "hardcopy submissions not permitted"],
          },
          critical: true,
          evidence: [ev(RFQ, [5], "Only electronic bids will be received by the Bidding System. Hardcopy submissions not permitted.")],
          matchAnchors: [["bids&tenders"], ["bidsandtenders"], ["electronic"], ["hardcopy"]],
        },
        {
          factId: "FC-EVAL-WEIGHTS",
          field: "evaluation_method",
          description: "评分权重：社会价值 10% / 绩效评估 10% / 原产地·国籍 10% / 成本 70%",
          expected: {
            kind: "text",
            value: "social value 10% performance evaluation 10% country of origin/nationality of services 10% cost 70%",
            aliases: ["cost 70%", "70% cost", "成本 70%", "价格 70%"],
          },
          critical: true,
          evidence: [ev(RFQ, [7], "Social Value 10% Performance Evaluation 10% Country of Origin/Nationality of Services 10% Cost 70%")],
          matchAnchors: [["70%"], ["70 %"], ["cost", "points"], ["social value", "10%"], ["评分"]],
        },
        {
          factId: "FC-COST-FORMULA",
          field: "evaluation_method",
          description: "成本评分公式：最低价满分，其余按 最低价/本标价 等比例折算",
          expected: {
            kind: "text",
            value: "total points = max available pts times (lowest cost/other cost)",
            aliases: ["lowest cost/other cost", "prorated against the lowest cost bid", "lowest cost", "最低价"],
          },
          critical: true,
          evidence: [ev(RFQ, [8], "Total Points = Max Available Pts times (lowest cost/other cost)")],
          matchAnchors: [["lowest cost"], ["prorat"], ["lowest", "formula"], ["最低价"]],
        },
        {
          factId: "FC-PERF-DEFAULT",
          field: "evaluation_method",
          description: "无 HRM 历史绩效评估的供应商按 60%（meets expectations）计绩效分",
          expected: { kind: "text", value: "60% of the available points", aliases: ["60%", "meets expectations"] },
          critical: true,
          evidence: [ev(RFQ, [7], "will receive 60% of the available points (“meets expectations”)")],
          matchAnchors: [["60%"], ["meets expectations"], ["performance evaluation"]],
        },
        {
          factId: "FC-US-ZERO",
          field: "eligibility",
          description: "美国供应商（美国总部且 ≥70% 员工在美）国籍项 0 分；加拿大子公司满足条件可视为加方",
          expected: {
            kind: "text",
            value: "american suppliers as defined above will receive none of the available points",
            aliases: ["none of the available points", "u.s. supplier", "us supplier", "美国供应商"],
          },
          critical: true,
          evidence: [ev(RFQ, [8], "American suppliers as defined above will receive none of the available points.")],
          matchAnchors: [["american"], ["u.s."], ["us supplier"], ["nationality"], ["美国"]],
        },
        {
          factId: "FC-TERM",
          field: "contract_period",
          description: "合同期 1 年 + 4 个可选年（按年度绩效评审）",
          expected: {
            kind: "text",
            value: "one (1) year with four (4) optional years",
            aliases: ["1 year", "one year", "four (4) optional years", "four optional years", "1+4"],
          },
          critical: true,
          evidence: [ev(RFQ, [18], "The resulting agreement will be for a period of one (1) year with four (4) optional years based on yearly performance reviews.")],
          matchAnchors: [["one (1) year"], ["optional years"], ["option year"], ["合同期"], ["1 年"]],
        },
        {
          factId: "FC-TERM-END",
          field: "contract_period",
          description: "首期至 2027-10-31 结束",
          expected: { kind: "date", value: "2027-10-31" },
          critical: false,
          evidence: [ev(RFQ, [18], "Agreement will commence upon award and finish on October 31, 2027.")],
          matchAnchors: [["october 31"], ["2027-10-31"], ["finish on"]],
        },
        {
          factId: "FC-INCUMBENT",
          field: "incumbent_supplier",
          description: "现任（未具名）供应商自 2021-11 起服务，合同 2026-11-01 到期",
          expected: {
            kind: "text",
            value: "vendor since november 2021; contract expires november 1, 2026",
            aliases: ["since november 2021", "november 1, 2026", "expires on november 1, 2026", "2021-11", "现任"],
          },
          critical: true,
          evidence: [ev(RFQ, [18], "The municipality has been using a vendor to conduct media monitoring since November 2021. This contract expires on November 1, 2026.")],
          matchAnchors: [["november 2021"], ["incumbent"], ["current supplier"], ["现任"], ["expires"]],
        },
        {
          factId: "FC-VOLUME",
          field: "quantity",
          description: "当前月均约 375 条相关新闻（≈17 条/工作日）",
          expected: { kind: "quantity", value: 375, unit: "items/month" },
          critical: true,
          evidence: [ev(RFQ, [18], "The municipality currently averages approximately 375 relevant news items per month")],
          matchAnchors: [["375"], ["news items"], ["per month"]],
        },
        {
          factId: "FC-USERS",
          field: "quantity",
          description: "至少 7 名用户席位，可增",
          expected: { kind: "quantity", value: 7, unit: "users" },
          critical: true,
          evidence: [ev(RFQ, [19], "the municipality requires access for a minimum of seven (7) staff members")],
          matchAnchors: [["seven (7)"], ["seven"], ["7 staff"], ["users"]],
        },
        {
          factId: "FC-NEWSLETTER",
          field: "quantity",
          description: "每日简报分发名单约 250 个邮箱",
          expected: { kind: "quantity", value: 250, unit: "email accounts" },
          critical: false,
          evidence: [ev(RFQ, [19], "distribution list (of approximately 250 emails accounts)")],
          matchAnchors: [["250"], ["distribution list"], ["newsletter"]],
        },
        {
          factId: "FC-DAILY-TIME",
          field: "scope",
          description: "每日监测信息须在大西洋标准时间 8:30 前可用",
          expected: { kind: "text", value: "no later than 8:30 a.m., atlantic standard time", aliases: ["8:30 a.m.", "8:30 am", "8:30"] },
          critical: true,
          evidence: [ev(RFQ, [19], "needs to available to the municipality no later than 8:30 a.m., Atlantic Standard Time")],
          matchAnchors: [["8:30"], ["atlantic standard"]],
        },
        {
          factId: "FC-DAYS",
          field: "scope",
          description: "服务频率：周一至周五每日，不含新斯科舍法定假日",
          expected: {
            kind: "text",
            value: "daily basis, monday to friday, not including statutory holidays observed in nova scotia",
            aliases: ["monday to friday", "周一至周五"],
          },
          critical: true,
          evidence: [ev(RFQ, [18], "media monitoring services on a daily basis, Monday to Friday, not including statutory holidays observed in Nova Scotia")],
          matchAnchors: [["monday to friday"], ["statutory holidays"], ["周一"]],
        },
        {
          factId: "FC-PRICING",
          field: "pricing_instructions",
          description: "报价加元 DDP 目的地；含所有税费关税但 HST 另计",
          expected: {
            kind: "text",
            value: "canadian funds ddp (delivered duty paid) destination; hst is additional",
            aliases: ["canadian funds", "ddp", "hst is additional", "except for harmonized sales tax", "加元"],
          },
          critical: true,
          evidence: [
            ev(RFQ, [21], "Prices must be in Canadian Funds DDP (Delivered Duty Paid) Destination"),
            ev(RFQ, [4], "all taxes and customs duties in effect at the time of the bid closing, except for Harmonized Sales Tax (HST)"),
          ],
          matchAnchors: [["ddp"], ["canadian funds"], ["hst"], ["加元"]],
        },
        {
          factId: "FC-PRICE-UNIT",
          field: "pricing_instructions",
          description: "报价结构：单行「Media Monitoring Tool」1 per year（年价）",
          expected: { kind: "text", value: "1 year price", aliases: ["per year", "1 per year", "年价"] },
          critical: false,
          evidence: [ev(RFQ, [21], "1 Media Monitoring Tool 1 per year")],
          matchAnchors: [["per year"], ["1 year price"], ["年价"]],
        },
        {
          factId: "FC-VALIDITY",
          field: "offer_validity",
          description: "报价自截标起 60 天不可撤销",
          expected: { kind: "duration", days: 60 },
          critical: true,
          evidence: [ev(RFQ, [21], "A Quotation must remain valid and open to be accepted for 60 days from the closing time and date.")],
          matchAnchors: [["60 days"], ["irrevocable"], ["60 天"]],
        },
        {
          factId: "FC-INSURANCE-RFQ",
          field: "insurance",
          description: "RFQ 第 5 节保险要求「Not Applicable」（与 PO §13 矛盾，见歧义）",
          expected: { kind: "text", value: "not applicable", aliases: ["n/a", "none", "不适用"] },
          critical: false,
          evidence: [ev(RFQ, [17], "1.4 INSURANCE REQUIREMENTS The successful proponent must obtain and maintain insurance coverage in accordance with the requirements of the Agreement and as set out below: .1 Not Applicable")],
          matchAnchors: [["insurance"], ["保险"]],
          notes: "PO T&C §13（PO p14）列出 CGL/车辆/非自有车辆/专业责任最低保险——两份文件冲突",
        },
        {
          factId: "FC-WCB",
          field: "eligibility",
          description: "授标前核验投标人在新斯科舍 WCB 登记且状态良好",
          expected: {
            kind: "text",
            value: "registered and in good standing with the workers compensation board of nova scotia",
            aliases: ["wcb", "workers compensation", "good standing"],
          },
          critical: true,
          evidence: [ev(RFQ, [8], "HRM will verify, prior to award, that the Bidder is registered and in good standing with the Workers Compensation Board of Nova Scotia.")],
          matchAnchors: [["wcb"], ["workers compensation"], ["workers’ compensation"]],
        },
        {
          factId: "FC-REFERENCES",
          field: "submittal_requirements",
          description: "提供 3 个近三年同类服务业绩参考",
          expected: { kind: "quantity", value: 3, unit: "references" },
          critical: false,
          evidence: [ev(RFQ, [23], "Please provide three (3) recent (within the past three(3) years to whom you have provided similar goods and/or services.")],
          matchAnchors: [["three (3) recent"], ["references"], ["3 references"], ["业绩"]],
        },
        {
          factId: "FC-SOCIAL-VALUE",
          field: "submittal_requirements",
          description: "社会价值问卷占总分 10%，未提交计 0 分",
          expected: {
            kind: "text",
            value: "social value response worth up to 10%; failure to submit results in a social value score of zero",
            aliases: ["social value", "score of zero", "社会价值"],
          },
          critical: true,
          evidence: [ev(RFQ, [21], "The response to this questionnaire is worth up to 10% of the total bid score. Failure to submit a response to this questionnaire with your bid will result in a social value score of zero.")],
          matchAnchors: [["social value"], ["questionnaire"], ["社会价值"]],
        },
        {
          factId: "FC-SOCIAL-MEDIA",
          field: "scope",
          description: "社交媒体渠道不要求搜索能力",
          expected: {
            kind: "text",
            value: "search capabilities are not required for social media channels",
            aliases: ["not required for social media", "social media not required", "社交媒体"],
          },
          critical: false,
          evidence: [ev(RFQ, [19], "Search capabilities are not required for social media channels.")],
          matchAnchors: [["social media"], ["社交媒体"]],
        },
        {
          factId: "FC-LIVING-WAGE",
          field: "compliance",
          description: "适用供应商行为准则，但不含生活工资要求",
          expected: {
            kind: "text",
            value: "subject to all requirements of the supplier code of conduct not including living wage requirements",
            aliases: ["not including living wage", "living wage not applicable", "生活工资"],
          },
          critical: false,
          evidence: [ev(RFQ, [19], "the resulting contract is subject to all requirements of the Supplier Code of Conduct NOT INCLUDING Living Wage requirements")],
          matchAnchors: [["living wage"], ["code of conduct"], ["生活工资"]],
        },
        {
          factId: "FC-OPTION-PRICE",
          field: "pricing_instructions",
          description: "行使可选年时供应商可提交涨价；续期权在 HRM",
          expected: {
            kind: "text",
            value: "vendors will be provided an opportunity to submit an increase for option years if exercised",
            aliases: ["increase for option years", "option years", "可选年"],
          },
          critical: false,
          evidence: [ev(RFQ, [18], "Vendors will be provided an opportunity to submit an increase for option years if exercised. The option to extend is at the sole discretion of the municipality.")],
          matchAnchors: [["option years", "increase"], ["option year"], ["可选年"]],
        },
        {
          factId: "FC-DATA-RESIDENCY",
          field: "data_residency",
          description: "PO 隐私附表：未经书面指示不得在加拿大境外存储或访问个人信息",
          expected: {
            kind: "text",
            value: "must not store personal information outside canada or permit access to personal information from outside canada",
            aliases: ["outside canada", "piidpa", "data residency", "境外"],
          },
          critical: true,
          evidence: [ev(PO, [22], "Supplier must not store personal information outside Canada or permit access to personal information from outside Canada.")],
          matchAnchors: [["outside canada"], ["piidpa"], ["data residency"], ["personal information"], ["境外"]],
        },
        {
          factId: "FC-TERMINATION",
          field: "termination",
          description: "PO：HRM 可提前 30 天书面通知无因终止",
          expected: { kind: "text", value: "terminate the agreement without cause upon giving 30 days prior written notice", aliases: ["30 days", "without cause", "无因终止"] },
          critical: false,
          evidence: [ev(PO, [16], "HRM may, at its sole discretion, and at any time, terminate the Agreement without cause upon giving 30 days prior written notice of termination to Supplier.")],
          matchAnchors: [["30 days"], ["without cause"], ["terminat"], ["终止"]],
        },
      ],

      goldenRequirements: [
        { goldenId: "GR-DAILY", text: "The municipality requires media monitoring services on a daily basis, Monday to Friday, not including statutory holidays observed in Nova Scotia.", category: "mandatory_technical", mandatory: true, importance: "CRITICAL", evidence: [ev(RFQ, [18], "media monitoring services on a daily basis, Monday to Friday, not including statutory holidays observed in Nova Scotia")], matchAnchors: [["monday to friday"], ["daily", "monitoring"], ["statutory holiday"], ["周一"]] },
        { goldenId: "GR-0830", text: "The daily media monitoring information needs to be available to the municipality no later than 8:30 a.m., Atlantic Standard Time.", category: "mandatory_technical", mandatory: true, importance: "CRITICAL", evidence: [ev(RFQ, [19], "no later than 8:30 a.m., Atlantic Standard Time")], matchAnchors: [["8:30"]] },
        { goldenId: "GR-USERS", text: "User Access: access for a minimum of seven (7) staff members, with the possibility of adding more registered users as needed.", category: "mandatory_technical", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [19], "access for a minimum of seven (7) staff members")], matchAnchors: [["seven"], ["7", "user"], ["7", "staff"]] },
        { goldenId: "GR-UNIQUE-SIGNIN", text: "Unique sign-in for each user: all users will have individual sign-in credentials known only to them.", category: "mandatory_technical", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "all users will have individual sign-in credentials known only to them")], matchAnchors: [["sign-in"], ["credentials"], ["unique"]] },
        { goldenId: "GR-SEARCH", text: "Search capabilities: able to search and extract specific articles and transcripts as well as video and audio clips using key words generated by users; sources include TV, print, radio and emerging platforms such as podcasts and internet radio.", category: "mandatory_technical", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [19], "able to search and extract specific articles and transcripts as well as video and audio clips using key words generated by users")], matchAnchors: [["search", "extract"], ["transcript"], ["podcast"], ["audio clips"]] },
        { goldenId: "GR-NEWSLETTER", text: "Newsletter generation: daily media monitoring newsletter generated by the user and sent electronically to a distribution list (of approximately 250 email accounts), curated by categories determined by the municipality.", category: "mandatory_technical", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [19], "daily media monitoring newsletter shall be generated by the user and sent electronically to a distribution list (of approximately 250 emails accounts)")], matchAnchors: [["newsletter"], ["distribution list"], ["简报"]] },
        { goldenId: "GR-REPORTING", text: "Reporting: timely, user-friendly, customizable report generation via an online platform with comparison analytics (author, outlet, region, topic/keywords, reach/audience, sentiment) and tailored time-based comparisons.", category: "mandatory_technical", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [19], "Allows for comparison analytics of coverage based on multiple factors (e.g. author, outlet, region, topic/ keywords, reach/ audience, sentiment, etc.)")], matchAnchors: [["report"], ["analytics"], ["sentiment"]] },
        { goldenId: "GR-ONDEMAND", text: "Reporting functionality must be available on demand by staff and the vendor will provide assistance with report generation, as needed.", category: "mandatory_technical", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "Reporting functionality must be available on demand by staff and the vendor will provide assistance with report generation, as needed.")], matchAnchors: [["on demand"], ["assistance"]] },
        { goldenId: "GR-DUPLICATES", text: "Identify duplicates: if the same story appears in multiple outlets, the solution will indicate the multiple appearances so staff can remove duplicates prior to distribution of the daily newsletter.", category: "mandatory_technical", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "Identify duplicates: If the same story appears in multiple outlets, the solution will indicate the multiple appearances")], matchAnchors: [["duplicate"], ["重复"]] },
        { goldenId: "GR-SEARCH-CUSTOM", text: "Search customization: customizable, media-wide keyword and outlet-specific searches (by media type, geographic location, subject, timeframe, reporter and outlet).", category: "mandatory_technical", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "allow for customizable, media-wide keyword and outlet-specific searches")], matchAnchors: [["keyword"], ["outlet-specific"], ["customiz"]] },
        { goldenId: "GR-SUPPORT", text: "Ongoing support: the vendor will make available ongoing support and service, including ongoing enhancements reflecting advancements in the media monitoring industry.", category: "mandatory_technical", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "the vendor will make available ongoing support and service, including ongoing enhancements to the functionality of the solution")], matchAnchors: [["ongoing support"], ["enhancement"], ["support"]] },
        { goldenId: "GR-SUBMISSION", text: "Bids will only be received via upload to the Bids&Tenders Bidding System; only electronic bids; hardcopy submissions not permitted; late bids rejected.", category: "submission", mandatory: true, importance: "CRITICAL", evidence: [ev(RFQ, [3], "Bids shall not be submitted in any other manner."), ev(RFQ, [5], "Only electronic bids will be received by the Bidding System. Hardcopy submissions not permitted.")], matchAnchors: [["bids&tenders"], ["bidsandtenders"], ["electronic"], ["hardcopy"]] },
        { goldenId: "GR-SUPPLEMENTS", text: "Bidders must submit online through the Bids&Tenders Bidding System: Social Value Response, References, and any other information requested by HRM.", category: "submission", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [3, 4], ".1 Social Value Response .2 References .3 Any other information requested by HRM")], matchAnchors: [["social value"], ["references"]] },
        { goldenId: "GR-ADDENDA-ACK", text: "Bidders shall acknowledge receipt of any addenda through the Bidding System by checking a box for each addendum; a bid submitted before an addendum is issued is withdrawn to INCOMPLETE and must be re-submitted.", category: "submission", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [9], "Bidders shall acknowledge receipt of any addenda through the Bidding System by checking a box for each addenda and any applicable attachment.")], matchAnchors: [["addend"], ["补遗"]] },
        { goldenId: "GR-WCB", text: "HRM will verify, prior to award, that the Bidder is registered and in good standing with the Workers Compensation Board of Nova Scotia; bids from Bidders not in good standing may be rejected.", category: "eligibility", mandatory: true, importance: "CRITICAL", evidence: [ev(RFQ, [8], "registered and in good standing with the Workers Compensation Board of Nova Scotia")], matchAnchors: [["wcb"], ["workers compensation"], ["workers’ compensation"]] },
        { goldenId: "GR-SAFETY-CERT", text: "Within 5 Working Days after written acceptance, upon request provide a WCB-approved safety certificate or letter of good standing, certificates of insurance as required by the Contract, and other documentation.", category: "eligibility", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [4], "Within 5 Working Days after receiving written acceptance of its bid from HRM, the successful Bidder shall, upon request, provide HRM with: .1 a safety certificate issued by an occupational health and safety organization approved by the Workers’ Compensation Board (WCB)")], matchAnchors: [["safety certificate"], ["letter of good standing"], ["5 working days"]] },
        { goldenId: "GR-PRICE-CAD", text: "Prices in Canadian Funds DDP Destination; bid price includes all taxes and customs duties except HST.", category: "commercial", mandatory: true, importance: "CRITICAL", evidence: [ev(RFQ, [21], "Prices must be in Canadian Funds DDP (Delivered Duty Paid) Destination"), ev(RFQ, [4], "except for Harmonized Sales Tax (HST)")], matchAnchors: [["canadian"], ["ddp"], ["hst"], ["加元"]] },
        { goldenId: "GR-VALIDITY", text: "A Quotation is an irrevocable offer and must remain valid and open for acceptance for 60 days from the closing time and date.", category: "commercial", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [21], "A Quotation must remain valid and open to be accepted for 60 days from the closing time and date.")], matchAnchors: [["60 days"], ["irrevocable"], ["60 天"]] },
        { goldenId: "GR-BIDFORM-SIGN", text: "Bidders shall complete the Bid Form per entity type (incorporated company / joint venture / partnership / sole proprietorship) with authorized signatures.", category: "submission", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [5], "Bidders shall complete the Bid Form as follows: .1 Incorporated Company: Provide company name and the name and signature of the duly authorized signing representative(s).")], matchAnchors: [["bid form"], ["authorized"], ["signature"]] },
        { goldenId: "GR-NO-CONTACT", text: "No lobbying; bidders shall not contact HRM employees/officials regarding this RFQ except through the Bids&Tenders e-sourcing solution; breach may disqualify.", category: "compliance", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [11], "proponents and their representatives are not permitted to contact any employees, officers, agents, elected or appointed officials or other representatives of the Municipality regarding the subject matter of this RFQ")], matchAnchors: [["lobby"], ["not permitted to contact"], ["conflict of interest"]] },
        { goldenId: "GR-CODE-CONDUCT", text: "The Successful Bidder is subject to HRM's Supplier Code of Conduct (living wage requirements not applicable to this service).", category: "compliance", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [19], "the resulting contract is subject to all requirements of the Supplier Code of Conduct NOT INCLUDING Living Wage requirements")], matchAnchors: [["code of conduct"], ["行为准则"]] },
        { goldenId: "GR-NATIONALITY-DECL", text: "Bidders shall declare the nationality of the bidder (US company as defined: HQ in US and ≥70% employees there); answer the US-company question in the bid form.", category: "submission", mandatory: true, importance: "HIGH", evidence: [ev(RFQ, [7], "When HRM is soliciting for services, bidders shall declare where the nationality of the bidder based on the following definitions."), ev(RFQ, [23], "Are you a US company as defined in the bid documents and instructions")], matchAnchors: [["nationality"], ["us company"], ["country of origin"], ["国籍"]] },
        { goldenId: "GR-PIIDPA", text: "Supplier must comply with PIIDPA and the Privacy Protection Schedule: not store personal information outside Canada or permit access from outside Canada unless directed in writing.", category: "compliance", mandatory: true, importance: "CRITICAL", evidence: [ev(PO, [22], "Supplier must not store personal information outside Canada or permit access to personal information from outside Canada.")], matchAnchors: [["piidpa"], ["outside canada"], ["personal information"], ["境外"]] },
        { goldenId: "GR-INVOICE-HST", text: "Supplier shall separately itemize HST on each invoice and indicate its applicable tax registration number(s).", category: "commercial", mandatory: true, importance: "NORMAL", evidence: [ev(PO, [6], "Supplier shall separately itemize HST on each invoice and indicate on each invoice its applicable tax registration number(s).")], matchAnchors: [["invoice", "hst"], ["tax registration"]] },
        { goldenId: "GR-BUSINESS-REG", text: "Provide Business Registration Number/Tax ID in the bid form; proof of business registration may be required after closing.", category: "submission", mandatory: true, importance: "NORMAL", evidence: [ev(RFQ, [21], "Business Registration: Please provide your Business Registration Number/Tax ID"), ev(RFQ, [4], "proof of business registration in accordance with applicable laws")], matchAnchors: [["business registration"], ["tax id"]] },
      ],

      knownAmbiguities: [
        {
          ambiguityId: "AM-INSURANCE",
          description: "RFQ 第 5 节 1.4 保险「Not Applicable」 vs PO T&C §13 要求 CGL/车辆/非自有车辆/专业责任最低保险——是否需投保、限额多少不明确",
          expected: "CLARIFICATION_REQUIRED",
          evidence: [ev(RFQ, [17], ".1 Not Applicable END OF SECTION 5"), ev(PO, [14], "(i) commercial general liability insurance; (ii) automobile liability insurance; (iii) non-owned automobile liability insurance; and (iv) professional liability insurance (if applicable to the Services)")],
          matchAnchors: [["insurance"], ["保险"]],
        },
        {
          ambiguityId: "AM-TERM-DATES",
          description: "「one (1) year」与「commence upon award and finish on October 31, 2027」、现任合同 2026-11-01 到期三者相互不完全自洽：首期实际起止与长度不明",
          expected: "FLAGGED",
          evidence: [ev(RFQ, [18], "Agreement will commence upon award and finish on October 31, 2027.")],
          matchAnchors: [["october 31, 2027"], ["one (1) year"], ["commence upon award"], ["合同期"]],
        },
      ],

      goldenRisks: [
        { riskId: "RK-US-NATIONALITY", severity: "CRITICAL", description: "国籍项占 10%：美国供应商（美国总部且 ≥70% 员工在美）得 0 分；美企加拿大子公司须在加有常设机构且 ≥70% 合同工作由加籍员工完成才视为加方", evidence: [ev(RFQ, [8], "American suppliers as defined above will receive none of the available points.")], matchAnchors: [["american"], ["u.s."], ["us supplier"], ["nationality"], ["美国"]] },
        { riskId: "RK-PERF-60", severity: "IMPORTANT", description: "无 HRM 历史绩效评估的新供应商绩效项只得 60%，而有良好历史的现任供应商可得更高——结构性劣势", evidence: [ev(RFQ, [7], "will receive 60% of the available points (“meets expectations”)")], matchAnchors: [["60%"], ["performance evaluation"], ["meets expectations"], ["绩效"]] },
        { riskId: "RK-DATA-RESIDENCY", severity: "CRITICAL", description: "PO 隐私附表：个人信息不得在加拿大境外存储/访问——对境外托管的 SaaS 媒体监测平台是合规硬门", evidence: [ev(PO, [22], "Supplier must not store personal information outside Canada or permit access to personal information from outside Canada.")], matchAnchors: [["outside canada"], ["piidpa"], ["data residency"], ["境外"], ["personal information"]] },
        { riskId: "RK-INSURANCE-CONFLICT", severity: "IMPORTANT", description: "RFQ 保险 NA 与 PO §13 最低保险清单冲突；投标价须「已计入保险与赔偿要求」（p25）", evidence: [ev(RFQ, [25], "it has factored all of the applicable Form of Agreement/Contract Terms and Conditions, including insurance and indemnity requirements, into its pricing assumptions and calculations")], matchAnchors: [["insurance"], ["保险"]] },
        { riskId: "RK-ADDENDA-WITHDRAW", severity: "IMPORTANT", description: "补遗发布后，已提交的投标被系统撤回为 INCOMPLETE，须确认补遗并在截标前重新提交，否则视为未投", evidence: [ev(RFQ, [9], "the Bidding System shall WITHDRAW the Bid submission and the bid status will change to an INCOMPLETE STATUS and Withdraw the Bid")], matchAnchors: [["addend", "withdraw"], ["incomplete"], ["addend"], ["补遗"]] },
        { riskId: "RK-TERMINATION-30D", severity: "IMPORTANT", description: "PO：HRM 可 30 天通知无因终止——多年期收入不可假定锁定", evidence: [ev(PO, [16], "terminate the Agreement without cause upon giving 30 days prior written notice of termination to Supplier")], matchAnchors: [["30 days"], ["without cause"], ["terminat"], ["终止"]] },
        { riskId: "RK-PRICE-DISCLOSURE", severity: "IMPORTANT", description: "报价可依信息公开法披露并与其他公共机构共享；且中标方须按相同价格条件向其他大西洋省公共机构供货（1.20）", evidence: [ev(RFQ, [10], "the successful proponent agrees to make its goods and services available to the other public sector entity upon the same pricing, terms and conditions as those provided to HRM")], matchAnchors: [["public sector"], ["disclos"], ["freedom of information"], ["same pricing"]] },
        { riskId: "RK-IP-ASSIGNMENT", severity: "IMPORTANT", description: "PO §10：履约产生的 Work Product 知识产权归 HRM（供应商既有 IP 除外）——SaaS 供应商须界定既有 IP", evidence: [ev(PO, [10], "with the exception of any pre-existing intellectual property rights of the")], matchAnchors: [["intellectual property"], ["work product"], ["知识产权"]] },
        { riskId: "RK-NEGOTIATION-15", severity: "IMPORTANT", description: "若 best value 报价超出 HRM 内部估算 15%，HRM 可协商削减范围、邀前 3 名重新报价或重新招标", evidence: [ev(RFQ, [8], "If the bid determined by HRM to represent the best value has a bid price within 15% of the estimated contract value, HRM may choose to proceed with one of the following")], matchAnchors: [["15%"], ["estimated contract value"], ["negotiat"], ["re-bid"]] },
      ],

      goldenClarifications: [
        { clarId: "CL-QUESTION-DEADLINE", topic: "提问截止时间（文件只说经 Submit a Question 按钮提交，未给截止日）", necessity: "NECESSARY", answeredInDocument: false, evidence: [ev(RFQ, [9], "Questions related to this procurement are to be submitted to the Purchasing representative through the Bidding System only by clicking on the “Submit a Question” button")], matchAnchors: [["question"], ["deadline"], ["inquir"], ["提问"]] },
        { clarId: "CL-INCUMBENT", topic: "现任供应商身份与现合同年费（文件只给服务起止时间）", necessity: "NECESSARY", answeredInDocument: false, evidence: [ev(RFQ, [18], "The municipality has been using a vendor to conduct media monitoring since November 2021.")], matchAnchors: [["incumbent"], ["current vendor"], ["current supplier"], ["contract value"], ["现任"]] },
        { clarId: "CL-INSURANCE", topic: "PO §13 保险要求对本 RFQ 是否适用、限额多少（RFQ 写 Not Applicable）", necessity: "NECESSARY", answeredInDocument: false, evidence: [ev(RFQ, [17], ".1 Not Applicable END OF SECTION 5")], matchAnchors: [["insurance"], ["保险"]] },
        { clarId: "CL-ESTIMATE", topic: "HRM 内部估算合同价 / 预算（1.16.12 以「estimated contract value」为协商触发，但未披露）", necessity: "USEFUL", answeredInDocument: false, evidence: [ev(RFQ, [8], "has a bid price within 15% of the estimated contract value")], matchAnchors: [["estimated contract value"], ["budget"], ["预算"]] },
        { clarId: "CL-DATA-HOSTING", topic: "境外云托管的媒体内容（非个人信息）是否受 PIIDPA/隐私附表限制；用户账号信息驻留要求", necessity: "NECESSARY", answeredInDocument: false, evidence: [ev(PO, [22], "Supplier must not store personal information outside Canada")], matchAnchors: [["hosting"], ["outside canada"], ["data residency"], ["cloud"], ["境外"]] },
        { clarId: "CL-SOCIAL-MEDIA", topic: "社交媒体是否在监测范围内——文件已明确搜索能力不要求覆盖社交媒体", necessity: "USEFUL", answeredInDocument: true, evidence: [ev(RFQ, [19], "Search capabilities are not required for social media channels.")], matchAnchors: [["social media"], ["社交媒体"]] },
        { clarId: "CL-OPTION-PRICING", topic: "可选年是否允许调价——文件已明确行使时可提交涨价", necessity: "USEFUL", answeredInDocument: true, evidence: [ev(RFQ, [18], "Vendors will be provided an opportunity to submit an increase for option years if exercised.")], matchAnchors: [["option year"], ["increase"], ["可选年"]] },
      ],

      expectedUnknowns: [
        { field: "enquiry_deadline", description: "文件未给提问截止日（门户上的 8/28 不在文件里）", forbiddenClaimAnchors: [["august 28"], ["aug 28"], ["8月28"], ["2026-08-28"]] },
        { field: "incumbent_name", description: "现任供应商未具名（Meltwater 为调查室人工线索，不在文件里）", forbiddenClaimAnchors: [["meltwater"], ["cision"], ["agility pr"]] },
        { field: "insurance_limits", description: "两份文件均未给保险限额金额", forbiddenClaimAnchors: [["$2,000,000"], ["$5,000,000"], ["$1,000,000"], ["2,000,000"], ["5,000,000"]] },
        { field: "estimated_contract_value", description: "HRM 内部估算/预算未披露", forbiddenClaimAnchors: [["estimated contract value", "$"], ["预算", "$"], ["budget", "$"]] },
      ],

      hallucinationProbes: [["backpack"], ["roller shade"], ["window covering"], ["cadet"], ["curtain"]],

      notes:
        "首个服务类/SaaS 真实原件 case。覆盖批次二新槽位（现任供应商未具名、评分权重与成本公式）与 PO 服务条款风险（数据驻留/IP/无因终止）。截标 2026-09-08 14:00 Atlantic；文件未给提问截止与现任名称——均为 unsupported-claim 探针。",
    };
  },
};
