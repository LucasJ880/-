/**
 * Built-in Skill migration 语义 fixture（不连真实 DB）
 * 验证 migration SQL 与 mapper 预期一致。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapAgentSkillRow } from "../../agent-core/skills/scoped-registry";

type LegacySkill = {
  id: string;
  orgId: string;
  isBuiltin: boolean;
  slug: string;
};

/** 模拟 migration 回填逻辑（与 SQL 一致） */
function applyScopedSkillBackfill(rows: LegacySkill[]) {
  return rows.map((r) => {
    if (r.isBuiltin) {
      return {
        ...r,
        ownerScopeType: "SYSTEM" as const,
        ownerScopeId: null as string | null,
      };
    }
    return {
      ...r,
      ownerScopeType: "ORG" as const,
      ownerScopeId: r.orgId,
    };
  });
}

async function main() {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260803120000_qm_phase1_scoped_skills/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /isBuiltin"\s*=\s*true/);
  assert.match(sql, /ownerScopeType"\s*=\s*'SYSTEM'/);
  assert.match(sql, /ownerScopeId"\s*=\s*NULL/);
  assert.match(sql, /isBuiltin"\s*=\s*false/);
  assert.match(sql, /ownerScopeId"\s*=\s*"orgId"/);

  const fixture: LegacySkill[] = [
    { id: "1", orgId: "orgA", isBuiltin: true, slug: "builtin-a" },
    { id: "2", orgId: "orgA", isBuiltin: false, slug: "org-skill" },
    // 缺少组织归属的旧数据：orgId 列在 schema 仍 NOT NULL，
    // 但不得把 builtin 伪造成 ORG
    { id: "3", orgId: "org-orphan-seed", isBuiltin: true, slug: "builtin-orphan" },
  ];

  const out = applyScopedSkillBackfill(fixture);
  assert.equal(out[0].ownerScopeType, "SYSTEM");
  assert.equal(out[0].ownerScopeId, null);
  assert.equal(out[1].ownerScopeType, "ORG");
  assert.equal(out[1].ownerScopeId, "orgA");
  assert.equal(out[2].ownerScopeType, "SYSTEM");
  assert.equal(out[2].ownerScopeId, null);

  // mapper：缺省字段时 isBuiltin → SYSTEM
  const mappedBuiltin = mapAgentSkillRow({
    id: "1",
    slug: "builtin-a",
    orgId: "orgA",
    version: 1,
    isActive: true,
    isBuiltin: true,
  });
  assert.equal(mappedBuiltin.ownerScopeType, "SYSTEM");
  assert.equal(mappedBuiltin.ownerScopeId, null);

  const mappedOrg = mapAgentSkillRow({
    id: "2",
    slug: "org-skill",
    orgId: "orgA",
    version: 1,
    isActive: true,
    isBuiltin: false,
  });
  assert.equal(mappedOrg.ownerScopeType, "ORG");
  assert.equal(mappedOrg.ownerScopeId, "orgA");

  console.log("skill-migration-semantics: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
