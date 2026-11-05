/**
 * PROC-1 READY 闸（纯函数，design D7；spec「READY 闸」）。全部条件满足才 READY，否则返回阻塞码。
 * 草稿永远可以保存；READY 由确定性代码判断，不让模型决定。
 */

import type { DuplicateCheck } from "./duplicate-check";
import { findPlaceholders, isValidIsoDate, type PathType } from "./request-pure";

export const REQUIRED_APPLICANT_FIELDS = [
  "legalName",
  "representativeName",
  "addressLine1",
  "city",
  "province",
  "postalCode",
  "country",
  "email",
] as const;
export type ApplicantField = (typeof REQUIRED_APPLICANT_FIELDS)[number];

export const APPLICANT_FIELD_LABELS: Record<ApplicantField | "addressLine2" | "phone", string> = {
  legalName: "申请人 / 公司法定名称",
  representativeName: "代表人姓名",
  addressLine1: "地址",
  addressLine2: "地址第二行",
  city: "城市",
  province: "省 / 州",
  postalCode: "邮编",
  country: "国家",
  email: "邮箱",
  phone: "电话",
};

export type ReadyBlockerCode =
  | "ARCHIVED"
  | "PATH_NOT_SUBMITTABLE"
  | "APPLICANT_MISSING"
  | "APPLICANT_UNCONFIRMED"
  | "APPLICANT_FIELD_MISSING"
  | "APPLICANT_SNAPSHOT_STALE"
  | "RECIPIENT_MISSING"
  | "RECORDS_HOLDER_BASIS_MISSING"
  | "RULE_MISSING"
  | "RULE_UNVERIFIED"
  | "FEE_UNKNOWN"
  | "PORTAL_UNVERIFIED"
  | "SELF_SERVE_NOT_SUPPORTED"
  | "PUBLIC_RECORDS_NOT_CHECKED"
  | "COMPLETED_ATI_NOT_CHECKED"
  | "LEDGER_UNVERIFIED"
  | "OVERLAP_BLOCKING"
  | "OVERLAP_NEEDS_REASON"
  | "DRAFT_EXISTS"
  | "BODY_EMPTY"
  | "BODY_PLACEHOLDER"
  | "DATE_RANGE_MISSING"
  | "DATE_RANGE_INVALID"
  | "CATEGORIES_EMPTY"
  | "INSTRUMENTS_EMPTY";

export interface ReadyBlocker {
  code: ReadyBlockerCode;
  messageZh: string;
  detail?: unknown;
}

export interface ReadyInput {
  archived: boolean;
  pathType: PathType;
  recipientInstitution: string | null;
  recordsHolderBasis: string | null;
  pathChecks: { publicRecords?: { checkedAt?: string } | null; completedAti?: { checkedAt?: string } | null } | null;
  version: {
    bodyEn: string;
    startDate: string | null;
    endDate: string | null;
    categories: string[];
    instrumentNumbers: string[];
    applicantProfileVersion: number | null;
  } | null;
  applicant: {
    verificationStatus: string;
    version: number;
    archived: boolean;
    fields: Partial<Record<ApplicantField, string | null>>;
  } | null;
  rule: {
    verificationStatus: string;
    applicationFeeCents: number | null;
    officialPortalUrl: string | null;
    selfServeSupported: boolean;
  } | null;
  duplicate: Pick<DuplicateCheck, "result" | "ledgerVerified" | "reasonsZh"> | null;
}

export function evaluateReady(i: ReadyInput): { ready: boolean; blockers: ReadyBlocker[] } {
  const b: ReadyBlocker[] = [];
  const add = (code: ReadyBlockerCode, messageZh: string, detail?: unknown) => b.push({ code, messageZh, ...(detail !== undefined ? { detail } : {}) });

  if (i.archived) add("ARCHIVED", "草稿已归档");
  if (i.pathType === "PUBLIC_RECORD") add("PATH_NOT_SUBMITTABLE", "该路径是直接取得公开资料，不需要提交申请");

  // 申请人
  if (!i.applicant || i.applicant.archived) add("APPLICANT_MISSING", "未选择申请人资料");
  else {
    if (i.applicant.verificationStatus !== "CONFIRMED") add("APPLICANT_UNCONFIRMED", "申请人资料未经真实用户确认（修改后需重新确认）");
    const missing = REQUIRED_APPLICANT_FIELDS.filter((f) => !i.applicant!.fields[f]?.trim());
    if (missing.length) add("APPLICANT_FIELD_MISSING", `申请人必填资料缺失：${missing.map((f) => APPLICANT_FIELD_LABELS[f]).join("、")}`, missing);
    if (i.version && i.version.applicantProfileVersion !== null && i.version.applicantProfileVersion !== i.applicant.version) {
      add("APPLICANT_SNAPSHOT_STALE", "申请人资料在本版本之后有修改，请保存新版本");
    }
    if (i.version && i.version.applicantProfileVersion === null) add("APPLICANT_SNAPSHOT_STALE", "本版本未带申请人快照，请保存新版本");
  }

  // 机关与规则
  if (!i.recipientInstitution?.trim()) add("RECIPIENT_MISSING", "未填写接收机关");
  if (!i.recordsHolderBasis?.trim()) add("RECORDS_HOLDER_BASIS_MISSING", "未写明该机关持有所需记录的依据（不默认 PSPC）");
  if (!i.rule) add("RULE_MISSING", "该辖区 / 机关 / 渠道没有申请规则");
  else {
    if (i.rule.verificationStatus !== "VERIFIED") add("RULE_UNVERIFIED", "申请规则（入口、费用、时限）未经真实用户核对官方页面");
    if (i.rule.applicationFeeCents === null) add("FEE_UNKNOWN", "费用未知（不按 0 处理）");
    if (!i.rule.officialPortalUrl) add("PORTAL_UNVERIFIED", "官方提交入口未核实");
    if (!i.rule.selfServeSupported) add("SELF_SERVE_NOT_SUPPORTED", "该辖区 / 机关的自助提交路径未核实，只能研究与草拟");
  }

  // 路径顺序
  if (i.pathType === "NEW_FORMAL_REQUEST") {
    if (!i.pathChecks?.publicRecords?.checkedAt) add("PUBLIC_RECORDS_NOT_CHECKED", "尚未记录公开公告 / 合同 / 修订 / 公开合同数据的检查");
    if (!i.pathChecks?.completedAti?.checkedAt) add("COMPLETED_ATI_NOT_CHECKED", "尚未记录 Completed ATI 既有披露的检查");
  }

  // 重复与台账
  const d = i.duplicate;
  if (!d) add("LEDGER_UNVERIFIED", "重复检查未执行");
  else {
    if (!d.ledgerVerified) add("LEDGER_UNVERIFIED", "历史申请台账未核实（UNVERIFIED，不能视为没有重复）");
    if (d.result === "BLOCKING") add("OVERLAP_BLOCKING", "与已提交 / 处理中 / 已披露的申请范围重叠", d.reasonsZh);
    if (d.result === "NEEDS_REASON") add("OVERLAP_NEEDS_REASON", "与已关闭 / 撤回 / 拒绝的申请重叠，须写明新增范围或重新申请理由", d.reasonsZh);
    if (d.result === "DRAFT_EXISTS") add("DRAFT_EXISTS", "已有覆盖同一范围的未提交草稿，请优先续改或写明保留理由", d.reasonsZh);
  }

  // 正文与范围
  const v = i.version;
  if (!v || !v.bodyEn.trim()) add("BODY_EMPTY", "英文正文为空");
  else {
    const ph = findPlaceholders(v.bodyEn);
    if (ph.length) add("BODY_PLACEHOLDER", `正文含未替换的占位符：${ph.join("、")}`, ph);
  }
  if (!v?.startDate || !v?.endDate) add("DATE_RANGE_MISSING", "未填写精确起止日期");
  else if (!isValidIsoDate(v.startDate) || !isValidIsoDate(v.endDate) || v.startDate > v.endDate) add("DATE_RANGE_INVALID", "起止日期无效");
  if (!v || v.categories.length === 0) add("CATEGORIES_EMPTY", "未选择记录类别");
  if (!v || v.instrumentNumbers.length === 0) add("INSTRUMENTS_EMPTY", "未关联任何合同 / SO / 招标编号");

  return { ready: b.length === 0, blockers: b };
}
