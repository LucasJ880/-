/**
 * POST /api/install/tasks/[id]/items/[itemId]/issue  (multipart: file, issueType, description, needsFactory?)
 * INSTALL-2d：标记收口单元"有问题"（spec installation/repairs「标记单元有问题」）。
 * - 权限 / 限流 / 文件类型与大小 / 私有前缀与完工照相同（install.window.complete；design D12）
 * - 问题照必填；类型查表决定是否需工厂（"其他"由安装工选，默认需工厂）；描述必填 ≤ 300 字
 * - 审计 install.window.issue（目标同完工照，afterData 含位置快照）；写入失败 → 500 提示重拍
 * - 任务已完成 / 已取消 → 409；单元不属于该工艺单 → 404
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
  installPhotoPathname,
  validatePhotoUpload,
} from "@/lib/install/closeout";
import { INSTALL_WINDOW_ISSUE, validateIssueInput } from "@/lib/install/repair";
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
      { error: `任务已${task.status === "completed" ? "完成" : "取消"}，不能再标记问题`, code: "BAD_STATUS" },
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
  // 先校验字段与照片，再写文件：400 时不留下孤立文件
  const input = validateIssueInput({
    issueType: form.get("issueType"),
    description: form.get("description"),
    needsFactory: form.get("needsFactory"),
  });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请拍一张问题照片" }, { status: 400 });
  }
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
      action: INSTALL_WINDOW_ISSUE,
      targetType: unit.section === "blinds" ? INSTALL_TARGET_ITEM : INSTALL_TARGET_UNIT,
      targetId: unit.logTargetId,
      afterData: {
        orderId: order.id,
        appointmentId: task.id,
        itemNumber: unit.itemNumber,
        unitId: unit.id,
        section: unit.section,
        location: unit.location,
        issueType: input.value.issueType,
        needsFactory: input.value.needsFactory,
        description: input.value.description,
        pathname: stored.pathname,
        proxyUrl: stored.proxyUrl,
        note: "",
        byUserId: user.id,
        size: file.size,
        contentType: check.contentType,
      },
      request,
    });
  } catch (err) {
    console.error("[install/issue] 问题记录写入失败", err);
    return NextResponse.json(
      { error: "照片已上传但问题记录保存失败，请重拍", code: "RECORD_FAILED" },
      { status: 500 },
    );
  }

  const logs = await loadCloseoutLogs([unit]);
  const window = aggregateCloseout([unit], logs).windows[0];
  return NextResponse.json({
    ok: true,
    itemId: unit.id,
    itemNumber: unit.itemNumber,
    state: window?.state ?? "issue",
    issue: window?.issue ?? null,
  });
});
