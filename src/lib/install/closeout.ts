/**
 * INSTALL-1：逐窗收口（纯函数）
 *
 * 收口记录 = AuditLog 行：action "install.window.completed"，targetType "blinds_order_item"，targetId = 窗 id，
 * afterData JSON { orderId, appointmentId, pathname, proxyUrl, note, byUserId }。
 * 同一窗可补拍：最新一条为当前照片，张数 = 记录数。
 *
 * INSTALL-2a：收口单元 = Blinds 行 + 工艺参数 国内下单 / 窗帘 / Vinyl / 外采购 各行。
 * 工艺参数行没有稳定 id：单元 id `spec-<段>-<下标>`，审计目标 targetType "blinds_order_unit"、
 * targetId `<orderId>:<段>:<下标>`，afterData 另存拍照时的 location；位置与当前不一致的照片不计入（design D1 / D2）。
 *
 * INSTALL-2d：问题记录 action "install.window.issue" 与收口记录同目标；单元状态取两者中最新一条：
 * 收口 → done，问题 → issue（不计入已收口），都没有 → pending（2d design D1）。
 */

import type { ProcessSpec } from "@/lib/sunny-process/process-spec";
import { categoryOfProductType, PURCHASE_SECTION_CATEGORY, type FulfillmentCategory } from "@/lib/fulfillment/category";
import { INSTALL_WINDOW_ISSUE, ISSUE_TYPE_LABEL, isIssueType, type IssueType } from "./repair";

export const INSTALL_WINDOW_COMPLETED = "install.window.completed" as const;
export const INSTALL_TASK_STARTED = "install.task.started" as const;
export const INSTALL_TASK_COMPLETED = "install.task.completed" as const;
export const INSTALL_PHOTO_PREFIX = "install-photos" as const;

export const INSTALL_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const INSTALL_PHOTO_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const INSTALL_TARGET_ITEM = "blinds_order_item" as const;
export const INSTALL_TARGET_UNIT = "blinds_order_unit" as const;

export type SpecSection = "domestic" | "drapes" | "vinyl" | "purchase";
export type UnitSection = "blinds" | SpecSection;
/** 工艺参数段的收口顺序 = ProcessSpec 字段顺序（design D3） */
export const SPEC_SECTIONS: readonly SpecSection[] = ["domestic", "drapes", "vinyl", "purchase"];
export const SECTION_LABEL: Record<UnitSection, string> = {
  blinds: "Blinds",
  domestic: "国内下单",
  drapes: "窗帘",
  vinyl: "Vinyl 百叶",
  purchase: "外采购",
};

export type WindowItem = {
  id: string;
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  productType: string;
  fabricSku: string;
  /** 收口记录的审计目标；缺省 = id（Blinds 行） */
  logTargetId?: string;
  /** 工艺参数单元：照片的位置快照须与当前位置一致才计入 */
  matchLocation?: boolean;
};

/** 收口单元：Blinds 行或工艺参数行；`id` 即单元 id（上传路径段） */
export type CloseoutUnit = WindowItem & {
  section: UnitSection;
  sectionLabel: string;
  /** INSTALL-2c：品类（质保年限查表）；Blinds 行产品类型无法识别 → null */
  category: FulfillmentCategory | null;
  logTargetId: string;
  controlType: string;
  controlSide: string;
  mountType: string;
  itemRemark: string | null;
};

export type BlindsRowInput = WindowItem & {
  controlType: string;
  controlSide: string;
  mountType: string;
  itemRemark: string | null;
};

export type SpecSectionsInput = Pick<ProcessSpec, SpecSection>;

export type CloseoutLog = {
  targetId: string | null;
  createdAt: Date | string;
  userId: string;
  afterData: string | null;
  /** INSTALL-2d：install.window.issue = 问题记录；缺省 = 收口记录（install.window.completed） */
  action?: string;
};

export type CloseoutPhoto = {
  proxyUrl: string;
  pathname: string;
  note: string | null;
  at: string;
  byUserId: string;
  /** INSTALL-2a：拍照时的位置快照（工艺参数单元写入；INSTALL-1 的 Blinds 记录没有） */
  location?: string | null;
};

/** INSTALL-2d：单元当前的问题（最新一条问题记录；照片 = 上次收口之后的全部问题照） */
export type UnitIssue = {
  issueType: IssueType;
  issueTypeLabel: string;
  needsFactory: boolean;
  description: string;
  at: string;
  byUserId: string;
  photos: CloseoutPhoto[];
};

/** done = 已收口；issue = 有问题；pending = 未处理 */
export type UnitState = "done" | "issue" | "pending";

export type WindowCloseout = {
  itemId: string;
  itemNumber: number;
  location: string;
  /** 计入的收口照片（state 为 issue 时仍保留历史收口照，但不算已收口） */
  photoCount: number;
  latest: CloseoutPhoto | null;
  photos: CloseoutPhoto[];
  /** 有照片但位置都与当前不一致（工艺参数被改）→ 未收口，给出拍照时的位置 */
  locationChanged: { previousLocation: string } | null;
  state: UnitState;
  issue: UnitIssue | null;
};

export type CloseoutSummary = {
  windows: WindowCloseout[];
  total: number;
  completed: number;
  /** INSTALL-2d：有问题的单元数 */
  issueCount: number;
  allCompleted: boolean;
};

function parsePhoto(log: CloseoutLog): CloseoutPhoto | null {
  if (!log.afterData) return null;
  try {
    const d = JSON.parse(log.afterData) as Record<string, unknown>;
    const proxyUrl = typeof d.proxyUrl === "string" ? d.proxyUrl : null;
    const pathname = typeof d.pathname === "string" ? d.pathname : null;
    if (!proxyUrl || !pathname) return null;
    return {
      proxyUrl,
      pathname,
      note: typeof d.note === "string" && d.note ? d.note : null,
      at: new Date(log.createdAt).toISOString(),
      byUserId: log.userId,
      location: typeof d.location === "string" ? d.location : null,
    };
  } catch {
    return null;
  }
}

type IssueEntry = CloseoutPhoto & { issueType: IssueType; needsFactory: boolean; description: string };

function parseIssue(log: CloseoutLog): IssueEntry | null {
  const photo = parsePhoto(log);
  if (!photo || !log.afterData) return null;
  try {
    const d = JSON.parse(log.afterData) as Record<string, unknown>;
    if (!isIssueType(d.issueType)) return null;
    return {
      ...photo,
      issueType: d.issueType,
      needsFactory: d.needsFactory === true,
      description: typeof d.description === "string" ? d.description : "",
    };
  } catch {
    return null;
  }
}

const newestFirst = <T extends { at: string }>(list: T[]) => list.sort((a, b) => b.at.localeCompare(a.at));

/** 位置比对口径：去首尾空白、不区分大小写（design D2） */
export function sameLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** 每个单元最新 / 张数 / 状态；问题记录比最新收口记录新 → 有问题；零单元不算完成 */
export function aggregateCloseout(items: WindowItem[], logs: CloseoutLog[]): CloseoutSummary {
  const doneByTarget = new Map<string, CloseoutPhoto[]>();
  const issuesByTarget = new Map<string, IssueEntry[]>();
  for (const log of logs) {
    if (!log.targetId) continue;
    if (log.action === INSTALL_WINDOW_ISSUE) {
      const issue = parseIssue(log);
      if (!issue) continue;
      if (!issuesByTarget.has(log.targetId)) issuesByTarget.set(log.targetId, []);
      issuesByTarget.get(log.targetId)!.push(issue);
      continue;
    }
    const photo = parsePhoto(log);
    if (!photo) continue;
    if (!doneByTarget.has(log.targetId)) doneByTarget.set(log.targetId, []);
    doneByTarget.get(log.targetId)!.push(photo);
  }
  const windows: WindowCloseout[] = [...items]
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((it) => {
      const target = it.logTargetId ?? it.id;
      const all = newestFirst([...(doneByTarget.get(target) ?? [])]);
      const allIssues = newestFirst([...(issuesByTarget.get(target) ?? [])]);
      const photos = it.matchLocation ? all.filter((p) => sameLocation(p.location, it.location)) : all;
      const issues = it.matchLocation ? allIssues.filter((p) => sameLocation(p.location, it.location)) : allIssues;
      const latest = photos[0] ?? null;
      const openIssues = issues.filter((i) => !latest || i.at > latest.at);
      const state: UnitState = openIssues.length > 0 ? "issue" : photos.length > 0 ? "done" : "pending";
      // 位置已变：计入的记录一条都没有、但有位置不一致的记录 → 给出最近一条的拍照位置
      const staleRecord = it.matchLocation && state === "pending" ? newestFirst([...all, ...allIssues])[0] : undefined;
      const head = openIssues[0];
      return {
        itemId: it.id,
        itemNumber: it.itemNumber,
        location: it.location,
        photoCount: photos.length,
        latest,
        photos,
        locationChanged: staleRecord ? { previousLocation: staleRecord.location ?? "" } : null,
        state,
        issue: head
          ? {
              issueType: head.issueType,
              issueTypeLabel: ISSUE_TYPE_LABEL[head.issueType],
              needsFactory: head.needsFactory,
              description: head.description,
              at: head.at,
              byUserId: head.byUserId,
              photos: openIssues.map(({ proxyUrl, pathname, note, at, byUserId, location }) => ({ proxyUrl, pathname, note, at, byUserId, location })),
            }
          : null,
      };
    });
  const completed = windows.filter((w) => w.state === "done").length;
  const issueCount = windows.filter((w) => w.state === "issue").length;
  return { windows, total: windows.length, completed, issueCount, allCompleted: windows.length > 0 && completed === windows.length };
}

// ─────────────────────────── 收口单元（INSTALL-2a） ───────────────────────────

/** 工艺参数单元 id：`spec-<段>-<下标>`（cuid 不含连字符，不会与 Blinds 行 id 冲突） */
export function specUnitId(section: SpecSection, index: number): string {
  return `spec-${section}-${index}`;
}

export function parseSpecUnitId(unitId: string): { section: SpecSection; index: number } | null {
  const m = /^spec-(domestic|drapes|vinyl|purchase)-(\d{1,4})$/.exec(unitId);
  if (!m) return null;
  return { section: m[1] as SpecSection, index: Number(m[2]) };
}

/** 工艺参数单元的审计目标：`<orderId>:<段>:<下标>` */
export function specUnitLogTargetId(orderId: string, section: SpecSection, index: number): string {
  return `${orderId}:${section}:${index}`;
}

/** 工艺参数段 → 品类（外采购按行的段另算，见 PURCHASE_SECTION_CATEGORY） */
const SPEC_SECTION_CATEGORY: Record<SpecSection, FulfillmentCategory | null> = {
  domestic: "shades",
  drapes: "drapery",
  vinyl: "vinyl",
  purchase: null,
};

const numOr0 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const joinNote = (parts: Array<string | null | undefined>) => parts.filter((p) => p && p.trim()).join(" · ") || null;

/**
 * 一张工艺单的收口单元：Blinds 行（沿用行序号）在前，工艺参数 国内下单 → 窗帘 → Vinyl → 外采购 在后，
 * 序号接在 Blinds 最大序号之后连续编号；布帘 / 纱帘各一个单元（design D3 / D4）。
 */
export function buildCloseoutUnits(
  orderId: string,
  items: BlindsRowInput[],
  spec: SpecSectionsInput | null,
): CloseoutUnit[] {
  const units: CloseoutUnit[] = [...items]
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((it) => ({
      ...it,
      logTargetId: it.id,
      matchLocation: false,
      section: "blinds" as const,
      sectionLabel: SECTION_LABEL.blinds,
      category: categoryOfProductType(it.productType),
    }));
  let next = items.reduce((m, it) => Math.max(m, it.itemNumber), 0) + 1;
  if (!spec) return units;

  const push = (section: SpecSection, index: number, u: Omit<CloseoutUnit, "id" | "itemNumber" | "section" | "sectionLabel" | "logTargetId" | "matchLocation" | "category">, category: FulfillmentCategory | null = SPEC_SECTION_CATEGORY[section]) => {
    units.push({
      ...u,
      category,
      id: specUnitId(section, index),
      itemNumber: next++,
      section,
      sectionLabel: SECTION_LABEL[section],
      logTargetId: specUnitLogTargetId(orderId, section, index),
      matchLocation: true,
    });
  };

  (spec.domestic ?? []).forEach((r, i) =>
    push("domestic", i, {
      location: r.location ?? "",
      width: numOr0(r.widthIn),
      height: numOr0(r.heightIn),
      productType: r.quoteProduct || r.productType || SECTION_LABEL.domestic,
      fabricSku: r.sku ?? "",
      controlType: r.control ?? "",
      controlSide: r.side ?? "",
      mountType: r.mount ?? "",
      itemRemark: r.remark || null,
    }),
  );
  (spec.drapes ?? []).forEach((r, i) =>
    push("drapes", i, {
      location: r.location ?? "",
      width: numOr0(r.widthIn),
      height: numOr0(r.heightIn),
      productType: r.part === "sheer" ? "窗帘 · 纱帘" : "窗帘 · 布帘",
      fabricSku: r.sku ?? "",
      controlType: r.craft ?? "",
      controlSide: "",
      mountType: r.mount ?? "",
      itemRemark: joinNote([r.qty > 1 ? `${r.qty} 扇` : null, r.rod ? `杆 ${r.rod}${r.rodColor ? ` ${r.rodColor}` : ""}` : null]),
    }),
  );
  (spec.vinyl ?? []).forEach((r, i) =>
    push("vinyl", i, {
      location: r.location ?? "",
      width: numOr0(r.width),
      height: numOr0(r.height),
      productType: SECTION_LABEL.vinyl,
      fabricSku: "",
      controlType: joinNote([r.panels ? `${r.panels} 扇` : null, r.openCode]) ?? "",
      controlSide: "",
      mountType: r.inOut ?? "",
      itemRemark: r.frame ? `外框 ${r.frame}` : null,
    }),
  );
  (spec.purchase ?? []).forEach((r, i) =>
    push("purchase", i, {
      location: r.location ?? "",
      width: numOr0(r.widthIn),
      height: numOr0(r.heightIn),
      productType: `外采购 · ${r.categoryZh || r.section}`,
      fabricSku: r.fields?.find((f) => /sku|fabric|color/i.test(f.label))?.value ?? "",
      controlType: "",
      controlSide: "",
      mountType: "",
      itemRemark: joinNote([r.qty > 1 ? `${r.qty} 扇` : null, r.remark]),
    }, PURCHASE_SECTION_CATEGORY[r.section] ?? null),
  );
  return units;
}

/** 完成收口前的未收口清单（序号 + 位置；有问题的单元也算未收口） */
export function missingWindows(summary: CloseoutSummary): Array<{ itemNumber: number; location: string }> {
  return summary.windows.filter((w) => w.state !== "done").map((w) => ({ itemNumber: w.itemNumber, location: w.location }));
}

/** INSTALL-2d：既没收口也没标问题的单元（提交维修单前须为空） */
export function unhandledUnits(summary: CloseoutSummary): Array<{ itemNumber: number; location: string }> {
  return summary.windows.filter((w) => w.state === "pending").map((w) => ({ itemNumber: w.itemNumber, location: w.location }));
}

/** 私有 Blob 路径：install-photos/{orgId}/{orderId}/{itemId}/{ts}.{ext} */
export function installPhotoPathname(input: {
  orgId: string;
  orderId: string;
  itemId: string;
  ext: string;
  now?: Date;
}): string {
  const ts = (input.now ?? new Date()).getTime();
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${INSTALL_PHOTO_PREFIX}/${safe(input.orgId)}/${safe(input.orderId)}/${safe(input.itemId)}/${ts}.${input.ext}`;
}

/** 类型 / 大小校验 */
export function validatePhotoUpload(input: { contentType: string | null | undefined; size: number }):
  | { ok: true; ext: string; contentType: string }
  | { ok: false; error: string } {
  const ct = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = INSTALL_PHOTO_MIME[ct];
  if (!ext) return { ok: false, error: "只接受 jpeg / png / webp 图片" };
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: "文件为空" };
  if (input.size > INSTALL_PHOTO_MAX_BYTES) return { ok: false, error: "单张照片不能超过 8MB" };
  return { ok: true, ext, contentType: ct };
}

/** 解析 install-photos 路径段：["install-photos", orgId, orderId, itemId, file] */
export function parseInstallPhotoPath(segments: string[]): { orgId: string; orderId: string; itemId: string } | null {
  if (segments[0] !== INSTALL_PHOTO_PREFIX || segments.length < 5) return null;
  const [, orgId, orderId, itemId] = segments;
  if (!orgId || !orderId || !itemId) return null;
  return { orgId, orderId, itemId };
}
