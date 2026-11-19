/**
 * CHAIN-4b — 招标身份命中的类别与说明文字（纯函数，零 Node 内置模块，前后端都可引用）
 *
 * 询价入口 / 自动起草的纯函数会被浏览器端组件引用，所以说明文字单独放在这里；
 * 禁出清单与扫描（要用 node:crypto 算询价编号）在 project-identity-deny.ts。
 */

export type DenyCategory = "tender_number" | "buyer_name" | "close_date" | "delivery_address" | "project_name";
export type IdentityCategory = DenyCategory | "email_address" | "phone_number";

export const IDENTITY_CATEGORY_ZH: Readonly<Record<IdentityCategory, string>> = {
  tender_number: "招标编号",
  buyer_name: "采购方名称",
  close_date: "截标日期",
  delivery_address: "交货地址",
  project_name: "项目名称",
  email_address: "邮箱地址",
  phone_number: "电话号码",
};

/**
 * 一段供应商可见文字的来历：
 *   authored —— 我方撰写（模板、标题、抬头、询价编号）
 *   human    —— 发起人 / 编辑填写的栏目
 *   tender   —— 招标文本（要求原文与译文、交付要求事实、自动挑选的事实）
 */
export type IdentitySegmentKind = "authored" | "human" | "tender";
export type IdentityHit = { category: IdentityCategory; where: string; kind: IdentitySegmentKind };

/** 「采购方名称·要求 R-02、交货地址·目的地」；超过 max 处写「等 N 处」 */
export function describeIdentityHits(hits: readonly IdentityHit[], max = 3): string {
  const parts = hits.slice(0, max).map((h) => `${IDENTITY_CATEGORY_ZH[h.category]}·${h.where}`);
  return hits.length > max ? `${parts.join("、")} 等 ${hits.length} 处` : parts.join("、");
}

/** 询价入口 / 自动起草 / Muse / 送审（命中不在人工栏目时）共用的一句话 */
export function identityLeakMessageZh(hits: readonly IdentityHit[]): string {
  return `询价内容含招标身份信息（命中：${describeIdentityHits(hits)}），本轮整单不发。`;
}

/** 命中在发起人填写的栏目时的说法（只说类别，位置就是这一栏） */
export function identityLeakFieldMessageZh(hit: IdentityHit, hits: readonly IdentityHit[]): string {
  const cats = [...new Set(hits.filter((h) => h.where === hit.where).map((h) => IDENTITY_CATEGORY_ZH[h.category]))].join("、");
  return `你填的${hit.where}里含招标身份信息（命中：${cats}），改掉再提交。`;
}

/** 供应商侧生成文件的说法 */
export function identityLeakDocMessageZh(hits: readonly IdentityHit[]): string {
  return `供应商侧文件含招标身份信息（命中：${describeIdentityHits(hits)}），未生成。`;
}
