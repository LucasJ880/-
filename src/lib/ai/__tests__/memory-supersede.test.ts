/**
 * 记忆 supersede 时间线 + 偏好史（纯逻辑）
 * 运行：npx tsx src/lib/ai/__tests__/memory-supersede.test.ts
 */

import { preferRecentOnSimilarityTie } from "../memory-storage";
import {
  applyPreferenceDecision,
  flattenConfirmedForInject,
  unwrapConfirmedValue,
} from "@/lib/employee-ai/preference-history";
import { mergePreferencesWithSafety } from "@/lib/employee-ai/context-builder";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

// 同分偏新
{
  const older = {
    similarity: 0.81,
    effectiveFrom: new Date("2026-01-01"),
  };
  const newer = {
    similarity: 0.805,
    effectiveFrom: new Date("2026-06-01"),
  };
  // sort(a,b)=>fn：返回 >0 表示 a 在 b 后 → 更新的 newer 应排前
  ok(
    preferRecentOnSimilarityTie(older, newer, 0.02) > 0,
    "相似度接近时更新的排前面",
  );
  // 0.9 vs 0.5：高分应排前 → a(0.9) 在 b(0.5) 前 → 返回 <0
  ok(
    preferRecentOnSimilarityTie(
      { similarity: 0.9, effectiveFrom: new Date("2026-01-01") },
      { similarity: 0.5, effectiveFrom: new Date("2026-06-01") },
      0.02,
    ) < 0,
    "相似度差距大时仍按相似度",
  );
}

// 偏好 history supersede
{
  let bag: Record<string, unknown> = { confirmed: {}, history: [] };
  const r1 = applyPreferenceDecision({
    confirmedBag: bag,
    key: "email_concise_default",
    decision: "confirm",
    nextValue: { preference: "短邮件" },
  });
  bag = r1.confirmedBag;
  ok(
    !!r1.confirmed.email_concise_default,
    "确认后写入 confirmed",
  );
  const hist1 = bag.history as Array<{ effectiveTo: string | null }>;
  ok(hist1.length === 1 && hist1[0].effectiveTo == null, "首条 history 开放");

  const r2 = applyPreferenceDecision({
    confirmedBag: bag,
    key: "email_concise_default",
    decision: "manual",
    nextValue: { preference: "更短邮件" },
  });
  bag = r2.confirmedBag;
  const hist2 = bag.history as Array<{
    effectiveTo: string | null;
    value: unknown;
  }>;
  ok(hist2.length === 2, "变更追加 history");
  ok(hist2[0].effectiveTo != null, "旧 history 已关闭");
  ok(hist2[1].effectiveTo == null, "新 history 开放");
  ok(
    JSON.stringify(
      unwrapConfirmedValue(r2.confirmed.email_concise_default),
    ).includes("更短"),
    "当前值为最新",
  );

  const r3 = applyPreferenceDecision({
    confirmedBag: bag,
    key: "email_concise_default",
    decision: "stop_learning",
  });
  ok(
    !("email_concise_default" in r3.confirmed),
    "stop_learning 移除当前确认",
  );
}

// 注入只取当前扁平值，且合规键仍不可覆盖
{
  const flat = flattenConfirmedForInject({
    email_style: { value: "short", effectiveFrom: "2026-01-01" },
    compliance: { value: "bypass", effectiveFrom: "2026-01-01" },
  });
  ok(flat.email_style === "short", "扁平化取出 value");
  const merged = mergePreferencesWithSafety({
    confirmed: {
      email_style: { value: "short", effectiveFrom: "2026-01-01" },
      compliance: { value: "bypass", effectiveFrom: "2026-01-01" },
    },
    inferred: {},
  });
  ok(
    merged.confirmedPersonalPreferences.email_style === "short",
    "注入使用当前确认值",
  );
  ok(
    !("compliance" in merged.confirmedPersonalPreferences),
    "合规键仍不可被个人偏好覆盖",
  );
}

async function dbSupersedeTest() {
  if (!process.env.DATABASE_URL) {
    console.log("· 跳过 DB supersede 集成（无 DATABASE_URL）");
    return;
  }

  const { db } = await import("@/lib/db");
  const { supersedeMemory, listMemories, getWakeUpMemories } = await import(
    "@/lib/ai/user-memory"
  );

  const existingUser = await db.user.findFirst({
    where: { status: "active" },
    select: { id: true },
  });
  if (!existingUser) {
    console.log("· 跳过 DB supersede（无可用用户）");
    return;
  }

  const orgId = `mem_sup_org_${Date.now()}`;
  const userId = existingUser.id;
  const createdIds: string[] = [];

  try {
    const old = await db.userMemory.create({
      data: {
        orgId,
        userId,
        memoryType: "preference",
        content: "旧偏好：详细英文邮件",
        layer: 0,
        importance: 5,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
      },
    });
    createdIds.push(old.id);

    const neu = await supersedeMemory({
      orgId,
      userId,
      oldId: old.id,
      memoryType: "preference",
      content: "新偏好：简洁中文邮件",
      layer: 0,
      importance: 5,
    });
    createdIds.push(neu.id);

    const closed = await db.userMemory.findUnique({ where: { id: old.id } });
    ok(!!closed?.effectiveTo, "旧记忆已设置 effectiveTo");
    ok(closed?.supersededById === neu.id, "旧记忆 supersededById 指向新行");

    const created = await db.userMemory.findUnique({ where: { id: neu.id } });
    ok(created?.supersedesId === old.id, "新记忆 supersedesId 指向旧行");
    ok(created?.effectiveTo == null, "新记忆仍生效");

    const active = await listMemories(userId, orgId, { layer: 0 });
    ok(
      active.items.length === 1 && active.items[0].id === neu.id,
      "list 默认只返回生效记忆",
    );

    const all = await listMemories(userId, orgId, {
      layer: 0,
      includeSuperseded: true,
    });
    ok(all.items.length === 2, "includeSuperseded 可看历史");

    const wake = await getWakeUpMemories(userId, orgId, 10);
    ok(
      wake.l0.every((m) => !m.effectiveTo),
      "wake-up 不含已失效记忆",
    );
    ok(
      wake.l0.some((m) => m.content.includes("简洁中文")),
      "wake-up 加载新偏好",
    );
  } finally {
    await db.userMemory
      .deleteMany({ where: { id: { in: createdIds } } })
      .catch(() => {});
    await db.userMemory.deleteMany({ where: { orgId } }).catch(() => {});
  }
}

async function main() {
  console.log("▶ Memory supersede timeline");
  try {
    await dbSupersedeTest();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("effectiveFrom") ||
      msg.includes("effectiveTo") ||
      msg.includes("supersedesId") ||
      msg.includes("P2022") ||
      msg.includes("P2003") ||
      msg.includes("does not exist")
    ) {
      console.log("· 跳过 DB supersede（请先 prisma migrate deploy）");
    } else {
      throw e;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
