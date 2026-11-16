/**
 * P2-3a「跟这个标」的纯规则：能不能跟、建出的项目预填什么、候选卡片上显示什么按钮。
 *
 * 浏览器端（采购监控页）也引用本文件：这里不得引用任何服务端模块（db、node:*）。
 */

export const FOLLOW_SOURCE_PLATFORM: Record<string, string> = {
  CANADABUYS_TENDER_NOTICES: "CanadaBuys",
  MANUAL_LINK: "人工导入",
};

export type FollowRefusal = { ok: false; status: 400 | 403 | 409; code: string; message: string };

export const NOT_SOLICITATION_ZH = "只有招标公告可以跟（合同、call-up 等不能建投标项目）";
export const CLOSED_ZH = "这条公告已截标，不能再跟";
export const ORG_ARCHIVED_ZH = "组织已归档或不可用，无法新建项目";

/** 能不能跟：只看公告本身（权限与组织状态由调用方先查） */
export function followEligibility(inst: { instrumentClass: string; closingAt: Date | null }, now: Date): { ok: true } | FollowRefusal {
  if (inst.instrumentClass !== "SOLICITATION") return { ok: false, status: 400, code: "NOT_SOLICITATION", message: NOT_SOLICITATION_ZH };
  if (inst.closingAt && inst.closingAt.getTime() <= now.getTime()) return { ok: false, status: 409, code: "CLOSED", message: CLOSED_ZH };
  return { ok: true };
}

export type FollowInstrument = {
  id: string;
  officialNumber: string;
  title: string | null;
  jurisdiction: string;
  origin: string;
  contractingInstitution: string | null;
  buyingInstitution: string | null;
  publishedAt: Date | null;
  closingAt: Date | null;
};

export type FollowEvidence = { sourceType: string; sourceUrl: string | null };

export type FollowProjectFields = {
  name: string;
  solicitationNumber: string;
  closeDate: Date | null;
  publicDate: Date | null;
  clientOrganization: string | null;
  sourcePlatform: string;
  sourceMetadata: { procurementInstrumentId: string; noticeUrl: string | null; jurisdiction: string; origin: string };
};

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/**
 * 项目预填（design D3）。evidence 按新到旧传入；公告链接取最新一条有链接的，优先 CanadaBuys 招标公告来源。
 */
export function projectFieldsFromInstrument(inst: FollowInstrument, evidence: FollowEvidence[]): FollowProjectFields {
  const withUrl = evidence.filter((e) => clean(e.sourceUrl));
  const notice = withUrl.find((e) => e.sourceType === "CANADABUYS_TENDER_NOTICES") ?? withUrl[0] ?? null;
  // 来源平台与公告链接取同一条证据（审查 L：避免链接来自 CanadaBuys、平台却写「人工导入」）
  const platformFrom = notice && FOLLOW_SOURCE_PLATFORM[notice.sourceType] ? notice.sourceType : evidence.find((e) => FOLLOW_SOURCE_PLATFORM[e.sourceType])?.sourceType;
  const sourcePlatform = platformFrom ? FOLLOW_SOURCE_PLATFORM[platformFrom] : inst.origin === "MANUAL" ? "人工导入" : "采购监控";
  return {
    name: (clean(inst.title) ?? clean(inst.officialNumber) ?? inst.id).slice(0, 200),
    solicitationNumber: inst.officialNumber.trim(),
    closeDate: inst.closingAt,
    publicDate: inst.publishedAt,
    clientOrganization: clean(inst.buyingInstitution) ?? clean(inst.contractingInstitution),
    sourcePlatform,
    sourceMetadata: { procurementInstrumentId: inst.id, noticeUrl: notice ? clean(notice.sourceUrl) : null, jurisdiction: inst.jurisdiction, origin: inst.origin },
  };
}

export type FollowButton = { kind: "follow" } | { kind: "followed"; projectId: string } | { kind: "none" };

/**
 * 候选卡片上的按钮（design D5）：只对招标公告——已有「本项目」关联 → 已跟进（取最早的一条；列表按建立时间排好）；
 * 未截标 → 跟这个标；其它（含不是招标公告、只读成员）不显示。
 */
export function followButtonState(
  c: { instrumentClass: string; closingAt: string | null; tenderLinks?: Array<{ projectId: string; relation: string }> | null },
  now: Date,
  opts: { canFollow?: boolean } = {},
): FollowButton {
  if (c.instrumentClass !== "SOLICITATION") return { kind: "none" };
  const current = (c.tenderLinks ?? []).find((l) => l.relation === "CURRENT");
  if (current) return { kind: "followed", projectId: current.projectId };
  if (opts.canFollow === false) return { kind: "none" };
  const closing = c.closingAt ? new Date(c.closingAt) : null;
  if (followEligibility({ instrumentClass: c.instrumentClass, closingAt: closing && !Number.isNaN(closing.getTime()) ? closing : null }, now).ok) return { kind: "follow" };
  return { kind: "none" };
}

export const FOLLOW_LABEL_ZH = "跟这个标";
export const FOLLOWED_LABEL_ZH = "已跟进 · 打开项目";
export const FOLLOW_CREATED_ZH = "已建投标项目；上传招标文件后会自动分析。";
export const FOLLOW_EXISTING_ZH = "这条公告已经跟进过，打开的是原来的项目。";
