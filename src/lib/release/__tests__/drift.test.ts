/**
 * 发布漂移检查（DRIFT-01..10）
 * 运行：npx tsx src/lib/release/__tests__/drift.test.ts
 *
 * 这套断言直接对应 2026-08-16 的真实事故形态：生产项目不随 main 自动部署，
 * #104/#109/#110 三个迁移在生产缺了好几天没人知道。
 */

import {
  diffMigrations,
  driftNotificationTitle,
  driftSourceKey,
} from "../drift";
import {
  ARCHIVED_MIGRATIONS,
  EXPECTED_ACTIVE_MIGRATIONS,
} from "../expected-migrations";

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

const A = "20260101000000_a";
const B = "20260102000000_b";
const C = "20260103000000_c";

/* ---------------- 一致 ---------------- */
{
  const d = diffMigrations([A, B], [B, A]);
  ok(d.severity === "ok", "DRIFT-01 全部已应用（顺序无关）→ ok");
  ok(d.missing.length === 0 && d.unexpected.length === 0, "DRIFT-01 无缺失无多余");
  ok(d.summary.includes("一致"), "DRIFT-01 摘要为一致");
}

/* ---------------- 缺失（真实事故形态） ---------------- */
{
  // 代码里有 financial_control / autopilot 两条，生产库没有 —— 正是 8/16 的实况
  const d = diffMigrations([A, B, C], [A]);
  ok(d.severity === "critical", "DRIFT-02 代码需要但库里没有 → critical");
  ok(
    d.missing.join(",") === `${B},${C}`,
    "DRIFT-02 列出全部缺失项且保持代码内顺序",
  );
  ok(d.unexpected.length === 0, "DRIFT-02 无多余项");
  ok(d.summary.includes("缺少") && d.summary.includes(B), "DRIFT-02 摘要点名缺失迁移");
  ok(
    driftNotificationTitle(d) === "生产库缺少代码所需的数据库迁移",
    "DRIFT-02 通知标题指向：代码要、库没有",
  );
}

/* ---------------- 多余（部署落后） ---------------- */
{
  const d = diffMigrations([A], [A, B]);
  ok(d.severity === "warn", "DRIFT-03 库比代码新 → warn（部署落后，不是崩溃）");
  ok(d.unexpected.join(",") === B, "DRIFT-03 列出多余项");
  ok(
    driftNotificationTitle(d) === "生产部署落后于数据库迁移",
    "DRIFT-03 通知标题指向部署落后",
  );
}

/* ---------------- 缺失优先级高于多余 ---------------- */
{
  const d = diffMigrations([A, B], [A, C]);
  ok(d.severity === "critical", "DRIFT-04 同时缺失+多余 → 按 critical 报（缺失更致命）");
  ok(d.missing.join(",") === B && d.unexpected.join(",") === C, "DRIFT-04 两侧都如实列出");
}

/* ---------------- 计数与边界 ---------------- */
{
  const d = diffMigrations([], []);
  ok(d.severity === "ok" && d.expectedCount === 0 && d.appliedCount === 0, "DRIFT-05 空集合 → ok");
}
{
  const d = diffMigrations([A, B], []);
  ok(
    d.expectedCount === 2 && d.appliedCount === 0 && d.missing.length === 2,
    "DRIFT-05 全新库（零应用）→ 全部缺失",
  );
}

/* ---------------- 去重键 ---------------- */
{
  const d1 = diffMigrations([A, B], [A]);
  const d2 = diffMigrations([A, B], [A]);
  ok(
    driftSourceKey(d1, "2026-08-16") === driftSourceKey(d2, "2026-08-16"),
    "DRIFT-06 同日同漂移形态 → 同一 sourceKey（不刷屏）",
  );
  ok(
    driftSourceKey(d1, "2026-08-16") !== driftSourceKey(d1, "2026-08-17"),
    "DRIFT-06 跨日重新提醒",
  );
  const d3 = diffMigrations([A, B, C], [A]);
  ok(
    driftSourceKey(d1, "2026-08-16") !== driftSourceKey(d3, "2026-08-16"),
    "DRIFT-07 漂移形态变化 → 重新提醒",
  );
}

/* ---------------- 与仓库真实白名单联动 ---------------- */
{
  ok(
    EXPECTED_ACTIVE_MIGRATIONS.length > 0,
    "DRIFT-08 期望迁移列表非空（单一事实源可用）",
  );
  ok(
    new Set(EXPECTED_ACTIVE_MIGRATIONS).size === EXPECTED_ACTIVE_MIGRATIONS.length,
    "DRIFT-08 期望列表无重复",
  );
  const sorted = [...EXPECTED_ACTIVE_MIGRATIONS].sort();
  ok(
    sorted.every((n, i) => n === EXPECTED_ACTIVE_MIGRATIONS[i]),
    "DRIFT-09 期望列表保持字典序（与 prisma 应用顺序一致）",
  );
  const self = diffMigrations(EXPECTED_ACTIVE_MIGRATIONS, [
    ...EXPECTED_ACTIVE_MIGRATIONS,
  ]);
  ok(self.severity === "ok", "DRIFT-10 自比对为 ok（防止列表本身写坏）");
}

/* ---------------- 归档迁移不得误报（真实生产形态） ---------------- */
{
  // 生产库里躺着 greenfield 重基线前的历史迁移；不传 archived 会天天误报
  const appliedWithLegacy = [...EXPECTED_ACTIVE_MIGRATIONS, ...ARCHIVED_MIGRATIONS];
  const noisy = diffMigrations(EXPECTED_ACTIVE_MIGRATIONS, appliedWithLegacy);
  ok(
    noisy.unexpected.length > 0,
    `DRIFT-11 前置：不过滤归档会产生 ${noisy.unexpected.length} 条噪音`,
  );

  const clean = diffMigrations(EXPECTED_ACTIVE_MIGRATIONS, appliedWithLegacy, {
    archived: ARCHIVED_MIGRATIONS,
  });
  ok(clean.severity === "ok", "DRIFT-11 传入归档集后 → ok（生产真实形态不误报）");
  ok(clean.unexpected.length === 0, "DRIFT-11 归档迁移不计入 unexpected");

  // 归档集不能掩盖真正的缺失
  const missingOne = diffMigrations(
    [...EXPECTED_ACTIVE_MIGRATIONS, "20990101000000_future"],
    appliedWithLegacy,
    { archived: ARCHIVED_MIGRATIONS },
  );
  ok(
    missingOne.severity === "critical" &&
      missingOne.missing.join(",") === "20990101000000_future",
    "DRIFT-12 归档过滤不得掩盖真实缺失",
  );

  // 真正陌生的迁移仍要报
  const stranger = diffMigrations(
    EXPECTED_ACTIVE_MIGRATIONS,
    [...appliedWithLegacy, "20990101000000_unknown_from_nowhere"],
    { archived: ARCHIVED_MIGRATIONS },
  );
  ok(
    stranger.severity === "warn" &&
      stranger.unexpected.join(",") === "20990101000000_unknown_from_nowhere",
    "DRIFT-12 非归档的陌生迁移仍然报 warn",
  );
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
