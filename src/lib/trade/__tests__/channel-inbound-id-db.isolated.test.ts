/**
 * 通道入站标识跨组织唯一（OCD-2 保存时检查）— 真实 DB（隔离库）
 *
 *   渠道接口保存 WhatsApp phoneNumberId / 公众号原始 ID：与其他组织启用通道里的标识相同 → 409（中文提示、
 *   不透露是哪个组织、不写入）；本组织重复保存不算冲突；对方通道停用后可以保存，停用方再启用时被拒；
 *   微信四个字段之间交叉比较；没有入站标识的配置照常保存；两个组织并发保存同一标识只有一个成功。
 *   上线前检查：绕过接口写进库的重复能被 listCrossOrgInboundIdDuplicates / 检查脚本列出（只有组织 id 与通道 id，
 *   不打印标识值与凭证）；入站解析对这类重复仍失败即关闭。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业。
 */
import { spawnSync } from "node:child_process";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过通道入站标识唯一性 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Channel inbound id uniqueness DB test" });

// 路由级测试需要签发会话（仅本进程内的测试密钥）
process.env.JWT_SECRET = process.env.JWT_SECRET || "channel-id-isolated-test-secret-0123456789";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { upsertChannel, ChannelInboundIdConflictError } = await import("@/lib/trade/channel-service");
  const { listCrossOrgInboundIdDuplicates, findTradeChannelOrgByWhatsAppPhoneNumberId, findTradeChannelOrgByWechatToUserName } = await import("@/lib/trade/inbound-org");
  const channelsRoute = await import("@/app/api/trade/channels/route");

  const stamp = Date.now().toString(36);
  const ORG_A = `chidorga_${stamp}`;
  const ORG_B = `chidorgb_${stamp}`;
  const ORG_C = `chidorgc_${stamp}`;
  const ORG_D = `chidorgd_${stamp}`;
  const orgs = [ORG_A, ORG_B, ORG_C, ORG_D];
  const OWNER_A = `chidownera_${stamp}`;
  const OWNER_B = `chidownerb_${stamp}`;
  const users = [OWNER_A, OWNER_B];
  // phone_number_id / 原始 ID 全局比较（不分组织）：每次运行用不同值，避免与残留夹具冲突
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const PNID = `7${n}1`;
  const PNID_RACE = `7${n}2`;
  const PNID_LEGACY = `7${n}3`;
  const GH = `gh_chid${stamp}`;
  const GH_B = `gh_chidb${stamp}`;
  const TOKEN_A = `wa-token-a-${stamp}-secret`;

  await db.user.create({ data: { id: OWNER_A, email: `${OWNER_A}@fixture.test`, name: "Example Owner A", role: "trade" } });
  await db.user.create({ data: { id: OWNER_B, email: `${OWNER_B}@fixture.test`, name: "Example Owner B", role: "trade" } });
  await db.organization.create({ data: { id: ORG_A, name: "Example Textiles Fixture", code: `chida-${stamp}`, ownerId: OWNER_A } });
  await db.organization.create({ data: { id: ORG_B, name: "Maple Home Goods Fixture", code: `chidb-${stamp}`, ownerId: OWNER_B } });
  await db.organization.create({ data: { id: ORG_C, name: "Harbor Linen Fixture", code: `chidc-${stamp}`, ownerId: OWNER_A } });
  await db.organization.create({ data: { id: ORG_D, name: "Cedar Bath Fixture", code: `chidd-${stamp}`, ownerId: OWNER_B } });
  await db.organizationMember.create({ data: { orgId: ORG_A, userId: OWNER_A, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OWNER_B, role: "org_owner", status: "active" } });

  const session = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: "trade" })}`;
  const cookieA = await session(OWNER_A);
  const cookieB = await session(OWNER_B);
  const save = async (cookie: string, body: Record<string, unknown>) => {
    const res = await channelsRoute.POST(
      new NextRequest("http://localhost/api/trade/channels", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-forwarded-for": "10.30.0.2" },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const channelOf = (orgId: string, channel: string) => db.tradeChannel.findUnique({ where: { orgId_channel: { orgId, channel } } });

  try {
    console.log("\n[1] WhatsApp phoneNumberId：另一组织的启用通道已用 → 409，不写入");
    const a1 = await save(cookieA, { orgId: ORG_A, channel: "whatsapp", name: "WA A", config: { accessToken: TOKEN_A, phoneNumberId: PNID } });
    ok(a1.status === 201, "组织 A 首次保存 → 201", a1);
    const b1 = await save(cookieB, { orgId: ORG_B, channel: "whatsapp", name: "WA B", config: { accessToken: `wa-token-b-${stamp}`, phoneNumberId: ` ${PNID} ` } });
    const b1Text = JSON.stringify(b1.body);
    ok(
      b1.status === 409 && b1.body.code === "INBOUND_ID_CONFLICT" && b1.body.field === "phoneNumberId" && /已被其他组织的启用通道使用/.test(String(b1.body.error)),
      "组织 B 用同一 phoneNumberId（前后带空格也算同一个）→ 409 + 中文提示",
      b1,
    );
    ok(!b1Text.includes(ORG_A) && !b1Text.includes(TOKEN_A) && !b1Text.includes("Example Textiles"), "409 不透露占用方组织 / 凭证", b1Text);
    ok((await channelOf(ORG_B, "whatsapp")) === null, "组织 B 的 WhatsApp 通道没有写入");

    console.log("\n[2] 本组织重复保存不算冲突；停用 / 再启用");
    const a2 = await save(cookieA, { orgId: ORG_A, channel: "whatsapp", name: "WA A renamed", config: { accessToken: TOKEN_A, phoneNumberId: PNID } });
    ok(a2.status === 201 && (await channelOf(ORG_A, "whatsapp"))?.name === "WA A renamed", "组织 A 重复保存同一 phoneNumberId → 201", a2);
    await db.tradeChannel.update({ where: { orgId_channel: { orgId: ORG_A, channel: "whatsapp" } }, data: { status: "inactive" } });
    const b2 = await save(cookieB, { orgId: ORG_B, channel: "whatsapp", name: "WA B", config: { accessToken: `wa-token-b-${stamp}`, phoneNumberId: PNID } });
    ok(b2.status === 201 && (await channelOf(ORG_B, "whatsapp"))?.status === "active", "占用方通道停用后，组织 B 可以保存（只和启用通道比较）", b2);
    const a3 = await save(cookieA, { orgId: ORG_A, channel: "whatsapp", name: "WA A", config: { accessToken: TOKEN_A, phoneNumberId: PNID } });
    ok(a3.status === 409 && (await channelOf(ORG_A, "whatsapp"))?.status === "inactive", "组织 A 再保存（会重新启用）→ 409，仍保持停用", a3);
    const resolved = await findTradeChannelOrgByWhatsAppPhoneNumberId(PNID);
    ok(resolved?.orgId === ORG_B, "入站解析只命中唯一的启用通道（组织 B）", resolved);

    console.log("\n[3] 微信：originalId / toUserName / ghId / wechatId 之间交叉比较");
    const wa = await save(cookieA, { orgId: ORG_A, channel: "wechat", name: "OA A", config: { appId: "wx-a", appSecret: `wx-secret-a-${stamp}`, originalId: GH } });
    ok(wa.status === 201, "组织 A 保存公众号 originalId → 201", wa);
    const wb = await save(cookieB, { orgId: ORG_B, channel: "wechat", name: "OA B", config: { appId: "wx-b", appSecret: `wx-secret-b-${stamp}`, ghId: GH } });
    ok(wb.status === 409 && wb.body.field === "ghId" && String(wb.body.error).includes("ghId"), "组织 B 把同一值填在 ghId → 409（提示撞上的字段）", wb);
    const wb2 = await save(cookieB, { orgId: ORG_B, channel: "wechat", name: "OA B", config: { appId: "wx-b", appSecret: `wx-secret-b-${stamp}`, toUserName: GH_B, wechatId: GH_B } });
    ok(wb2.status === 201, "组织 B 用自己的原始 ID → 201", wb2);

    console.log("\n[4] 没有入站标识的配置照常保存；其他通道类型不检查");
    const noId = await save(cookieA, { orgId: ORG_A, channel: "wechat_work", name: "WeCom A", config: { corpId: "ww-shared", corpSecret: `ww-secret-${stamp}`, agentId: "1000002" } });
    const noId2 = await save(cookieB, { orgId: ORG_B, channel: "wechat_work", name: "WeCom B", config: { corpId: "ww-shared", corpSecret: `ww-secret-b-${stamp}`, agentId: "1000002" } });
    ok(noId.status === 201 && noId2.status === 201, "企业微信同一 corpId 不受影响（入站不按它解析组织）", { a: noId.status, b: noId2.status });

    console.log("\n[5] 两个组织并发保存同一新标识：只有一个成功");
    const race = await Promise.allSettled([
      upsertChannel({ orgId: ORG_C, channel: "whatsapp", name: "WA C", config: { phoneNumberId: PNID_RACE } }),
      upsertChannel({ orgId: ORG_D, channel: "whatsapp", name: "WA D", config: { phoneNumberId: PNID_RACE } }),
    ]);
    const won = race.filter((r) => r.status === "fulfilled").length;
    const lost = race.filter((r) => r.status === "rejected" && r.reason instanceof ChannelInboundIdConflictError).length;
    const activeWithRace = await db.tradeChannel.count({ where: { channel: "whatsapp", status: "active", config: { path: ["phoneNumberId"], equals: PNID_RACE } } });
    ok(won === 1 && lost === 1 && activeWithRace === 1, "一个写入、一个 ChannelInboundIdConflictError；库里只有一条", { won, lost, activeWithRace });

    console.log("\n[6] 上线前检查：绕过接口写入的存量重复能被列出；入站仍失败即关闭");
    await db.tradeChannel.upsert({
      where: { orgId_channel: { orgId: ORG_C, channel: "whatsapp" } },
      create: { orgId: ORG_C, channel: "whatsapp", name: "legacy C", status: "active", config: { phoneNumberId: PNID_LEGACY } },
      update: { status: "active", config: { phoneNumberId: PNID_LEGACY } },
    });
    await db.tradeChannel.upsert({
      where: { orgId_channel: { orgId: ORG_D, channel: "whatsapp" } },
      create: { orgId: ORG_D, channel: "whatsapp", name: "legacy D", status: "active", config: { phoneNumberId: PNID_LEGACY, accessToken: `wa-legacy-${stamp}-secret` } },
      update: { status: "active", config: { phoneNumberId: PNID_LEGACY, accessToken: `wa-legacy-${stamp}-secret` } },
    });
    await db.tradeChannel.create({ data: { orgId: ORG_C, channel: "wechat", name: "legacy oa C", status: "active", config: { originalId: `${GH}_legacy` } } });
    await db.tradeChannel.create({ data: { orgId: ORG_D, channel: "wechat", name: "legacy oa D", status: "active", config: { wechatId: `${GH}_legacy` } } });
    const chC = (await channelOf(ORG_C, "whatsapp"))!;
    const chD = (await channelOf(ORG_D, "whatsapp"))!;
    const oaC = (await channelOf(ORG_C, "wechat"))!;
    const oaD = (await channelOf(ORG_D, "wechat"))!;
    const groups = await listCrossOrgInboundIdDuplicates();
    const waGroup = groups.find((g) => g.channel === "whatsapp" && g.channels.some((c) => c.channelId === chC.id));
    const oaGroup = groups.find((g) => g.channel === "wechat" && g.channels.some((c) => c.channelId === oaC.id));
    ok(
      !!waGroup && waGroup.keys.join() === "phoneNumberId" && waGroup.channels.length === 2 && waGroup.channels.some((c) => c.orgId === ORG_D && c.channelId === chD.id),
      "列出 WhatsApp 存量重复：两个组织 id + 通道 id",
      waGroup,
    );
    ok(!!oaGroup && oaGroup.keys.join() === "originalId,wechatId" && oaGroup.channels.some((c) => c.orgId === ORG_D && c.channelId === oaD.id), "列出微信跨字段存量重复", oaGroup);
    ok(!groups.some((g) => g.channels.some((c) => c.orgId === ORG_A || c.orgId === ORG_B)), "接口保存的通道没有被列为重复（停用的不算）", groups.filter((g) => g.channels.some((c) => orgs.includes(c.orgId))));
    ok(!JSON.stringify(groups).includes(PNID_LEGACY) && !JSON.stringify(groups).includes("secret"), "结果里没有标识值与凭证");
    ok(
      (await findTradeChannelOrgByWhatsAppPhoneNumberId(PNID_LEGACY)) === null && (await findTradeChannelOrgByWechatToUserName(`${GH}_legacy`)) === null,
      "入站解析遇到存量重复仍拒绝（不按行序猜）",
    );

    // 与仓库里其他测试一致：从仓库根目录运行
    const run = spawnSync("npx", ["tsx", "scripts/check-duplicate-channel-ids.ts"], { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 120_000 });
    const out = `${run.stdout}\n${run.stderr}`;
    ok(
      run.status === 1 && out.includes(`org=${ORG_C} channel=${chC.id}`) && out.includes(`org=${ORG_D} channel=${chD.id}`) && out.includes(`channel=${oaD.id}`),
      "检查脚本：有重复 → 退出码 1，打印组织 id 与通道 id",
      { status: run.status, out: out.slice(0, 600) },
    );
    ok(!out.includes(PNID_LEGACY) && !out.includes(`${GH}_legacy`) && !out.includes(`wa-legacy-${stamp}`), "检查脚本不打印标识值与凭证");
  } finally {
    try {
      await db.tradeChannel.deleteMany({ where: { orgId: { in: orgs } } });
      await db.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
      await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
      await db.organization.deleteMany({ where: { id: { in: orgs } } });
      await db.auditLog.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成（不覆盖原始错误）：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }

  console.log(`\n通道入站标识唯一性 DB 测试结果: ${pass} 通过, ${fail} 失败`);
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
