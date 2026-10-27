/**
 * INSTALL-1：逐窗收口（纯函数）
 *
 * 收口记录 = AuditLog 行：action "install.window.completed"，targetType "blinds_order_item"，targetId = 窗 id，
 * afterData JSON { orderId, appointmentId, pathname, proxyUrl, note, byUserId }。
 * 同一窗可补拍：最新一条为当前照片，张数 = 记录数。
 */

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

export type WindowItem = {
  id: string;
  itemNumber: number;
  location: string;
  width: number;
  height: number;
  productType: string;
  fabricSku: string;
};

export type CloseoutLog = {
  targetId: string | null;
  createdAt: Date | string;
  userId: string;
  afterData: string | null;
};

export type CloseoutPhoto = {
  proxyUrl: string;
  pathname: string;
  note: string | null;
  at: string;
  byUserId: string;
};

export type WindowCloseout = {
  itemId: string;
  itemNumber: number;
  location: string;
  photoCount: number;
  latest: CloseoutPhoto | null;
  photos: CloseoutPhoto[];
};

export type CloseoutSummary = {
  windows: WindowCloseout[];
  total: number;
  completed: number;
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
    };
  } catch {
    return null;
  }
}

/** 每窗最新 / 张数；没有记录 = 未收口 */
export function aggregateCloseout(items: WindowItem[], logs: CloseoutLog[]): CloseoutSummary {
  const byItem = new Map<string, CloseoutPhoto[]>();
  for (const log of logs) {
    if (!log.targetId) continue;
    const photo = parsePhoto(log);
    if (!photo) continue;
    if (!byItem.has(log.targetId)) byItem.set(log.targetId, []);
    byItem.get(log.targetId)!.push(photo);
  }
  const windows: WindowCloseout[] = [...items]
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((it) => {
      const photos = (byItem.get(it.id) ?? []).sort((a, b) => b.at.localeCompare(a.at));
      return {
        itemId: it.id,
        itemNumber: it.itemNumber,
        location: it.location,
        photoCount: photos.length,
        latest: photos[0] ?? null,
        photos,
      };
    });
  const completed = windows.filter((w) => w.photoCount > 0).length;
  return { windows, total: windows.length, completed, allCompleted: windows.length > 0 && completed === windows.length };
}

/** 完成收口前的未收口清单（序号 + 位置） */
export function missingWindows(summary: CloseoutSummary): Array<{ itemNumber: number; location: string }> {
  return summary.windows.filter((w) => w.photoCount === 0).map((w) => ({ itemNumber: w.itemNumber, location: w.location }));
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
