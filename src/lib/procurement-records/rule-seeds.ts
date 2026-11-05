/**
 * PROC-1 机关申请规则种子（纯数据，无 DB 依赖；由 rules.ts 的 ensureDefaultRules 写入组织）。
 *
 * 纪律：
 * - 种子一律 UNVERIFIED；只有 org_admin 及以上真实用户打开官方页面核对后才是 VERIFIED（READY 闸只认 VERIFIED）。
 * - 种子不预填官方提交入口（officialPortalUrl = null）：入口必须由核实人亲自打开后填写。
 * - 未知费用为 null，不按 0 处理；0 只表示来源写明「免费」。
 * - 每条种子带来源（sourceRefs）与种子依据（seedBasis → verificationMethod），界面原样展示。
 *
 * 来源性质：
 * - 联邦：任务书「官方参考」S1 / S2 / S3 / S5 / S9（核实基准日 2026-11-05）。
 * - 安省 / 多伦多 / BC / 曼省 / 魁省 / 阿省：2026-11-05 网络检索摘要（开发会话的网络策略不允许打开这些官方站点），
 *   数值已按多个来源交叉，但**未在官方页面逐字核对**；冲突或不确定处在 otherFeesRule 写明「须核对」。
 * - 萨省：占位（费用 / 时限 / 入口均为 null，不支持自助）。
 */

import { normalizeInstitutionKey } from "./identity";

export const RULE_CHANNELS = ["FORMAL_ONLINE", "FORMAL_MAIL", "FORMAL_EMAIL", "INFORMAL_COPY"] as const;
export type RuleChannel = (typeof RULE_CHANNELS)[number];

export const RULE_DEADLINE_UNITS = ["CALENDAR_DAYS", "BUSINESS_DAYS"] as const;
export type RuleDeadlineUnit = (typeof RULE_DEADLINE_UNITS)[number];

export function ruleChannelFor(channel: string): RuleChannel {
  return channel === "INFORMAL" ? "INFORMAL_COPY" : "FORMAL_ONLINE";
}

/** 我方字段 → 门户字段的对应（门户字段名未观察前一律 observed=false） */
export const OUR_FIELDS = [
  "申请人 / 公司法定名称",
  "代表人姓名",
  "地址",
  "邮箱",
  "接收机关",
  "申请正文（英文）",
  "记录期间（起止日）",
  "希望的记录格式（电子 / CSV / XLSX）",
  "申请费支付",
];

export function fieldGuide() {
  return OUR_FIELDS.map((ourField) => ({ ourField, portalLabel: null, observed: false, observedAt: null, observedById: null }));
}

export interface RuleSourceRef {
  label: string;
  url: string;
}

export interface RuleSeed {
  jurisdiction: string;
  institutionKey: string;
  channel: RuleChannel;
  lawLabel: string;
  guidanceUrl: string | null;
  applicationFeeCents: number | null;
  currency: string | null;
  otherFeesRule: string | null;
  deadlineValue: number | null;
  deadlineUnit: RuleDeadlineUnit | null;
  /** 时限 / 费用规则的适用起始日（YYYY-MM-DD）；未知为 null */
  effectiveFrom: string | null;
  selfServeSupported: boolean;
  sourceRefs: RuleSourceRef[];
  /** 写入 verificationMethod：说明种子数值从哪里来、为什么仍未核实 */
  seedBasis: string;
}

const BASIS_TASKBRIEF = "种子：任务书引用的官方来源（核实基准日 2026-11-05），尚未由用户核对官方页面";
const BASIS_WEB_SUMMARY =
  "种子：2026-11-05 网络检索摘要交叉整理（开发会话无法打开官方站点），尚未由用户在官方页面逐字核对；数值以官方页面为准";
const BASIS_PLACEHOLDER = "占位：尚未整理来源；费用、时限、入口均未知";

/** 多伦多市政府（MFIPPA 机关）的规范机构键；与 identity.ts 别名表一致 */
export const TORONTO_INSTITUTION_KEY = normalizeInstitutionKey("City of Toronto").key;

const FED = {
  S1: { label: "S1 联邦申请资格、费用和时限", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/how-access-information-personal-information-requests-work.html" },
  S2: { label: "S2 Access to Information Act 概述（仅保留 CAD 5 申请费）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information-act.html" },
  S3: { label: "S3 Completed Access to Information Requests", url: "https://search.open.canada.ca/ati/" },
  S5: { label: "S5 官方申请准备要求（从此核实最新入口、账号与支付条件）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/request-information/what-you-will-need.html" },
  S9: { label: "S9 联邦请求处理手册（实际期限计算前查对应条款）", url: "https://www.canada.ca/en/treasury-board-secretariat/services/access-information-privacy/access-information/access-information-manual.html" },
};

const ON = {
  how: { label: "安省：如何提出 FOI 申请（ontario.ca）", url: "https://www.ontario.ca/page/how-make-freedom-information-request" },
  fees: { label: "安省 FOI 与隐私手册：费用（ontario.ca）", url: "https://www.ontario.ca/document/freedom-information-and-privacy-manual/fees" },
  ipcNotice: { label: "IPC 安省：FIPPA / MFIPPA 2026 修订通知（Bill 97）", url: "https://www.ipc.on.ca/en/node/4283" },
  ipcFees: { label: "IPC 安省：费用与豁免说明（2026-08 版）", url: "https://www.ipc.on.ca/sites/default/files/documents/IB0001E-2026-08-fees-and-fee-waivers.pdf" },
  torontoHow: { label: "多伦多市：如何提交 FOI 申请（toronto.ca）", url: "https://www.toronto.ca/city-government/accountability-operations-customer-service/access-city-information-or-records/freedom-of-information/how-to-submit-an-foi-request" },
  torontoFees: { label: "多伦多市：FOI 收费表（toronto.ca）", url: "https://www.toronto.ca/city-government/accountability-operations-customer-service/access-city-information-or-records/freedom-of-information/fee-schedule-for-foi-requests/" },
};

const BC = {
  overview: { label: "BC：向政府申请记录（gov.bc.ca FOI）", url: "https://www2.gov.bc.ca/gov/content/governments/about-the-bc-government/open-government/open-information/freedom-of-information" },
  fees: { label: "BC：FOI 申请费用（gov.bc.ca）", url: "https://www2.gov.bc.ca/gov/content/governments/about-the-bc-government/open-government/open-information/freedom-of-information/11936" },
  expect: { label: "BC：FOI 申请流程与时限（gov.bc.ca）", url: "https://www2.gov.bc.ca/gov/content/governments/about-the-bc-government/open-government/open-information/freedom-of-information/11953" },
};

const MB = {
  faq: { label: "曼省：FIPPA 常见问题（gov.mb.ca）", url: "https://www.gov.mb.ca/fippa/public/faq.html" },
  amend: { label: "曼省：FIPPA 修订说明（Bill 49，2022-01-01 生效）", url: "https://www.gov.mb.ca/fippa/amend_detail.html" },
  form: { label: "曼省：FIPPA 申请表（PDF）", url: "https://www.manitoba.ca/fippa/pdfs/fippa_appform.pdf" },
  portal: { label: "曼省：部分部门的在线申请门户（forms.gov.mb.ca）", url: "https://forms.gov.mb.ca/fippa/" },
};

const QC = {
  gov: { label: "魁省：Accès à l'information（quebec.ca）", url: "https://www.quebec.ca/acces-a-linformation/" },
  law: { label: "魁省：Loi sur l'accès（LégisQuébec，A-2.1）", url: "https://www.legisquebec.gouv.qc.ca/fr/document/lc/A-2.1" },
  cai: { label: "魁省：Commission d'accès à l'information", url: "https://www.cai.gouv.qc.ca/" },
};

const AB = {
  gov: { label: "阿省：Access to information requests（alberta.ca）", url: "https://www.alberta.ca/access-to-information-requests" },
  fees: { label: "阿省：Fees for ATI Services Standard（政府费用标准 PDF）", url: "https://imtpolicy.sp.alberta.ca/standards/pdf/Fees-for-ATI-Services-Standard.pdf" },
  oipc: { label: "阿省 OIPC：Order ATIA2026-01（引用初始费条款）", url: "https://oipc.ab.ca/wp-content/uploads/2026/02/Order-ATIA2026-01.pdf" },
};

export const DEFAULT_RULE_SEEDS: RuleSeed[] = [
  {
    jurisdiction: "CA-FED",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Access to Information Act (Canada)",
    guidanceUrl: FED.S5.url,
    applicationFeeCents: 500,
    currency: "CAD",
    otherFeesRule: "现行制度只收 CAD 5 申请费，取消了申请费以外的其他费用（S2）；不得套用省级检索 / 处理费模板",
    deadlineValue: 30,
    deadlineUnit: "CALENDAR_DAYS",
    effectiveFrom: null,
    selfServeSupported: true,
    sourceRefs: [FED.S1, FED.S2, FED.S5, FED.S9],
    seedBasis: BASIS_TASKBRIEF,
  },
  {
    jurisdiction: "CA-FED",
    institutionKey: "*",
    channel: "INFORMAL_COPY",
    lawLabel: "Completed ATI requests — informal copy of previously released records",
    guidanceUrl: FED.S3.url,
    applicationFeeCents: 0,
    currency: "CAD",
    otherFeesRule: "既有披露副本可通过官方机制免费索取（S3）；发出索取仍是对外申请；非正式请求不适用正式申请的法定时限",
    deadlineValue: null,
    deadlineUnit: null,
    effectiveFrom: null,
    selfServeSupported: true,
    sourceRefs: [FED.S3],
    seedBasis: BASIS_TASKBRIEF,
  },
  {
    jurisdiction: "CA-ON",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Freedom of Information and Protection of Privacy Act (Ontario), R.S.O. 1990, c. F.31 — 省级机关",
    guidanceUrl: ON.how.url,
    applicationFeeCents: 500,
    currency: "CAD",
    otherFeesRule:
      "申请费 $5（不退）。处理费按 R.R.O. 1990, Reg. 460：人工检索每 15 分钟 $7.50、准备记录每 15 分钟 $7.50、复印 / 打印每页 $0.20；" +
      "费用较高时机关先出费用估算（估算门槛各来源写法不一：$25 或 $100，须核对），估算 ≥ $100 可要求先付 50% 押金；2026-07-01 起费用估算会暂停答复计时。" +
      "时限：2026-07-01 起收到的完整申请为 45 个工作日（Bill 97）；此前收到的仍按 30 个日历日。" +
      "市政府、学区、警察服务等市级机关适用 MFIPPA（另一部法律），不适用本条：多伦多市已单独建规则，其他市级机关须另行核实。",
    deadlineValue: 45,
    deadlineUnit: "BUSINESS_DAYS",
    effectiveFrom: "2026-07-01",
    selfServeSupported: true,
    sourceRefs: [ON.how, ON.fees, ON.ipcNotice, ON.ipcFees],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-ON",
    institutionKey: TORONTO_INSTITUTION_KEY,
    channel: "FORMAL_ONLINE",
    lawLabel: "Municipal Freedom of Information and Protection of Privacy Act (Ontario), R.S.O. 1990, c. M.56 — City of Toronto",
    guidanceUrl: ON.torontoHow.url,
    applicationFeeCents: 500,
    currency: "CAD",
    otherFeesRule:
      "申请费 $5（不退）。处理费按 R.R.O. 1990, Reg. 823 与多伦多市收费表（与省级大体相同，须核对）。" +
      "时限：2026-07-01 起收到的完整申请为 45 个工作日（Bill 97，MFIPPA 同步修订）；此前收到的仍按 30 个日历日。" +
      "TTC、多伦多警察服务、TCHC 等市属机构各自受理 FOI，不适用本条。",
    deadlineValue: 45,
    deadlineUnit: "BUSINESS_DAYS",
    effectiveFrom: "2026-07-01",
    selfServeSupported: true,
    sourceRefs: [ON.torontoHow, ON.torontoFees, ON.ipcNotice],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-BC",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Freedom of Information and Protection of Privacy Act (British Columbia), RSBC 1996, c. 165",
    guidanceUrl: BC.overview.url,
    applicationFeeCents: 1000,
    currency: "CAD",
    otherFeesRule:
      "一般（非个人）申请向每个所选机关各收 $10 申请费，不退、不可豁免；法定时限在付清申请费后才起算。" +
      "处理费按 Schedule of Maximum Fees：检索与调取前 3 小时免费，之后每 15 分钟 $7.50；准备、运送、复制另计，超出免费时长前机关先出估算。" +
      "市政府、学区等地方公共机构的收费做法可能不同，须对该机关单独核对。",
    deadlineValue: 30,
    deadlineUnit: "BUSINESS_DAYS",
    effectiveFrom: null,
    selfServeSupported: true,
    sourceRefs: [BC.overview, BC.fees, BC.expect],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-MB",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "The Freedom of Information and Protection of Privacy Act (Manitoba), C.C.S.M. c. F175",
    guidanceUrl: MB.faq.url,
    applicationFeeCents: 0,
    currency: "CAD",
    otherFeesRule:
      "提出申请不收费；检索与准备前 2 小时免费，之后每半小时 $15（Access and Privacy Regulation，须核对现行版本）；复制费另计。" +
      "收到费用估算后 30 日内不答复，机关可视为放弃申请。时限 45 个日历日（Bill 49，2022-01-01 起；此前为 30 日），机关可依法再延长。" +
      "部分省政府部门改用在线门户（forms.gov.mb.ca/fippa），其余用 FIPPA 申请表交给该机关的 access and privacy coordinator。",
    deadlineValue: 45,
    deadlineUnit: "CALENDAR_DAYS",
    effectiveFrom: "2022-01-01",
    selfServeSupported: true,
    sourceRefs: [MB.faq, MB.amend, MB.form, MB.portal],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-QC",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Loi sur l'accès aux documents des organismes publics et sur la protection des renseignements personnels (RLRQ, c. A-2.1)",
    guidanceUrl: QC.gov.url,
    applicationFeeCents: 0,
    currency: "CAD",
    otherFeesRule:
      "提出申请免费；转录、复制、传送费可按 Règlement sur les frais exigibles（A-2.1, r. 3）收取，由机关决定（现行金额须核对）。" +
      "申请交给该机关的 responsable de l'accès aux documents；市政机关同样适用本法；正文通常用法语书写。" +
      "时限：收到后 20 日（日历日），机关可在期满前书面通知再延长至多 10 日；逾期未答复视为拒绝，可在 30 日内向 Commission d'accès à l'information 申请复核。",
    deadlineValue: 20,
    deadlineUnit: "CALENDAR_DAYS",
    effectiveFrom: null,
    selfServeSupported: true,
    sourceRefs: [QC.gov, QC.law, QC.cai],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-AB",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "Access to Information Act (Alberta) — 2025-06-11 起取代 FOIP Act",
    guidanceUrl: AB.gov.url,
    applicationFeeCents: 2500,
    currency: "CAD",
    otherFeesRule:
      "一般（非个人）申请初始费 $25（持续性申请 $50；个别机关表格写 $50，须核对）。预计处理费超过 $150 时可按 AR 133/2025 Schedule 1 另收处理费，通常先付 50% 押金；" +
      "复制费在预计超过 $10 时按实际成本收取。省政府多数机关可用 Alberta.ca 账号在线申请；市政府、学区等地方公共机构各自受理。",
    deadlineValue: 30,
    deadlineUnit: "BUSINESS_DAYS",
    effectiveFrom: "2025-06-11",
    selfServeSupported: true,
    sourceRefs: [AB.gov, AB.fees, AB.oipc],
    seedBasis: BASIS_WEB_SUMMARY,
  },
  {
    jurisdiction: "CA-SK",
    institutionKey: "*",
    channel: "FORMAL_ONLINE",
    lawLabel: "The Freedom of Information and Protection of Privacy Act (Saskatchewan)",
    guidanceUrl: null,
    applicationFeeCents: null,
    currency: "CAD",
    otherFeesRule: "省 / 市费用（含检索、处理费）与时限须分别核实；不得套用联邦规则",
    deadlineValue: null,
    deadlineUnit: null,
    effectiveFrom: null,
    selfServeSupported: false,
    sourceRefs: [],
    seedBasis: BASIS_PLACEHOLDER,
  },
];
