/**
 * 发布漂移检查（纯逻辑）
 *
 * 2026-08-16 教训：生产项目**不随 main 自动部署**，导致 #104/#109/#110 三个迁移在
 * 生产缺了好几天没人知道——期间那些功能的代码一旦被访问就会去查不存在的表。
 *
 * 本模块从**正在运行的生产代码**视角回答一个问题：
 *   「这份代码需要的 migration，生产库到底有没有？」
 *
 * - missing（代码要、库里没有）＝ CRITICAL：功能会在运行时炸
 * - unexpected（库里有、代码不认识）＝ WARN：库比代码新，说明**部署落后于迁移**
 *
 * 纯函数，无 DB、无时钟：可确定性单测。
 */

export type DriftSeverity = "ok" | "warn" | "critical";

export type MigrationDrift = {
  severity: DriftSeverity;
  /** 代码期望但生产库未应用 —— 运行时会访问不存在的表/列 */
  missing: string[];
  /** 生产库已应用但当前代码不认识 —— 部署落后于迁移 */
  unexpected: string[];
  expectedCount: number;
  appliedCount: number;
  /** 一行人类可读结论（进日志与通知标题） */
  summary: string;
};

export function diffMigrations(
  expected: readonly string[],
  applied: readonly string[],
  opts: {
    /**
     * 已知会合法留在库里、但不在当前 active 列表中的迁移
     * （greenfield 重基线前的归档历史）。不计入 unexpected，否则天天误报。
     */
    archived?: readonly string[];
  } = {},
): MigrationDrift {
  const expectedSet = new Set(expected);
  const archivedSet = new Set(opts.archived ?? []);
  const appliedSet = new Set(applied);

  const missing = expected.filter((m) => !appliedSet.has(m));
  const unexpected = applied.filter(
    (m) => !expectedSet.has(m) && !archivedSet.has(m),
  );

  const severity: DriftSeverity =
    missing.length > 0 ? "critical" : unexpected.length > 0 ? "warn" : "ok";

  const summary =
    severity === "ok"
      ? `迁移一致（${expected.length} 条全部已应用）`
      : severity === "critical"
        ? `生产库缺少 ${missing.length} 条代码所需迁移：${missing.join("、")}`
        : `生产库比当前代码多 ${unexpected.length} 条迁移（部署落后）：${unexpected.join("、")}`;

  return {
    severity,
    missing,
    unexpected,
    expectedCount: expected.length,
    appliedCount: applied.length,
    summary,
  };
}

/** 通知去重键：同一漂移形态每天只提醒一次，避免每日 cron 刷屏。 */
export function driftSourceKey(drift: MigrationDrift, dayIso: string): string {
  const shape = [
    drift.severity,
    ...[...drift.missing].sort(),
    "|",
    ...[...drift.unexpected].sort(),
  ].join(",");
  return `release-drift:${dayIso}:${shape}`;
}

export function driftNotificationTitle(drift: MigrationDrift): string {
  return drift.severity === "critical"
    ? "生产库缺少代码所需的数据库迁移"
    : "生产部署落后于数据库迁移";
}
