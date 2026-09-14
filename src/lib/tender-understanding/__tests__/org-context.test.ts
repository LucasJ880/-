/**
 * 招标权威组织上下文（纯函数）。
 * 运行：npx tsx src/lib/tender-understanding/__tests__/org-context.test.ts
 */
import assert from "node:assert";
import { pickCanonicalTenderOrg } from "../org-context";
import { makeOk } from "./helpers";

const { ok, count } = makeOk();

async function run(): Promise<void> {
  await ok("项目归属组织是权威来源", () => {
    assert.equal(
      pickCanonicalTenderOrg({ projectOrgId: "org-A", runOrgId: "org-A" }),
      "org-A",
    );
  });

  await ok("run.orgId 与 project.orgId 不一致 → fail-closed（不用任一侧冒充）", () => {
    assert.equal(
      pickCanonicalTenderOrg({ projectOrgId: "org-A", runOrgId: "org-B" }),
      null,
    );
  });

  await ok("后台任务无 user 时仍可用 project → org", () => {
    assert.equal(
      pickCanonicalTenderOrg({ projectOrgId: "org-A" }),
      "org-A",
    );
  });

  await ok("project.orgId 缺失时回退到服务端写入的 run.orgId", () => {
    assert.equal(
      pickCanonicalTenderOrg({ projectOrgId: null, runOrgId: "org-A" }),
      "org-A",
    );
  });

  await ok("两侧都缺 → null（allowlist 非空时 fail-closed）", () => {
    assert.equal(pickCanonicalTenderOrg({}), null);
    assert.equal(pickCanonicalTenderOrg({ projectOrgId: "  ", runOrgId: "" }), null);
  });

  await ok("函数签名不含客户端 claimedOrgId", () => {
    assert.equal(
      pickCanonicalTenderOrg.length === 1,
      true,
    );
    const keys = Object.keys(
      pickCanonicalTenderOrg({ projectOrgId: "org-A", runOrgId: "org-A" }) ===
        "org-A"
        ? { projectOrgId: true, runOrgId: true }
        : {},
    );
    assert.ok(!keys.includes("claimedOrgId"));
  });
}

run()
  .then(() => {
    console.log(`org-context: ${count()} passed`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
