/**
 * 投标业务档案（与窗饰品牌档案分离）——存 Organization.settingsJson.tenderProfile，零 schema。
 * 投标起草/备忘录只读本档案；没有 = 相关段落老实占位，绝不回退到窗饰品牌档案。
 */

import { z } from "zod";

const field = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""), z.string());

export const tenderProfileSchema = z.object({
  entityName: field(200),
  legalDetails: field(1500),
  positioning: field(2000),
  capabilities: field(4000),
  certifications: field(2000),
  team: field(2000),
  pastPerformance: field(4000),
  socialValue: field(3000),
  forbiddenClaims: field(1500),
  updatedAt: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
});
export type TenderProfile = z.infer<typeof tenderProfileSchema>;

export const TENDER_PROFILE_FIELDS: Array<{ key: keyof Omit<TenderProfile, "updatedAt">; labelZh: string; hintZh: string }> = [
  { key: "entityName", labelZh: "投标主体名称", hintZh: "与注册一致的法律实体名（英文），用于封面信与 Bid Form" },
  { key: "legalDetails", labelZh: "注册信息与签字人", hintZh: "注册地/注册号/税号、授权签字人与职务、公司或合资体形式" },
  { key: "positioning", labelZh: "投标业务线定位", hintZh: "这条业务线做什么、服务对象、与其他业务线的区分（不写窗饰）" },
  { key: "capabilities", labelZh: "能力与服务范围", hintZh: "能交付什么、平台/工具/流程、SLA、数据驻留与安全能力——只写能举证的" },
  { key: "certifications", labelZh: "资质与认证", hintZh: "WCB、保险、ISO、安全认证、供应商登记等，附编号/有效期" },
  { key: "team", labelZh: "团队", hintZh: "关键角色、资历、所在地（加拿大境内员工比例对国籍项评分有影响）" },
  { key: "pastPerformance", labelZh: "代表业绩与参考", hintZh: "客户、范围、时间、联系人（可填占位）——只写可被核实的" },
  { key: "socialValue", labelZh: "社会价值素材", hintZh: "包容性雇佣、实习/学徒、多元供应链、环保措施、第三方认证" },
  { key: "forbiddenClaims", labelZh: "禁用表述", hintZh: "投标文件里绝不能出现的承诺或说法，逗号/换行分隔" },
];

export function emptyTenderProfile(): TenderProfile {
  return tenderProfileSchema.parse({});
}

export function isTenderProfileUsable(p: TenderProfile | null): boolean {
  return !!p && (p.entityName.length > 0 || p.capabilities.length > 0 || p.positioning.length > 0);
}

/** 拼成 prompt 语料（空字段省略） */
export function formatTenderProfileContext(p: TenderProfile): string {
  const parts: string[] = [];
  for (const f of TENDER_PROFILE_FIELDS) {
    if (f.key === "forbiddenClaims") continue;
    const v = p[f.key];
    if (v) parts.push(`${f.labelZh}：\n${v}`);
  }
  return parts.join("\n\n");
}
