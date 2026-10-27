import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit/logger";
import { requestApproval } from "@/lib/approval/port";
import {
  loadDiscountsDto,
  saveDiscountsForOrg,
  validateDiscountsInput,
  validateCostRatesInput,
  DTO_NUMERIC_KEYS,
  type DiscountsDto,
  type DiscountSavePatch,
} from "@/lib/blinds/discount-settings";
import { hashUnlockCode } from "@/lib/blinds/unlock-code";
import { requireTenantContext } from "@/lib/tenancy";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { legacyApprovalFallback, listUsersWithPermission, pickApprovalRecipients } from "@/lib/sales/approvers";
import {
  QUOTE_SETTINGS_ACTION_TYPE,
  buildQuoteSettingsApprovalPayload,
  describeQuoteSettingsPatch,
  quoteSettingsIdempotencyKey,
} from "@/lib/sales/quote-settings-approval";

const TARGET_TYPE = "quote_discount_settings";
const SETTINGS_PERMISSION = "sales.settings.manage";

function parseUnlockPlain(
  body: Record<string, unknown>,
  key: string,
):
  | { ok: true; value?: string | null }
  | { ok: false; error: string } {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { ok: true };
  }
  const raw = body[key];
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${key} 必须是字符串或 null` };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return { ok: false, error: "解锁码长度需为 3~64 个字符" };
  }
  return { ok: true, value: trimmed };
}

/**
 * GET /api/sales/quote-settings/discounts
 * 永不返回解锁码明文或哈希
 */
export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const dto = await loadDiscountsDto(tenant.orgId);
  const isPlatform = isPlatformSuperAdmin(tenant.user.role);
  const canEdit =
    isPlatform ||
    (
      await authorize({
        principal: humanPrincipal(tenant.user, tenant.orgId),
        orgId: tenant.orgId,
        permission: SETTINGS_PERMISSION,
      })
    ).allowed;
  return NextResponse.json({ ...dto, canEdit });
}

/**
 * PUT /api/sales/quote-settings/discounts
 *
 * PERM-2：
 *   - 需持 sales.settings.manage（老板岗）或为平台 super_admin，否则 403
 *   - 平台 super_admin：直接落库，审计 selfApproved / actorKind=platform_admin，200
 *   - 其他人：不落库，建 PendingAction sales.update_quote_settings（payload 只含 diff 与解锁码哈希），202
 * body 可含 depositOverrideCode / lineDiscountUnlockCode（明文一次提交，立即哈希）
 */
export async function PUT(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const isPlatform = isPlatformSuperAdmin(tenant.user.role);
  if (!isPlatform) {
    const authz = await authorize({
      principal: humanPrincipal(tenant.user, tenant.orgId),
      orgId: tenant.orgId,
      permission: SETTINGS_PERMISSION,
    });
    if (!authz.allowed) {
      return NextResponse.json(
        { error: "仅持有销售设置权限的岗位（老板）可修改折扣率", code: authz.reasonCode },
        { status: 403 },
      );
    }
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  delete body.orgId;

  const parsed = validateDiscountsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const depositParsed = parseUnlockPlain(body, "depositOverrideCode");
  if (!depositParsed.ok) {
    return NextResponse.json({ error: depositParsed.error }, { status: 400 });
  }
  const lineParsed = parseUnlockPlain(body, "lineDiscountUnlockCode");
  if (!lineParsed.ok) {
    return NextResponse.json({ error: lineParsed.error }, { status: 400 });
  }

  let costRates: Record<string, number> | undefined;
  if (body.costRates !== undefined) {
    const costParsed = validateCostRatesInput(body.costRates);
    if (!costParsed.ok) {
      return NextResponse.json({ error: costParsed.error }, { status: 400 });
    }
    costRates = costParsed.value;
  }

  // 解锁码：立即哈希，明文不再向下传递
  const depositHash =
    depositParsed.value === undefined
      ? undefined
      : depositParsed.value === null
        ? null
        : await hashUnlockCode(depositParsed.value);
  const lineHash =
    lineParsed.value === undefined
      ? undefined
      : lineParsed.value === null
        ? null
        : await hashUnlockCode(lineParsed.value);

  const before = await loadDiscountsDto(tenant.orgId);

  if (!isPlatform) {
    const payload = buildQuoteSettingsApprovalPayload({
      orgId: tenant.orgId,
      requestedById: tenant.userId,
      settingsVersion: before.version,
      numericPatch: parsed.value as Record<string, number>,
      costRates,
      depositOverrideCodeHash: depositHash,
      lineDiscountUnlockCodeHash: lineHash,
    });
    const [holders, fallback] = await Promise.all([
      listUsersWithPermission(tenant.orgId, SETTINGS_PERMISSION),
      legacyApprovalFallback(tenant.orgId),
    ]);
    const recipients = pickApprovalRecipients({ holders, fallback, requesterId: tenant.userId });
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "没有另一位可审批销售设置的人（老板岗位），请联系平台管理员" },
        { status: 409 },
      );
    }
    const idempotencyKey = quoteSettingsIdempotencyKey(payload);
    const summary = describeQuoteSettingsPatch(payload);
    // 新审批一律走 canonical 入口 requestApproval（runtime-architecture 守卫禁止直接写 PendingAction）
    const approval = await requestApproval({
      orgId: tenant.orgId,
      principal: { userId: tenant.userId, actorType: "user" },
      actionType: QUOTE_SETTINGS_ACTION_TYPE,
      title: "审批销售设置修改（折扣表 / 费用 / 解锁码）",
      preview: `${tenant.user.name || tenant.user.email} 申请修改：${summary}`,
      payload: payload as unknown as Record<string, unknown>,
      // 改价政策：与超限让利同级（高风险，必须人工批准）
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
      source: { module: "sales.quote-settings", toolName: "quote_settings_update", stepKey: `quote-settings:${tenant.orgId}:v${before.version}` },
      approver: { approverUserId: recipients[0], requiredRole: "org_owner" },
      ttlHours: 24 * 7,
      idempotencyKey,
      policyVersion: "quote-settings-v1",
      resourceVersion: String(before.version),
    });
    if (!approval.ok) {
      return NextResponse.json({ error: `生成审批失败：${approval.error}` }, { status: 500 });
    }
    const actionId = approval.actionIds[0] ?? "";
    await logAudit({
      userId: tenant.userId,
      orgId: tenant.orgId,
      action: "quote_settings_update_requested",
      targetType: TARGET_TYPE,
      afterData: { approvalId: actionId, summary, settingsVersion: before.version },
      request: request as import("next/server").NextRequest,
    });
    const href = `/capabilities/approvals/${encodeURIComponent(`PENDING_ACTION:${actionId}`)}`;
    const notified = await createNotificationsForUsers(recipients, {
      sourceKeyPrefix: `quote-settings-approval:${actionId}`,
      orgId: tenant.orgId,
      type: "quote_settings_approval",
      category: "approval",
      title: "销售设置修改请求审批",
      summary: `${tenant.user.name || tenant.user.email} 申请修改：${summary}`,
      entityType: "approval",
      entityId: `PENDING_ACTION:${actionId}`,
      priority: "high",
      metadata: { href, requesterUserId: tenant.userId },
    });
    return NextResponse.json(
      { pending: true, approvalId: `PENDING_ACTION:${actionId}`, notified, summary },
      { status: 202 },
    );
  }

  // 平台管理员：直接生效，留自批痕迹
  const patch: DiscountSavePatch = { ...parsed.value };
  if (costRates !== undefined) patch.costRates = costRates;
  if (depositHash !== undefined) patch.depositOverrideCodeHashed = depositHash;
  if (lineHash !== undefined) patch.lineDiscountUnlockCodeHashed = lineHash;

  const after = await saveDiscountsForOrg({
    orgId: tenant.orgId,
    userId: tenant.userId,
    patch,
  });

  const diff: Record<string, { from: number; to: number }> = {};
  for (const k of DTO_NUMERIC_KEYS) {
    if (before[k] !== after[k]) {
      diff[k] = { from: before[k], to: after[k] };
    }
  }
  const costRatesChanged =
    JSON.stringify(before.costRates) !== JSON.stringify(after.costRates);
  const depositCodeChanged =
    before.hasDepositOverrideCode !== after.hasDepositOverrideCode ||
    depositParsed.value !== undefined;
  const lineCodeChanged =
    before.hasLineDiscountUnlockCode !== after.hasLineDiscountUnlockCode ||
    lineParsed.value !== undefined;

  if (Object.keys(diff).length > 0 || depositCodeChanged || lineCodeChanged || costRatesChanged) {
    await logAudit({
      userId: tenant.userId,
      orgId: tenant.orgId,
      action: "update",
      targetType: TARGET_TYPE,
      beforeData: {
        discounts: pickRates(before),
        version: before.version,
        hasDepositOverrideCode: before.hasDepositOverrideCode,
        hasLineDiscountUnlockCode: before.hasLineDiscountUnlockCode,
      },
      afterData: {
        discounts: pickRates(after),
        version: after.version,
        diff,
        selfApproved: true,
        actorKind: "platform_admin",
        ...(costRatesChanged ? { costRates: after.costRates } : {}),
        hasDepositOverrideCode: after.hasDepositOverrideCode,
        hasLineDiscountUnlockCode: after.hasLineDiscountUnlockCode,
        ...(depositCodeChanged ? { depositUnlockCodeChanged: true } : {}),
        ...(lineCodeChanged ? { lineDiscountUnlockCodeChanged: true } : {}),
      },
      request: request as import("next/server").NextRequest,
    });
  }

  return NextResponse.json({
    ...after,
    canEdit: true,
    changed:
      Object.keys(diff).length > 0 || depositCodeChanged || lineCodeChanged || costRatesChanged,
    diff,
  });
}

function pickRates(d: DiscountsDto) {
  const { updatedAt: _ua, updatedBy: _ub, ...rates } = d;
  return rates;
}
