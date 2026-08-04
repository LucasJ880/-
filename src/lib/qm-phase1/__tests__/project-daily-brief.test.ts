import assert from "node:assert/strict";
import {
  runProjectDailyBrief,
  buildProjectDailyBriefIdempotencyKey,
  type ProjectBriefDeps,
} from "../project-daily-brief";
import { createMemoryBriefClaimStore } from "../brief-claim";
import type { ScopeResolveDeps } from "@/lib/scope";
import type { ProjectBriefSnapshot } from "../project-snapshot";

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

function snap(): ProjectBriefSnapshot {
  return {
    projectId: "projA",
    orgId: "orgA",
    projectName: "Demo",
    localDate: "2026-08-03",
    timezone: "America/Toronto",
    openTasks: [{ id: "t1", title: "任务1", status: "todo", dueDate: null }],
    overdueTasks: [],
    recentFiles: [{ id: "f1", name: "spec.pdf", createdAt: "2026-08-01T00:00:00Z" }],
    recentRecords: [],
    progressNotes: ["进度正常"],
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

function baseDeps(over?: Partial<ProjectBriefDeps>): ProjectBriefDeps {
  const claimStore = createMemoryBriefClaimStore();
  const paKeys = new Set<string>();
  return {
    scopeDeps: makeScopeDeps(),
    claimStore,
    audit: false,
    loadSnapshot: async () => ({ ok: true, snapshot: snap() }),
    createPendingActionSuggestion: async ({ idempotencyKey }) => {
      if (paKeys.has(idempotencyKey)) return { created: false };
      paKeys.add(idempotencyKey);
      return { created: true, id: "pa1" };
    },
    ...over,
  };
}

async function main() {
  // flag off
  {
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        env: { QINGYAN_QM_SCOPE_PHASE1_ENABLED: "0" },
      },
      baseDeps(),
    );
    assert.equal(r.status, "skipped_flag");
  }

  // not allowlisted
  {
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
      baseDeps(),
    );
    assert.equal(r.status, "skipped_allowlist");
  }

  // kill switch
  {
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        modulesJson: { agentAutomationEnabled: false },
        env: envOn(),
      },
      baseDeps(),
    );
    assert.equal(r.status, "skipped_kill_switch");
  }

  // success + shadow + 非占位 snapshot
  {
    const deps = baseDeps();
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
    assert.ok(r.briefMarkdown?.includes("Demo"));
    assert.ok(r.briefMarkdown?.includes("任务1"));
    assert.ok(!r.briefMarkdown?.includes("占位"));
    assert.equal(r.pendingActionProposed, true);
    assert.ok(r.correlationId);
    assert.equal(r.claimStatus, "COMPLETED");

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
  }

  // 并发：同一 claimStore 仅一个 generated
  {
    const claimStore = createMemoryBriefClaimStore();
    let paCount = 0;
    const deps: ProjectBriefDeps = {
      scopeDeps: makeScopeDeps(),
      claimStore,
      audit: false,
      loadSnapshot: async () => ({ ok: true, snapshot: snap() }),
      createPendingActionSuggestion: async () => {
        paCount += 1;
        return { created: true, id: `pa_${paCount}` };
      },
    };
    const [a, b] = await Promise.all([
      runProjectDailyBrief(
        {
          orgId: "orgA",
          projectId: "projA",
          principalUserId: "userA",
          localDate: "2026-08-03",
          env: envOn(),
        },
        deps,
      ),
      runProjectDailyBrief(
        {
          orgId: "orgA",
          projectId: "projA",
          principalUserId: "userA",
          localDate: "2026-08-03",
          env: envOn(),
        },
        deps,
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes("generated"));
    assert.ok(
      statuses.includes("skipped_duplicate") ||
        statuses.includes("skipped_in_progress"),
    );
    assert.equal(paCount, 1);
  }

  // harness timeout 不标成功
  {
    const deps = baseDeps({
      harness: {
        audit: false,
        runAgentFn: async () => ({
          content: "partial",
          model: "m",
          rounds: 0,
          toolCalls: [],
          ok: false,
          timedOut: true,
          finishReason: "timeout",
          errorClass: "timeout",
          errorMessage: "total timeout",
          retryable: true,
        }),
      },
    });
    const r = await runProjectDailyBrief(
      {
        orgId: "orgA",
        projectId: "projA",
        principalUserId: "userA",
        localDate: "2026-08-04",
        env: envOn(),
      },
      deps,
    );
    assert.equal(r.status, "failed");
    assert.equal(r.claimStatus, "FAILED");
  }

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
