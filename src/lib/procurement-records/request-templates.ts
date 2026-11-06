/**
 * PROC-1 申请正文模板与自助提交指引（纯函数、客户端安全：不引入 node:crypto / DB）。
 *
 * - 联邦正文（Access to Information Act）仍由 request-pure.buildFederalAtiBody 生成（任务书第七节逐字模板）。
 * - 省市正文按适用法律分模板：安省 FIPPA / MFIPPA、BC FIPPA、曼省 FIPPA、阿省 ATIA、萨省 FOIP / LA FOIP 为英文；
 *   魁省 Loi sur l'accès（A-2.1）为法文。方括号占位符只由已核实数据替换，缺数据时保留（READY 闸拦截）。
 * - 指引只描述「你在官方渠道怎么做」：青砚不登录、不填表、不付款、不代交；金额与时限一律指向规则卡片
 *   （规则未核实时以官方页面为准），指引本身不当作已核实事实。
 */

import { RECORD_CATEGORIES, type RecordCategory } from "./labels";

export type RequestLawKey =
  | "FED_ATIA"
  | "ON_FIPPA"
  | "ON_MFIPPA"
  | "BC_FIPPA"
  | "MB_FIPPA"
  | "AB_ATIA"
  | "SK_FOIP"
  | "SK_LAFOIP"
  | "QC_ACCES";

export type BodyLanguage = "en" | "fr";

export interface RequestBodyInput {
  institution: string | null;
  projectTitle: string | null;
  solicitationNumbers: string[];
  contractNumbers: string[];
  startDate: string | null;
  endDate: string | null;
  categories: RecordCategory[];
}

/** 由辖区 + 规则法律名判定适用法律；OTHER 或无法判定 → null（正文由用户填写） */
export function resolveRequestLaw(jurisdiction: string, ruleLawLabel: string | null | undefined): RequestLawKey | null {
  const label = ruleLawLabel ?? "";
  switch (jurisdiction) {
    case "CA-FED":
      return "FED_ATIA";
    case "CA-ON":
      return /^Municipal\b|MFIPPA/i.test(label) ? "ON_MFIPPA" : "ON_FIPPA";
    case "CA-BC":
      return "BC_FIPPA";
    case "CA-MB":
      return "MB_FIPPA";
    case "CA-AB":
      return "AB_ATIA";
    case "CA-SK":
      return /Local Authority|LA FOIP/i.test(label) ? "SK_LAFOIP" : "SK_FOIP";
    case "CA-QC":
      return "QC_ACCES";
    default:
      return null;
  }
}

interface LawProfile {
  actName: string;
  bodyLanguage: BodyLanguage;
  /** 正文里对机关的称谓（各省法律用语不同） */
  bodyTerm: string;
  levelZh: string;
  portalZh: string;
  requestTypeZh: string;
  feeZh: string;
  receiptZh: string;
  followUpZh: string;
  cautionsZh: string[];
}

const LAW_PROFILES: Record<RequestLawKey, LawProfile> = {
  FED_ATIA: {
    actName: "Access to Information Act",
    bodyLanguage: "en",
    bodyTerm: "institution",
    levelZh: "按所需记录确定资料持有机关：发出 call-up 并付款的机关可能不是 PSPC；在申请卡写明持有依据。",
    portalZh: "从规则卡片里经核实的官方入口（ATIP Online Request Service）进入，选择该机关。",
    requestTypeZh: "选择 Access to Information（不是 Personal Information / Privacy）。",
    feeZh: "在线支付申请费（金额见规则卡片）；联邦制度不收申请费以外的处理费。",
    receiptZh: "保存确认页与确认邮件（含 request number、机关、提交日期、付款确认）。",
    followUpZh: "正常时限 30 个日历日（系统给出估算期限，标「估算」），机关可依法延期；延期、澄清、转交通知都登记为来信。对处理不服可向 Information Commissioner 投诉。",
    cautionsZh: ["同一范围已有 Completed ATI 既有披露时，先索取副本，不要重复正式申请。"],
  },
  ON_FIPPA: {
    actName: "Freedom of Information and Protection of Privacy Act (Ontario)",
    bodyLanguage: "en",
    bodyTerm: "institution",
    levelZh: "接收机关是省级部委或机构（含医院、大学、学院）→ 适用 FIPPA。市政府、学区、警察服务、市属公司 → 适用 MFIPPA，应改用市级规则（多伦多市已有专属规则）后再按模板重新生成。",
    portalZh: "从规则卡片里经核实的官方入口进入：多数省级机关在 ontario.ca 提供在线 FOI 申请表，个别机关仍用纸质 / 邮件表格。在线表单可能不能上传附件，正文直接粘贴到申请描述栏。",
    requestTypeZh: "选择「一般记录 / general records」（不是本人个人信息，也不是更正申请）。",
    feeZh: "支付申请费（金额见规则卡片；未核实时以官方页面为准，不退）。检索、准备、复印另有处理费：机关会先发费用估算，估算较大时可能要求先付押金；收到估算后可以缩小范围再决定。2026-07-01 起费用估算期间暂停答复计时。",
    receiptZh: "保存确认邮件或确认页（含机关、申请编号、提交日期、已付金额）。",
    followUpZh: "2026-07-01 起收到的完整申请，答复时限为 45 个工作日（系统不估算工作日到期日，以机关确认信为准）；机关可依法延期。收到延期、费用估算、澄清请求时登记为来信。对决定不服可向 IPC 安省上诉（另收上诉费，有期限）。",
    cautionsZh: ["FIPPA 与 MFIPPA 是两部法律：机关属于市级时，先换用市级规则再重新生成正文。"],
  },
  ON_MFIPPA: {
    actName: "Municipal Freedom of Information and Protection of Privacy Act (Ontario)",
    bodyLanguage: "en",
    bodyTerm: "institution",
    levelZh: "接收机关是市政府、学区、警察服务或市属机构 → 适用 MFIPPA。多伦多市政府本身有专属规则；TTC、多伦多警察服务、TCHC 等各自受理，需要另行核实规则。",
    portalZh: "多伦多市：从规则卡片里经核实的 toronto.ca FOI 入口提交在线申请；其他市级机关看各自官网的 Access / FOI 页面（常见为在线表单或电邮表格）。",
    requestTypeZh: "选择「一般记录 / general records」（不是本人个人信息）。",
    feeZh: "支付申请费（金额见规则卡片；不退）。处理费按市级规定与机关收费表，机关先发费用估算；2026-07-01 起费用估算期间暂停答复计时。",
    receiptZh: "保存确认邮件或确认页（含机关、申请编号、提交日期、已付金额）。",
    followUpZh: "2026-07-01 起收到的完整申请，答复时限为 45 个工作日（系统不估算工作日到期日）；机关可依法延期。来信登记到青砚。对决定不服可向 IPC 安省上诉。",
    cautionsZh: ["市属机构（TTC、警察、TCHC 等）不是多伦多市政府本身：申请前确认接收机关。"],
  },
  BC_FIPPA: {
    actName: "Freedom of Information and Protection of Privacy Act (British Columbia)",
    bodyLanguage: "en",
    bodyTerm: "public body",
    levelZh: "省政府部委与大多数公共机构（含市政府、学区、卫生局等地方公共机构）都适用 FIPPA；地方公共机构的入口与收费各自不同。",
    portalZh: "省政府部委：从规则卡片里经核实的 gov.bc.ca FOI 在线申请进入并选择机关；地方公共机构：用其官网的 FOI 表格或指定邮箱。",
    requestTypeZh: "选择 General（一般 / 非个人）request。",
    feeZh: "一般申请须付申请费（金额见规则卡片；按每个所选机关各付一次，不退、不可豁免）；法定时限在付清申请费后才起算。超出免费检索时长的部分，机关会先出估算。",
    receiptZh: "保存确认邮件（含 FOI 申请编号、机关、提交日期、付款确认）。",
    followUpZh: "30 个工作日（从付清申请费起算；系统不估算工作日到期日）；机关可依法延期。来信登记到青砚。对决定不服可向 OIPC BC 申请复核。",
    cautionsZh: ["多选机关会按机关数收费：只选真正持有记录的机关。"],
  },
  MB_FIPPA: {
    actName: "The Freedom of Information and Protection of Privacy Act (Manitoba)",
    bodyLanguage: "en",
    bodyTerm: "public body",
    levelZh: "省政府部门与地方公共机构（含市政府、学区、卫生机构）都适用 FIPPA。",
    portalZh: "部分省政府部门用在线申请门户（规则卡片来源里的 forms.gov.mb.ca）；其他机关用 FIPPA 申请表（Application for Access）寄送或电邮给该机关的 access and privacy coordinator。",
    requestTypeZh: "申请表上选择一般信息（general information），不是本人个人信息。",
    feeZh: "提出申请不收费（以规则卡片为准）；检索与准备超过免费时长后，机关先发费用估算——收到后 30 日内不答复，机关可视为放弃申请。",
    receiptZh: "保存确认邮件或寄送凭证（含机关、申请编号、日期）；纸质寄送时记下寄出日期，并在收到确认信后上传。",
    followUpZh: "45 个日历日（2022-01-01 起），机关可依法再延期；系统按日历日给出估算期限（标「估算」）。对处理不服可向 Manitoba Ombudsman 投诉。",
    cautionsZh: ["收到费用估算后在期限内答复（接受、缩小范围或申请豁免），否则可能被视为放弃。"],
  },
  AB_ATIA: {
    actName: "Access to Information Act (Alberta)",
    bodyLanguage: "en",
    bodyTerm: "public body",
    levelZh: "省政府部门与地方公共机构（市政府、学区等）都适用 Access to Information Act（2025-06-11 起取代 FOIP）。",
    portalZh: "省政府多数机关：用你本人的 Alberta.ca 账号登录在线申请服务（青砚不保存账号）；地方公共机构：用其官网的 ATI 申请表。",
    requestTypeZh: "选择 general information request（一般 / 非个人），一次性申请（不是持续性申请）。",
    feeZh: "支付一般申请初始费（金额见规则卡片；持续性申请更高）；预计处理费超过门槛时，机关先发估算并可能要求押金。",
    receiptZh: "保存确认页或确认邮件（含申请编号、机关、提交日期、付款确认）。",
    followUpZh: "30 个工作日（系统不估算工作日到期日）；机关可依法延期。来信登记到青砚。对决定不服可向 OIPC Alberta 申请复核。",
    cautionsZh: ["旧表格可能仍写 FOIP：以 ATIA 现行表格和收费为准。"],
  },
  SK_FOIP: {
    actName: "The Freedom of Information and Protection of Privacy Act (Saskatchewan)",
    bodyLanguage: "en",
    bodyTerm: "government institution",
    levelZh: "接收机关是省政府部门 / 机构 → 适用 FOIP。市政府、学区、卫生机构、大学等地方机关 → 适用 LA FOIP（另一部法律，申请时收申请费），应换用对应规则后再生成正文。",
    portalZh: "填写 Access to Information Request Form（saskatchewan.ca 提供表格与提交方式），交给该机关的 access / FOIP coordinator；部分机关接受电邮。",
    requestTypeZh: "表格上选择一般记录（不是本人个人信息）。",
    feeZh: "向省政府机关申请不收申请费（以规则卡片为准）；检索与准备超过免费时长后，机关先发费用估算。",
    receiptZh: "保存提交凭证（电邮发送记录或寄送凭证，含机关、日期）；收到机关确认信后补传。",
    followUpZh: "30 个日历日，特定情形可再延长 30 日；系统按日历日给出估算期限。对决定不服可向萨省 OIPC 申请复核。",
    cautionsZh: ["地方机关适用 LA FOIP：不要用 FOIP 正文寄给市政府或学区。"],
  },
  SK_LAFOIP: {
    actName: "The Local Authority Freedom of Information and Protection of Privacy Act (Saskatchewan)",
    bodyLanguage: "en",
    bodyTerm: "local authority",
    levelZh: "接收机关是地方机关（市政府、学区、卫生机构、大学等）→ 适用 LA FOIP。",
    portalZh: "用该地方机关官网的 Access to Information Request Form 或指定邮箱提交。",
    requestTypeZh: "表格上选择一般记录（不是本人个人信息）。",
    feeZh: "提交时支付申请费（金额见规则卡片与机关页面）；检索与准备超过免费时长后，机关先发费用估算。",
    receiptZh: "保存提交凭证与付款凭证（含机关、日期、金额）；收到确认信后补传。",
    followUpZh: "30 个日历日，特定情形可再延长 30 日；系统按日历日给出估算期限。对决定不服可向萨省 OIPC 申请复核。",
    cautionsZh: ["LA FOIP 规则须针对该机关单独核实后才能 READY。"],
  },
  QC_ACCES: {
    actName: "Loi sur l'accès aux documents des organismes publics et sur la protection des renseignements personnels",
    bodyLanguage: "fr",
    bodyTerm: "organisme public",
    levelZh: "省政府部门、市政机关、学校服务中心等公共机构都适用《Loi sur l'accès》（RLRQ, c. A-2.1）。",
    portalZh: "把申请发给该机关的 responsable de l'accès aux documents（官网通常列出邮箱或在线表单），可电邮或邮寄。",
    requestTypeZh: "写明是文件访问申请（demande d'accès à des documents），不是个人信息申请。",
    feeZh: "提出申请免费（以规则卡片为准）；转录、复制、传送费可能另收，机关会先告知。",
    receiptZh: "保存你发出的邮件（含发送时间、收件人）和机关的确认回函（accusé de réception，通常写明收到日期与处理期限）。",
    followUpZh: "收到后 20 日内答复，机关可在期满前书面通知再延长 10 日；逾期未答复视为拒绝，可在 30 日内向 Commission d'accès à l'information 申请复核。系统按日历日给出估算期限。",
    cautionsZh: ["正文为法语：如另附英文说明，登记提交时仍以实际发出的法语正文为准。"],
  },
};

export function lawProfile(key: RequestLawKey): { actName: string; bodyLanguage: BodyLanguage } {
  const p = LAW_PROFILES[key];
  return { actName: p.actName, bodyLanguage: p.bodyLanguage };
}

const CJK_RE = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;

/**
 * 正文里的项目标题只用官方英文 / 法文写法：申请卡的中文标题（内部称呼）不进正文，
 * 返回 null 让模板保留 [PROJECT TITLE] 占位符，由 READY 闸拦截、提示人工填写官方标题。
 */
export function bodyTitle(title: string | null | undefined): string | null {
  const t = title?.trim();
  if (!t || CJK_RE.test(t)) return null;
  return t;
}

export function joinNumbers(list: string[], conjunction = "and"): string {
  const uniq = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length <= 1) return uniq[0] ?? "";
  return `${uniq.slice(0, -1).join(", ")} ${conjunction} ${uniq[uniq.length - 1]}`;
}

/** 联邦条目（任务书第七节逐字） */
export const CATEGORY_TEMPLATE_ITEMS: Record<RecordCategory, string> = {
  CONTRACT_DOCS: "The final issued contract or Standing Offer, its applicable annexes, amendments and exercised renewal or extension options.",
  CALL_UPS_USAGE:
    "Existing call-up, purchase order or usage records showing, where recorded, item description, quantity, unit of measure, unit price, order date, delivery destination, order value and cumulative value.",
  USAGE_REPORTS: "Existing annual or quarterly usage reports for the specified instrument and period.",
  FINANCIALS:
    "Records showing separately the amounts committed, ordered, invoiced and paid, together with recorded cancellations, returns, credits or refunds relevant to those amounts.",
  PRICE_SCHEDULE: "The applicable final Basis of Payment or price schedule, to the extent releasable.",
};

/** 省级英文条目（采购工具用语换成省市常见写法：vendor of record、rate sheet 等） */
const PROVINCIAL_ITEMS_EN: Record<RecordCategory, string> = {
  CONTRACT_DOCS:
    "The final executed contract, standing offer, vendor of record arrangement or purchase order, its schedules, amendments and exercised renewal or extension options.",
  CALL_UPS_USAGE:
    "Existing purchase order, release or usage records showing, where recorded, item description, quantity, unit of measure, unit price, order date, delivery location, order value and cumulative value.",
  USAGE_REPORTS: "Existing annual or quarterly usage or spend reports for the specified contract and period.",
  FINANCIALS:
    "Records showing separately the amounts committed, ordered, invoiced and paid, together with recorded cancellations, returns, credits or refunds relevant to those amounts.",
  PRICE_SCHEDULE: "The applicable final pricing schedule or rate sheet, to the extent releasable.",
};

const PROVINCIAL_ITEMS_FR: Record<RecordCategory, string> = {
  CONTRACT_DOCS: "Le contrat ou l'entente finale octroyée, ses annexes, ses avenants et les options de renouvellement ou de prolongation exercées.",
  CALL_UPS_USAGE:
    "Les bons de commande, commandes ou relevés d'utilisation existants indiquant, lorsque consignés, la description de l'article, la quantité, l'unité de mesure, le prix unitaire, la date de commande, le lieu de livraison, la valeur de la commande et la valeur cumulative.",
  USAGE_REPORTS: "Les rapports d'utilisation ou de dépenses annuels ou trimestriels existants pour le contrat et la période visés.",
  FINANCIALS:
    "Les documents indiquant séparément les montants engagés, commandés, facturés et payés, ainsi que les annulations, retours, crédits ou remboursements consignés se rapportant à ces montants.",
  PRICE_SCHEDULE: "Le bordereau de prix ou la grille tarifaire finale applicable, dans la mesure où il peut être communiqué.",
};

function orderedItems(categories: RecordCategory[], items: Record<RecordCategory, string>, emptyPlaceholder: string): string[] {
  const cats = RECORD_CATEGORIES.filter((c) => categories.includes(c));
  return cats.length ? cats.map((c, i) => `${i + 1}. ${items[c]}`) : [emptyPlaceholder];
}

/** 省市正式申请正文（联邦请用 buildFederalAtiBody）。返回 null 表示该法律没有省市模板。 */
export function buildProvincialRequestBody(law: RequestLawKey, input: RequestBodyInput): string | null {
  if (law === "FED_ATIA") return null;
  const p = LAW_PROFILES[law];
  if (p.bodyLanguage === "fr") return buildQuebecBody(p, input);

  const institution = input.institution?.trim() || "[INSTITUTION]";
  const title = input.projectTitle?.trim() || "[PROJECT TITLE]";
  const contracts = joinNumbers(input.contractNumbers) || "[CONTRACT NUMBER]";
  const sol = joinNumbers(input.solicitationNumbers);
  const start = input.startDate || "[START DATE]";
  const end = input.endDate || "[END DATE]";
  const subject = sol ? `${title}, ${sol}, and ${contracts}` : `${title} and ${contracts}`;
  return [
    `This is a request for access to general records (not personal information) under the ${p.actName}.`,
    "",
    `Please provide electronic copies of existing records in the custody or under the control of ${institution} relating to ${subject}, for the period ${start} to ${end}.`,
    "",
    "Please provide:",
    ...orderedItems(input.categories, PROVINCIAL_ITEMS_EN, "[RECORD CATEGORIES]"),
    "",
    "Please provide existing electronic records or ordinary system exports in a reusable format such as CSV or XLSX where available; otherwise, electronic copies in their existing format are acceptable. Please preserve the distinction between contract limits, orders, invoices and payments. I am requesting existing records and not a new forecast or commercial analysis.",
    "",
    "If any fees beyond the application fee are expected, please send me a fee estimate before processing so that I can confirm or narrow the request.",
    "",
    `If some requested records are held by another ${p.bodyTerm}, please advise which ${p.bodyTerm} should be contacted or whether a transfer is appropriate. If exemptions apply, please release reasonably severable portions and identify the applicable provisions.`,
  ].join("\n");
}

function buildQuebecBody(p: LawProfile, input: RequestBodyInput): string {
  const organisme = input.institution?.trim() || "[ORGANISME PUBLIC]";
  const title = input.projectTitle?.trim() || "[TITRE DU PROJET]";
  const contracts = joinNumbers(input.contractNumbers, "et") || "[NUMERO DE CONTRAT]";
  const sol = joinNumbers(input.solicitationNumbers, "et");
  const start = input.startDate || "[DATE DE DEBUT]";
  const end = input.endDate || "[DATE DE FIN]";
  const subject = sol ? `${title}, ${sol} et ${contracts}` : `${title} et ${contracts}`;
  return [
    `Objet : Demande d'accès à des documents en vertu de la ${p.actName}`,
    "",
    `En vertu de la ${p.actName}, je demande une copie électronique des documents existants détenus par ${organisme} relatifs à ${subject}, pour la période du ${start} au ${end}.`,
    "",
    "Je demande plus précisément :",
    ...orderedItems(input.categories, PROVINCIAL_ITEMS_FR, "[CATEGORIES DE DOCUMENTS]"),
    "",
    "Je souhaite recevoir, lorsqu'ils existent, des documents électroniques ou des extractions ordinaires de systèmes dans un format réutilisable (CSV ou XLSX); à défaut, une copie électronique dans leur format existant convient. Veuillez conserver la distinction entre les plafonds contractuels, les commandes, les factures et les paiements. Je demande des documents existants et non une nouvelle analyse ou prévision.",
    "",
    "Si des frais de transcription, de reproduction ou de transmission sont exigibles, veuillez m'en informer avant de traiter la demande.",
    "",
    "Si certains documents relèvent davantage de la compétence d'un autre organisme public, veuillez m'indiquer le nom de cet organisme et les coordonnées de sa personne responsable de l'accès. Si des restrictions s'appliquent, veuillez communiquer les parties pouvant être divulguées et indiquer les dispositions invoquées.",
  ].join("\n");
}

export interface GuideStep {
  key: string;
  titleZh: string;
  detailZh: string;
}

export interface SubmissionGuide {
  law: RequestLawKey;
  actName: string;
  bodyLanguage: BodyLanguage;
  steps: GuideStep[];
  cautionsZh: string[];
}

const COMMON_CAUTIONS = [
  "入口以规则卡片中经核实的地址为准；不要从搜索结果、广告或第三方代办网站进入。",
  "登录、验证码、付款都由你本人在官方页面完成；青砚不保存政府账号密码、验证码、会话令牌或银行卡信息。",
  "付款或提交页面超时、不确定是否成功时，先记为「提交结果不确定」并核查确认邮件 / 账户，不要换渠道重复提交。",
];

/** 自助提交逐步指引（按适用法律） */
export function submissionGuide(law: RequestLawKey): SubmissionGuide {
  const p = LAW_PROFILES[law];
  const lang = p.bodyLanguage === "fr" ? "法语" : "英文";
  return {
    law,
    actName: p.actName,
    bodyLanguage: p.bodyLanguage,
    steps: [
      { key: "LEVEL", titleZh: "确认接收机关与适用法律", detailZh: p.levelZh },
      { key: "PUBLIC_FIRST", titleZh: "先查公开资料", detailZh: "确认公开合同数据、采购结果公告和既有披露里没有所需资料（申请卡的「资料取得路径」应已记录这些检查）。" },
      { key: "PORTAL", titleZh: "打开官方入口", detailZh: p.portalZh },
      { key: "REQUEST_TYPE", titleZh: "选择申请类型", detailZh: p.requestTypeZh },
      {
        key: "PASTE_BODY",
        titleZh: `粘贴${lang}正文`,
        detailZh: `点「复制完整正文」，粘贴到申请描述栏；申请人资料按「字段对应」填写。不要改动编号与日期；如果字数受限或你改了措辞，登记时选「有改动」并粘贴实际提交的正文。`,
      },
      { key: "FEE", titleZh: "付费（如适用）", detailZh: p.feeZh },
      { key: "RECEIPT", titleZh: "保存回执", detailZh: p.receiptZh },
      {
        key: "REPORT",
        titleZh: "回青砚登记",
        detailZh: "回到本页点「登记提交（待核实）」，填提交时间、渠道、实际费用、申请编号；上传回执后核对为 SUBMITTED。",
      },
      { key: "FOLLOW_UP", titleZh: "跟进期限与来信", detailZh: p.followUpZh },
    ],
    cautionsZh: [...p.cautionsZh, ...COMMON_CAUTIONS],
  };
}

/** 索取联邦 Completed ATI 既有披露副本（非正式请求）的指引 */
export function informalCopyGuide(): SubmissionGuide {
  return {
    law: "FED_ATIA",
    actName: "Completed Access to Information Requests — informal request",
    bodyLanguage: "en",
    steps: [
      { key: "LEVEL", titleZh: "确认既有披露", detailZh: "在 Completed ATI 摘要里找到对应的已完成申请编号与机关，确认它覆盖所需记录（编号写进正文）。" },
      { key: "PORTAL", titleZh: "打开该条摘要的索取入口", detailZh: "从规则卡片里经核实的 search.open.canada.ca/ati 页面打开该条摘要，使用页面提供的非正式索取方式。" },
      { key: "PASTE_BODY", titleZh: "粘贴英文正文", detailZh: "点「复制完整正文」，粘贴到索取表单；保留已完成申请编号。" },
      { key: "FEE", titleZh: "费用", detailZh: "既有披露副本通常免费（以规则卡片为准）。" },
      { key: "RECEIPT", titleZh: "保存回执", detailZh: "保存表单确认页或确认邮件（含机关、日期、引用的申请编号）。" },
      { key: "REPORT", titleZh: "回青砚登记", detailZh: "回到本页点「登记提交（待核实）」，上传回执后核对为 SUBMITTED。" },
      { key: "FOLLOW_UP", titleZh: "跟进", detailZh: "非正式请求不适用正式申请的法定时限；长时间无回复时再考虑正式申请（重复检查会提示已有覆盖）。" },
    ],
    cautionsZh: [...COMMON_CAUTIONS],
  };
}
