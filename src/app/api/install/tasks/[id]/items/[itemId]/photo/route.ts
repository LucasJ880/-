/**
 * POST /api/install/tasks/[id]/items/[itemId]/photo  (multipart: file, note?)
 * INSTALL-1：逐窗拍照收口。
 * - 操作者须是该任务被分配人或持 install.window.complete（ORG）
 * - 只接受 jpeg / png / webp，≤ 8MB
 * - 私有 Blob install-photos/{orgId}/{orderId}/{单元 id}/{ts}.{ext}
 * - 审计 install.window.completed 作为收口记录；返回该单元最新记录
 * - itemId 不属于该任务工艺单的收口单元 → 404
 * INSTALL-2a：itemId 可为工艺参数单元 `spec-<段>-<下标>`（审计 targetType blinds_order_unit，afterData 存位置快照）；
 * 收口记录写入失败 → 500 提示重拍，不再假成功（design D5）。
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { writeAuditLog } from "@/lib/audit/logger";
import { putPrivateBlob } from "@/lib/files/blob-access";
import {
  aggregateCloseout,
  INSTALL_TARGET_ITEM,
  INSTALL_TARGET_UNIT,
  INSTALL_WINDOW_COMPLETED,
  installPhotoPathname,
  validatePhotoUpload,
} from "@/lib/install/closeout";
import {
  authorizeInstallTask,
  installForbidden,
  installNoOrder,
  installNotFound,
  loadCloseoutLogs,
  loadInstallTask,
  loadOrderForTask,
  loadOrderUnits,
} from "@/lib/install/service";

const UPLOAD_RATE_LIMIT = { name: "install-photo", windowMs: 60_000, maxRequests: 30 } as const;

export const POST = withAuth<{ id: string; itemId: string }>(async (request, ctx, user) => {
  const { id, itemId } = await ctx.params;

  const rl = await checkRateLimitAsync(UPLOAD_RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "上传过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const task = await loadInstallTask(id);
  if (!task) return installNotFound();

  const decision = await authorizeInstallTask(user, task, "install.window.complete");
  if (!decision.allowed) return installForbidden();

  if (task.status === "completed" || task.status === "cancelled") {
    return NextResponse.json(
      { error: `任务已${task.status === "completed" ? "完成" : "取消"}，不能再上传`, code: "BAD_STATUS" },
      { status: 409 },
    );
  }

  const order = await loadOrderForTask(task.id);
  if (!order) return installNoOrder();
  const units = await loadOrderUnits(order);
  const unit = units.find((u) => u.id === itemId);
  if (!unit) return NextResponse.json({ error: "该窗不属于此工艺单" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传照片" }, { status: 400 });
  }
  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 200) : "";

  const check = validatePhotoUpload({ contentType: file.type, size: file.size });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const pathname = installPhotoPathname({
    orgId: task.customer.orgId,
    orderId: order.id,
    itemId: unit.id,
    ext: check.ext,
  });
  const stored = await putPrivateBlob({
    pathname,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: check.contentType,
  });

  try {
    await writeAuditLog(db, {
      userId: user.id,
      orgId: task.customer.orgId,
      action: INSTALL_WINDOW_COMPLETED,
      targetType: unit.section === "blinds" ? INSTALL_TARGET_ITEM : INSTALL_TARGET_UNIT,
      targetId: unit.logTargetId,
      afterData: {
        orderId: order.id,
        appointmentId: task.id,
        itemNumber: unit.itemNumber,
        unitId: unit.id,
        section: unit.section,
        location: unit.location,
        pathname: stored.pathname,
        proxyUrl: stored.proxyUrl,
        note,
        byUserId: user.id,
        size: file.size,
        contentType: check.contentType,
      },
      request,
    });
  } catch (err) {
    console.error("[install/photo] 收口记录写入失败", err);
    return NextResponse.json(
      { error: "照片已上传但收口记录保存失败，请重拍", code: "RECORD_FAILED" },
      { status: 500 },
    );
  }

  const logs = await loadCloseoutLogs([unit]);
  const window = aggregateCloseout([unit], logs).windows[0];
  // 记录已写入；极端情况下（读到之前参数被改）仍返回本次记录
  const latest = window?.latest ?? {
    proxyUrl: stored.proxyUrl,
    pathname: stored.pathname,
    note: note || null,
    at: new Date().toISOString(),
    byUserId: user.id,
    location: unit.location,
  };
  return NextResponse.json({
    ok: true,
    itemId: unit.id,
    itemNumber: unit.itemNumber,
    photoCount: Math.max(1, window?.photoCount ?? 0),
    latest,
  });
});
