/**
 * 微信安全加固 — 真实 DB（隔离库，虚构企业）
 *
 *   [1] 绑定占有证明：没有 / 错误 / 过期验证码不建绑定；别人仍在用的绑定即使验证码正确也不迁移；
 *       本人可刷新；原账号解绑后，新账号凭验证码接手，orgId / 推送偏好 / 过滤 / 静默时段全部重置；
 *       服务端没有密钥时 fail-closed
 *   [2] 微信回数字白名单：对外发送 / 高风险类型（投标询价、活动上线、报价让利、询盘回复）不进批次，
 *       回数字 / 回取消都不会批准或拒绝它们，并提示去网页审批；白名单类型照常进批次
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/messaging/__tests__/wechat-binding-confirm-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过微信安全加固 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "WeChat security DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const HOUR = 3_600_000;

async function main() {
  const { db } = await import("@/lib/db");
  const { createBinding, removeBinding, updateBindingPreferences } = await import("../binding");
  const { BIND_CODE_WINDOW_MS, deriveBindCodeKey, bindCodeKeyFromEnv, issueBindCode } = await import("../binding-proof");
  const { getRecentPendingActionsForWeChat, handleWeChatPendingReply } = await import("@/lib/ai-grader/actions/wechat-confirm");

  const stamp = Date.now().toString(36);
  const ORG_X = `wsX_${stamp}`;
  const ORG_Y = `wsY_${stamp}`;
  const ORGS = [ORG_X, ORG_Y];
  const VICTIM = `wsvictim_${stamp}`;
  const ATTACKER = `wsattacker_${stamp}`;
  const NEWCOMER = `wsnew_${stamp}`;
  const USERS = [VICTIM, ATTACKER, NEWCOMER];
  const KEY = deriveBindCodeKey(`isolated-test-secret-${stamp}`)!;
  const WX = `wx_victim_${stamp}`;
  const code = (externalId = WX, channel: "wecom" | "personal_wechat" = "wecom", at = new Date()) =>
    issueBindCode(KEY, channel, externalId, at)!;

  await db.user.create({ data: { id: VICTIM, email: `${VICTIM}@fixture.test`, name: "Victim Rep", role: "trade" } });
  await db.user.create({ data: { id: ATTACKER, email: `${ATTACKER}@fixture.test`, name: "Curious Colleague", role: "sales" } });
  await db.user.create({ data: { id: NEWCOMER, email: `${NEWCOMER}@fixture.test`, name: "New Account", role: "user" } });
  await db.organization.create({ data: { id: ORG_X, name: "Example Textiles Factory", code: `wsx-${stamp}`, ownerId: VICTIM } });
  await db.organization.create({ data: { id: ORG_Y, name: "Maple Home Goods", code: `wsy-${stamp}`, ownerId: NEWCOMER } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_X, userId: VICTIM, role: "org_owner", status: "active" },
      { orgId: ORG_X, userId: ATTACKER, role: "org_member", status: "active" },
      { orgId: ORG_Y, userId: NEWCOMER, role: "org_owner", status: "active" },
    ],
  });

  const pending = (data: { type: string; createdById?: string; approverUserId?: string; title?: string; orgId?: string | null }) =>
    db.pendingAction.create({
      data: {
        orgId: data.orgId === undefined ? ORG_X : data.orgId,
        type: data.type,
        title: data.title ?? data.type,
        preview: "preview",
        payload: {},
        status: "pending",
        createdById: data.createdById ?? VICTIM,
        approverUserId: data.approverUserId ?? data.createdById ?? VICTIM,
        expiresAt: new Date(Date.now() + 72 * HOUR),
      },
      select: { id: true },
    });
  const statusOf = async (id: string) => (await db.pendingAction.findUnique({ where: { id }, select: { status: true } }))?.status;

  try {
    console.log("\n[1] 绑定占有证明");
    const noCode = await createBinding({ userId: ATTACKER, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: "", bindCodeKey: KEY });
    ok(!noCode.ok && noCode.reason === "invalid_code" && !(await db.weChatBinding.findUnique({ where: { channel_externalId: { channel: "wecom", externalId: WX } } })), "没有验证码：不建绑定（不能自称是别人的企微账号）", noCode);

    const created = await createBinding({ userId: VICTIM, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: code(), displayName: "Victim", bindCodeKey: KEY });
    ok(created.ok && created.outcome === "created" && created.binding.userId === VICTIM && created.binding.orgId === ORG_X && created.binding.pushBriefing === true, "本人凭机器人下发的验证码绑定成功（trade 角色默认推简报）", created);
    const bindingId = created.ok ? created.binding.id : "";
    await updateBindingPreferences(VICTIM, bindingId, { silentStart: "22:00", silentEnd: "08:00", filterMode: "keyword", filterKeyword: "青砚" });

    const wrong = await createBinding({ userId: ATTACKER, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: "ABCD-EFGH", bindCodeKey: KEY });
    const leaked = await createBinding({ userId: ATTACKER, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: code(), bindCodeKey: KEY });
    const afterAttack = await db.weChatBinding.findUnique({ where: { id: bindingId } });
    ok(!wrong.ok && wrong.reason === "invalid_code", "猜验证码：拒绝", wrong);
    ok(
      !leaked.ok && leaked.reason === "owned_by_other_user" && afterAttack?.userId === VICTIM && afterAttack.status === "active" && afterAttack.silentStart === "22:00" && afterAttack.orgId === ORG_X,
      "即使拿到正确验证码，别人仍在用的绑定也不迁移（归属 / 状态 / 偏好都不变）",
      { leaked, afterAttack },
    );

    const refreshed = await createBinding({ userId: VICTIM, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: code(), displayName: "Victim 2", bindCodeKey: KEY });
    const afterRefresh = await db.weChatBinding.findUnique({ where: { id: bindingId } });
    ok(refreshed.ok && refreshed.outcome === "refreshed" && afterRefresh?.userId === VICTIM && afterRefresh.displayName === "Victim 2" && afterRefresh.silentStart === "22:00", "本人再次绑定：刷新昵称，偏好保留", { refreshed, afterRefresh });

    const crossChannel = await createBinding({ userId: VICTIM, orgId: ORG_X, channel: "personal_wechat", externalId: WX, bindCode: code(WX, "wecom"), bindCodeKey: KEY });
    ok(!crossChannel.ok && crossChannel.reason === "invalid_code", "企微的验证码不能拿来绑同名个人微信", crossChannel);

    ok(await removeBinding(VICTIM, bindingId), "原账号解绑");
    const expired = await createBinding({
      userId: NEWCOMER, orgId: ORG_Y, channel: "wecom", externalId: WX,
      bindCode: code(WX, "wecom", new Date(Date.now() - 2 * BIND_CODE_WINDOW_MS - 1000)), bindCodeKey: KEY,
    });
    ok(!expired.ok && expired.reason === "invalid_code", "过期验证码（两个时间窗以前）：拒绝", expired);

    const reclaimed = await createBinding({ userId: NEWCOMER, orgId: ORG_Y, channel: "wecom", externalId: WX, bindCode: code(), displayName: "New", bindCodeKey: KEY });
    const afterReclaim = await db.weChatBinding.findUnique({ where: { id: bindingId } });
    ok(
      reclaimed.ok && reclaimed.outcome === "reclaimed" &&
        afterReclaim?.userId === NEWCOMER && afterReclaim.orgId === ORG_Y && afterReclaim.status === "active" &&
        afterReclaim.silentStart === null && afterReclaim.silentEnd === null && afterReclaim.filterMode === "all" && afterReclaim.filterKeyword === null &&
        afterReclaim.pushBriefing === false && afterReclaim.pushSales === false && afterReclaim.pushDomains === "project",
      "原账号解绑后：新账号凭验证码接手，组织与偏好按新用户重置（不继承上一任的组织）",
      afterReclaim,
    );

    const back = await createBinding({ userId: VICTIM, orgId: ORG_X, channel: "wecom", externalId: WX, bindCode: code(), bindCodeKey: KEY });
    ok(!back.ok && back.reason === "owned_by_other_user" && (await db.weChatBinding.findUnique({ where: { id: bindingId } }))?.userId === NEWCOMER, "接手后原账号也抢不回来（同样要对方先解绑）", back);

    const prevSecret = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      const noSecret = await createBinding({ userId: ATTACKER, orgId: ORG_X, channel: "wecom", externalId: `wx_other_${stamp}`, bindCode: "ABCDEFGH" });
      ok(!noSecret.ok && noSecret.reason === "code_unavailable", "服务端没有 JWT_SECRET：拒绝绑定（fail-closed）", noSecret);
      process.env.JWT_SECRET = `env-secret-${stamp}`;
      const envCode = issueBindCode(bindCodeKeyFromEnv(), "personal_wechat", `wx_attacker_${stamp}`)!;
      const viaEnv = await createBinding({ userId: ATTACKER, orgId: ORG_X, channel: "personal_wechat", externalId: `wx_attacker_${stamp}`, bindCode: envCode });
      ok(viaEnv.ok && viaEnv.outcome === "created" && viaEnv.binding.pushSales === true, "默认密钥来自 JWT_SECRET：个人微信同样凭验证码绑定（sales 角色默认推销售提醒）", viaEnv);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }

    console.log("\n[2] 微信回数字白名单");
    const rfq = await pending({ type: "tender.send_rfq", title: "给 Example Textiles 发询价" });
    const campaign = await pending({ type: "marketing.activate_campaign", title: "活动上线" });
    const promo = await pending({ type: "sales.approve_quote_promotion", title: "报价让利" });
    const inquiry = await pending({ type: "sales.send_inquiry_reply", title: "回复询盘" });
    const unknown = await pending({ type: "marketing.send_blast", title: "未知的新类型" });
    const emptyBatch = await getRecentPendingActionsForWeChat(VICTIM, ORG_X);
    ok(emptyBatch.length === 0, "对外 / 高风险 / 未知类型都不进批次", emptyBatch.map((b) => b.type));

    const one = await handleWeChatPendingReply("1", { userId: VICTIM, orgId: ORG_X });
    const statuses = await Promise.all([rfq, campaign, promo, inquiry, unknown].map((p) => statusOf(p.id)));
    ok(
      one.handled && statuses.every((s) => s === "pending") && /审批中心/.test(one.reply ?? "") && /今日询盘/.test(one.reply ?? ""),
      "回「1」：一个都不批准，提示去审批中心 / 今日询盘",
      { reply: one.reply, statuses },
    );
    const cancel = await handleWeChatPendingReply("取消", { userId: VICTIM, orgId: ORG_X });
    const afterCancel = await Promise.all([rfq, campaign, promo, inquiry, unknown].map((p) => statusOf(p.id)));
    ok(cancel.handled && afterCancel.every((s) => s === "pending") && /审批中心/.test(cancel.reply ?? ""), "回「取消」：也不会拒掉它们", { reply: cancel.reply, afterCancel });

    const note = await pending({ type: "grader.internal_note", title: "内部备注" });
    const batch = await getRecentPendingActionsForWeChat(VICTIM, ORG_X);
    ok(batch.length === 1 && batch[0].id === note.id, "白名单类型照常进批次", batch.map((b) => b.type));
    const outOfRange = await handleWeChatPendingReply("2", { userId: VICTIM, orgId: ORG_X });
    ok(
      outOfRange.handled && /请回复 1-1/.test(outOfRange.reply ?? "") && /审批中心/.test(outOfRange.reply ?? "") && (await statusOf(rfq.id)) === "pending" && (await statusOf(note.id)) === "pending",
      "回超出范围的编号：不执行任何动作，并提示网页审批",
      outOfRange.reply,
    );

    const otherUsers = await pending({ type: "tender.send_rfq", createdById: ATTACKER, approverUserId: ATTACKER, title: "别人的询价" });
    const attackerReply = await handleWeChatPendingReply("1", { userId: ATTACKER, orgId: ORG_X });
    ok(attackerReply.handled && /1 个待审批动作/.test(attackerReply.reply ?? "") && (await statusOf(otherUsers.id)) === "pending", "提示计数只算本人发起 / 指定本人审批的", attackerReply.reply);
  } finally {
    try {
      await db.pendingAction.deleteMany({ where: { OR: [{ orgId: { in: ORGS } }, { createdById: { in: USERS } }] } });
      await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: ORGS } }, { userId: { in: USERS } }] } });
      await db.weChatBinding.deleteMany({ where: { userId: { in: USERS } } });
      await db.organizationMember.deleteMany({ where: { orgId: { in: ORGS } } });
      await db.organization.deleteMany({ where: { id: { in: ORGS } } });
      await db.user.deleteMany({ where: { id: { in: USERS } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
