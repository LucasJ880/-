/** INSTALL-1：/api/install 响应类型（客户端共用） */

import type { IssueType } from "@/lib/install/repair";

export type InstallTaskSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  address: string | null;
  contactPhone: string | null;
  completedAt: string | null;
  customer: { id: string; name: string };
  assignedTo: { id: string; name: string };
  order: {
    id: string;
    code: string;
    status: string;
    windowCount: number;
    completedCount: number;
    /** INSTALL-2d：有问题的单元数 */
    issueCount: number;
    allCompleted: boolean;
  } | null;
  /** INSTALL-2e：返修预约所属维修单 */
  returnRepair?: { id: string; repairNo: string } | null;
};

export type InstallPhoto = {
  proxyUrl: string;
  pathname: string;
  note: string | null;
  at: string;
  byUserId: string;
  /** INSTALL-2a：拍照时的位置快照（工艺参数单元） */
  location?: string | null;
};

/** INSTALL-2a：收口单元所属段（blinds = 工艺单行；其余为工艺参数段） */
export type InstallUnitSection = "blinds" | "domestic" | "drapes" | "vinyl" | "purchase";

/** INSTALL-2d：单元当前的问题 */
export type InstallUnitIssue = {
  issueType: IssueType;
  issueTypeLabel: string;
  needsFactory: boolean;
  description: string;
  at: string;
  byUserId: string;
  photos: InstallPhoto[];
};

/** done = 已收口；issue = 有问题；pending = 未处理 */
export type InstallUnitState = "done" | "issue" | "pending";

/** 收口单元（INSTALL-1 时只有 Blinds 行，字段名沿用 window / itemId） */
export type InstallWindow = {
  itemId: string;
  itemNumber: number;
  section: InstallUnitSection;
  sectionLabel: string;
  location: string;
  width: number;
  height: number;
  productType: string;
  fabricSku: string;
  controlType: string;
  controlSide: string;
  mountType: string;
  itemRemark: string | null;
  photoCount: number;
  latest: InstallPhoto | null;
  photos: InstallPhoto[];
  /** 有照片但位置与当前不一致（工艺参数被改）→ 未收口，需补拍 */
  locationChanged: { previousLocation: string } | null;
  state: InstallUnitState;
  issue: InstallUnitIssue | null;
};

/** 单元的产品描述行：空字段不显示 */
export function unitSpecLine(w: Pick<InstallWindow, "productType" | "fabricSku" | "controlType" | "controlSide" | "mountType">): string {
  const control = w.controlType ? `${w.controlType}${w.controlSide ? `/${w.controlSide}` : ""}` : "";
  return [w.productType, w.fabricSku, control, w.mountType].filter((p) => p && p.trim()).join(" · ");
}

export type InstallTaskDetailData = InstallTaskSummary & {
  notes: string | null;
  remarks: string | null;
  windows: InstallWindow[];
  closeout: { total: number; completed: number; issueCount: number; allCompleted: boolean };
  /** INSTALL-2d：因提交维修单而完成的任务 */
  repair: { id: string; repairNo: string; targetDate: string; rowCount: number } | null;
};

/** 由单元状态重算汇总（前端乐观更新用，口径同服务端聚合） */
export function closeoutCounts(windows: Array<Pick<InstallWindow, "state">>): InstallTaskDetailData["closeout"] {
  const completed = windows.filter((w) => w.state === "done").length;
  const issueCount = windows.filter((w) => w.state === "issue").length;
  return { total: windows.length, completed, issueCount, allCompleted: windows.length > 0 && completed === windows.length };
}

export const INSTALL_STATUS_LABEL: Record<string, string> = {
  scheduled: "已排期",
  confirmed: "已确认",
  in_progress: "安装中",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未到场",
};

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 本地日期键 YYYY-MM-DD */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 客户端压缩：最长边 ≤ maxEdge，输出 jpeg；失败时原样返回 */
export async function compressImage(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  if (typeof window === "undefined" || !("createImageBitmap" in window)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      bitmap.close();
      return file;
    }
    ctx2d.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** INSTALL-2d：GET /api/install/repairs 列表项 */
export type RepairListItem = {
  id: string;
  repairNo: string;
  orderId: string;
  orderCode: string;
  customerName: string;
  takenBy: { id: string; name: string | null };
  fillDate: string;
  targetDate: string;
  overdue: boolean;
  rowCount: number;
  factory: { any: boolean; unknown: boolean; categories: Array<{ key: string; label: string }> };
  customerConfirmed: boolean;
  stage: string;
  stageLabel: string;
  /** INSTALL-2e：待登记出单品类 / 返修时间 / 关闭情况 */
  pendingFactory: Array<{ key: string; label: string }>;
  scheduledAt: string | null;
  closed: { reason: "completed" | "superseded"; supersededBy: string | null } | null;
};

/** INSTALL-2e：维修单进度（详情） */
export type RepairProgressData = {
  factoryCategories: Array<{ key: string; label: string }>;
  issued: Array<{ key: string; label: string; readyDate: string; note: string; by: { id: string; name: string | null }; at: string }>;
  pending: Array<{ key: string; label: string }>;
  readyDate: string | null;
  schedule: { appointmentId: string; installAt: string; assignedTo: { id: string; name: string | null }; completed: boolean } | null;
  closed: { reason: "completed" | "superseded"; supersededBy: string | null; at: string } | null;
};

/** INSTALL-2d：GET /api/install/repairs/[id] 详情（打印版同一数据） */
export type RepairDetailData = RepairListItem & {
  phone: string;
  notes: string;
  customerPreferredDate: string | null;
  submittedAt: string;
  appointmentId: string;
  company: { name: string; address: string };
  /** INSTALL-2e：进度与当前用户可执行操作（与写接口同一判定） */
  progress: RepairProgressData;
  actions: { issueCategories: Array<{ key: string; label: string }>; canSchedule: boolean };
  rows: Array<{
    n: number;
    unitId: string;
    itemNumber: number;
    section: string;
    sectionLabel: string;
    location: string;
    description: string;
    issueType: string;
    issueTypeLabel: string;
    needsFactory: boolean;
    category: string | null;
    categoryLabel: string | null;
    photos: Array<{ proxyUrl: string; at: string }>;
  }>;
};

/** 需工厂品类文案：Vinyl、布帘 / 品类待确认 / 无需工厂 */
export function factoryText(f: RepairListItem["factory"]): string {
  if (!f.any) return "无需工厂";
  const labels = f.categories.map((c) => c.label);
  if (f.unknown) labels.push("品类待确认");
  return labels.join("、");
}
