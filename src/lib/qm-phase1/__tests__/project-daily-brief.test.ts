import assert from "node:assert/strict";
import {
  runProjectDailyBrief,
  buildProjectDailyBriefIdempotencyKey,
  type ProjectBriefDeps,
  type ProjectDailyBriefStore,
} from "../project-daily-brief";
import type { ScopeResolveDeps } from "@/lib/scope";

function makeScopeDeps(): ScopeResolveDeps {
  return {
    audit: false,
    findOrg: async (id) =>
      id === "orgA" ? { id: "orgA", status: "active" } : null,
    findMembership: async () => null,
    findProject: async (id) =>
      id === "projA"
        ? {
            id: "projA",
            orgId: "orgA",
            ownerId: "userA",
            intakeStatus: "dispatched",
          }
        : null,
    findProjectMember: async () => null,
    findThread: async () => null,
  };
}

function makeStore(): ProjectDailyBriefStore & { keys: Set<string>; paKeys: Set<string> } {
  const keys = new Set<string>();
  const paKeys = new Set<string>();
  return {
    keys,
    paKeys,
    hasRun: async (k) => keys.has(k),
    markRun: async ({ idempotencyKey }) => {
      keys.add(idempotencyKey);
    },
    createPendingActionSuggestion: async ({ idempotencyKey }) => {
      if (paKeys.has(idempotencyKey)) return { created: false };
      paKeys.add(idempotencyKey);
      return { created: true, id: "pa1" };
    },
  };
}

function envOn(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    QINGYAN_QM_SCOPE_PHASE1_ENABLED: "1",
    QINGYAN_QM_PHASE1_ORG_ALLOWLIST: "orgA",
    QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST: "projA",
    QINGYAN_QM_PHASE1_SHADOW_MODE: "1",
    ...extra,
  };
}

async function main() {
  const scopeDeps = makeScopeDeps();

  // flag off
  {
    const store = makeStore();
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        env: { QINGYAN_QM_SCOPE_PHASE1_ENABLED: "0" },
      },
      { scopeDeps, store, audit: false },
    );
    assert.equal(r.status, "skipped_flag");
  }

  // not allowlisted
  {
    const store = makeStore();
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        env: {
          QINGYAN_QM_SCOPE_PHASE1_ENABLED: "1",
          QINGYAN_QM_PHASE1_ORG_ALLOWLIST: "other",
          QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST: "projA",
        },
      },
      { scopeDeps, store, audit: false },
    );
    assert.equal(r.status, "skipped_allowlist");
  }

  // kill switch
  {
    const store = makeStore();
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        modulesJson: { agentAutomationEnabled: false },
        env: envOn(),
      },
      { scopeDeps, store, audit: false },
    );
    assert.equal(r.status, "skipped_kill_switch");
  }

  // success + shadow
  {
    const store = makeStore();
    const deps: ProjectBriefDeps = { scopeDeps, store, audit: false };
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        localDate: "2026-08-03",
        inputDataVersion: "v1",
        env: envOn(),
      },
      deps,
    );
    assert.equal(r.status, "generated");
    assert.equal(r.shadowMode, true);
    assert.ok(r.briefMarkdown?.includes("项目每日简报"));
    assert.equal(r.pendingActionProposed, true);
    assert.ok(r.correlationId);

    // idempotent second run
    const r2 = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        localDate: "2026-08-03",
        env: envOn(),
      },
      deps,
    );
    assert.equal(r2.status, "skipped_duplicate");

    // retry must not create duplicate PA
    assert.equal(store.paKeys.size, 1);
  }

  // key format
  assert.equal(
    buildProjectDailyBriefIdempotencyKey({
      orgId: "orgA",
      projectId: "projA",
      localDate: "2026-08-03",
    }),
    "qm.project_daily_brief:orgA:projA:2026-08-03",
  );

  console.log("project-daily-brief: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
