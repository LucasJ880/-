/**
 * Phase 3A-2：账本写入 DB 专项（需 DATABASE_URL）
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a2-ledger-db.test.ts
 */

import { db } from "@/lib/db";
import { recordAiUsage } from "../usage/record";
import { sanitizeUsageMetadata } from "../usage/sanitize";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  console.log("phase3a2 ledger db");

  const org = await db.organization.findFirst({
    where: { status: "active" },
    select: { id: true },
  });
  if (!org) {
    console.error("  ✗ 无可用 Organization，跳过 DB 测试");
    process.exit(1);
  }

  const key = `test_phase3a2_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const r1 = await recordAiUsage({
    orgId: org.id,
    sourceType: "AGENT_RUNTIME",
    idempotencyKey: key,
    provider: "openai",
    model: "gpt-4o-mini",
    usageType: "TEXT",
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 120,
    costAmount: 0.0001,
    pricingMode: "estimated",
    status: "ESTIMATED",
    metadata: {
      apiKey: "sk-should-not-persist",
      intent: "test",
    },
  });
  ok(r1.ok === true && r1.duplicate === false, "首次写入成功");

  const r2 = await recordAiUsage({
    orgId: org.id,
    sourceType: "AGENT_RUNTIME",
    idempotencyKey: key,
    provider: "openai",
    model: "gpt-4o-mini",
    usageType: "TEXT",
    inputTokens: 100,
    outputTokens: 50,
    costAmount: 0.0001,
    pricingMode: "estimated",
    status: "ESTIMATED",
  });
  ok(r2.ok === true && r2.duplicate === true, "idempotencyKey 防重复");

  const skip = await recordAiUsage({
    orgId: "",
    sourceType: "AGENT_RUNTIME",
    idempotencyKey: `${key}_noorg`,
    provider: "openai",
    model: "gpt-4o-mini",
    usageType: "TEXT",
    costAmount: 0.01,
    status: "ESTIMATED",
  });
  ok(skip.ok === false && skip.reason === "missing_orgId", "无 orgId 不写入");

  if (r1.ok) {
    const row = await db.aiUsageLedger.findUnique({ where: { id: r1.id } });
    ok(!!row && row.orgId === org.id, "写入正确 org");
    const meta = row?.metadataJson as Record<string, unknown> | null;
    ok(meta?.apiKey === undefined, "不记录密钥");
    ok(meta?.intent === "test" || meta?.pricingMode === "estimated", "保留非敏感元数据");
    ok(row?.status === "ESTIMATED", "估算状态可区分");

    await db.aiUsageLedger.delete({ where: { id: r1.id } }).catch(() => {});
  }

  const cleaned = sanitizeUsageMetadata({ prompt: "x".repeat(500), note: "y" });
  ok(
    typeof cleaned?.prompt === "string" &&
      (cleaned.prompt as string).length <= 241,
    "长文本截断",
  );

  console.log(`\nphase3a2-db: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
