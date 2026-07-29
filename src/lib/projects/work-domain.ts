/**
 * Project.workDomain 领域常量与兼容层
 * tender | delivery | general
 */

export const PROJECT_WORK_DOMAINS = ["tender", "delivery", "general"] as const;

export type ProjectWorkDomain = (typeof PROJECT_WORK_DOMAINS)[number];

export const PROJECT_WORK_DOMAIN = {
  TENDER: "tender",
  DELIVERY: "delivery",
  GENERAL: "general",
} as const satisfies Record<string, ProjectWorkDomain>;

const DOMAIN_SET = new Set<string>(PROJECT_WORK_DOMAINS);

export function normalizeProjectWorkDomain(
  raw: string | null | undefined,
): ProjectWorkDomain | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (DOMAIN_SET.has(v)) return v as ProjectWorkDomain;
  return null;
}

export function assertProjectWorkDomain(
  raw: string | null | undefined,
): ProjectWorkDomain {
  const v = normalizeProjectWorkDomain(raw);
  if (!v) {
    throw new Error(`非法 workDomain: ${String(raw)}`);
  }
  return v;
}

export function isTenderProject(raw: string | null | undefined): boolean {
  return normalizeProjectWorkDomain(raw) === PROJECT_WORK_DOMAIN.TENDER;
}

export function isDeliveryProject(raw: string | null | undefined): boolean {
  return normalizeProjectWorkDomain(raw) === PROJECT_WORK_DOMAIN.DELIVERY;
}

export function isGeneralProject(raw: string | null | undefined): boolean {
  return normalizeProjectWorkDomain(raw) === PROJECT_WORK_DOMAIN.GENERAL;
}

/** 非法值不得默认当作 delivery */
export function workDomainLabel(raw: string | null | undefined): string {
  switch (normalizeProjectWorkDomain(raw)) {
    case "tender":
      return "招投标";
    case "delivery":
      return "执行交付";
    case "general":
      return "通用";
    default:
      return "未知工作域";
  }
}
