/**
 * R1（S2 Trust-Boundary Closure）：信号有效项目归属 / 混合指针冲突 / 列表可见性过滤——
 * CI 可执行纯逻辑（真实服务与 HTTP 行为在 supplier-intel-s2tb-db.isolated.test.ts）。
 *
 * 注意：只给 Prisma 一个永不连接的占位 URL，零数据库副作用。
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@127.0.0.1:5432/ci?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

async function main() {
  const { mergeSignalProjectScope, detectSubmitPointerConflicts, buildSignalProjectVisibilityFilter } =
    await import("../signal-scope");

  const run = (id: string, projectId: string | null, tenderId: string | null = null) => ({
    id,
    projectId,
    tenderId,
  });

  console.log("A1：projectId 为空但挂在项目绑定 Run 上 → 继承 Run 归属，绝不当组织公共线索");
  const inherited = mergeSignalProjectScope(
    { projectId: null, tenderId: null, searchRunId: "run1" },
    run("run1", "P-A"),
  );
  assert.deepEqual(inherited.projectIds, ["P-A"]);
  assert.equal(inherited.orgLevel, false, "有 Run 归属就不是组织级线索");
  assert.deepEqual(
    inherited.sources.map((s) => s.from),
    ["run.projectId"],
  );

  console.log("A2：真正无任何项目指针 → 组织级线索（保留既有行为，不强行绑定项目）");
  const orgLevel = mergeSignalProjectScope({ projectId: null, tenderId: null, searchRunId: null }, null);
  assert.deepEqual(orgLevel.projectIds, []);
  assert.equal(orgLevel.orgLevel, true);

  console.log("A3：tenderId 与 Run 的 tenderId 一并纳入治理集合（既有语义：两者都是 Project 指针）");
  const full = mergeSignalProjectScope(
    { projectId: "P-A", tenderId: "P-T", searchRunId: "run1" },
    run("run1", "P-A", "P-T"),
  );
  assert.deepEqual(full.projectIds, ["P-A", "P-T"], "去重 + 升序");

  console.log("A4：归属不一致时集合含全部项目——取并集（每个都要过权限），不取最宽松的那一个");
  const conflicting = mergeSignalProjectScope(
    { projectId: "P-A", tenderId: null, searchRunId: "run2" },
    run("run2", "P-B"),
  );
  assert.deepEqual(conflicting.projectIds, ["P-A", "P-B"]);
  assert.equal(conflicting.orgLevel, false);
  assert.ok(
    conflicting.sources.some((s) => s.from === "signal.projectId") &&
      conflicting.sources.some((s) => s.from === "run.projectId"),
    "来源明细保留两侧出处（审计可回放）",
  );

  console.log("A5：空白/空串指针不产生伪项目");
  const blank = mergeSignalProjectScope({ projectId: "   ", tenderId: "", searchRunId: null }, null);
  assert.deepEqual(blank.projectIds, []);
  assert.equal(blank.orgLevel, true);

  console.log("B1（R1-T5 纯核）：混合指针冲突必须被识别——有权项目 id + 无权项目的 Run");
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: "P-B", tenderId: null, searchRunId: "run1" }, run("run1", "P-A")),
    ["projectId=P-B 与 Run 的 projectId=P-A 不一致"],
  );
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: null, tenderId: "P-T2", searchRunId: "run1" }, run("run1", "P-A", "P-T1")),
    ["tenderId=P-T2 与 Run 的 tenderId=P-T1 不一致"],
  );
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: "P-X", tenderId: null, searchRunId: "run1" }, run("run1", null, "P-T1")),
    ["projectId=P-X 与 Run 的 tenderId=P-T1 不一致"],
    "Run 只挂 tenderId 时同样对质",
  );

  console.log("B2：一致的指针不误报；无 Run 时不产生冲突（归属仅来自信号自身）");
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: "P-A", tenderId: null, searchRunId: "run1" }, run("run1", "P-A")),
    [],
  );
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: null, tenderId: null, searchRunId: "run1" }, run("run1", "P-A")),
    [],
    "只给 Run（不给 projectId）不是冲突——归属由 Run 继承，权限另行断言",
  );
  assert.deepEqual(
    detectSubmitPointerConflicts({ projectId: "P-A", tenderId: null, searchRunId: null }, null),
    [],
  );

  console.log("C1：列表过滤——super_admin / org_admin 不追加项目约束，但归属可解析性对所有角色成立");
  const unrestricted = buildSignalProjectVisibilityFilter({ unrestricted: true }, "ORG-1");
  assert.equal(unrestricted.length, 1, "只保留归属可解析性一段");
  const unrestrictedJson = JSON.stringify(unrestricted);
  assert.ok(unrestrictedJson.includes('"searchRunId":null'), "未挂 Run 的信号不受影响");
  assert.ok(unrestrictedJson.includes('"orgId":"ORG-1"'), "挂 Run 的信号要求 Run 在本 org（与单条 fail-closed 一致）");
  assert.ok(!unrestrictedJson.includes('"projectId"'), "不追加项目集合约束");

  console.log("C2：受限用户 → 归属可解析性 + 三段项目约束（自身两个指针 + Run 两个指针）");
  const filter = buildSignalProjectVisibilityFilter({ unrestricted: false, projectIds: ["P-A"] }, "ORG-1");
  assert.equal(filter.length, 4, "1 段可解析性 + 2 个自身指针 + 1 个 Run 关系");
  const json = JSON.stringify(filter);
  assert.ok(json.includes('"projectId"') && json.includes('"tenderId"'), "自身两个指针都被约束");
  assert.ok(json.includes('"searchRun"'), "Run 归属通过关系过滤纳入（join，不是逐条鉴权）");
  assert.ok(json.includes('"searchRunId":null'), "未挂 Run 的信号不被 Run 约束误杀");
  for (const clause of filter.slice(1)) {
    assert.ok(JSON.stringify(clause).includes('"P-A"'), "每段项目约束都收敛到允许集合");
  }

  console.log("C3：允许集合为空 → 仍然是四段约束（只剩 null 指针可见），不是「无约束」");
  const empty = buildSignalProjectVisibilityFilter({ unrestricted: false, projectIds: [] }, "ORG-1");
  assert.equal(empty.length, 4);
  assert.ok(!JSON.stringify(empty).includes("unrestricted"));

  console.log("\nsignal-scope（R1 归属/冲突/列表过滤纯核）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
