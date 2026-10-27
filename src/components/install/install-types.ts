/** INSTALL-1：/api/install 响应类型（客户端共用） */

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
    allCompleted: boolean;
  } | null;
};

export type InstallPhoto = {
  proxyUrl: string;
  pathname: string;
  note: string | null;
  at: string;
  byUserId: string;
};

export type InstallWindow = {
  itemId: string;
  itemNumber: number;
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
};

export type InstallTaskDetailData = InstallTaskSummary & {
  notes: string | null;
  remarks: string | null;
  windows: InstallWindow[];
  closeout: { total: number; completed: number; allCompleted: boolean };
};

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
