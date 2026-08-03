import assert from "node:assert/strict";
import { loadProjectBriefSnapshot } from "../project-snapshot";

function mockDb(input: {
  project: { id: string; name: string; orgId: string; ownerId: string } | null;
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: Date | null;
    updatedAt: Date;
  }>;
}) {
  return {
    project: {
      findFirst: async () => input.project,
    },
    task: {
      findMany: async (args: { where: { projectId: string } }) => {
        if (!input.project || args.where.projectId !== input.project.id) {
          return [];
        }
        return input.tasks ?? [];
      },
    },
    projectDocument: {
      findMany: async (args: { where: { projectId: string } }) => {
        if (!input.project || args.where.projectId !== input.project.id) {
          return [];
        }
        return [];
      },
    },
    projectProgressSummary: {
      findMany: async (args: { where: { projectId: string } }) => {
        if (!input.project || args.where.projectId !== input.project.id) {
          return [];
        }
        return [];
      },
    },
  };
}

async function main() {
  // Org A 不得读取 Org B 项目
  {
    const db = mockDb({
      project: {
        id: "projB",
        name: "B",
        orgId: "orgB",
        ownerId: "uB",
      },
    });
    const r = await loadProjectBriefSnapshot({
      db: db as never,
      orgId: "orgA",
      projectId: "projB",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "ORG_MISMATCH");
  }

  // 同组织可读取
  {
    const db = mockDb({
      project: {
        id: "projA",
        name: "A",
        orgId: "orgA",
        ownerId: "uA",
      },
      tasks: [
        {
          id: "t1",
          title: "仅 A",
          status: "todo",
          dueDate: null,
          updatedAt: new Date(),
        },
      ],
    });
    const r = await loadProjectBriefSnapshot({
      db: db as never,
      orgId: "orgA",
      projectId: "projA",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.snapshot.orgId, "orgA");
      assert.equal(r.snapshot.openTasks[0]?.title, "仅 A");
      assert.ok(!r.snapshot.projectName.includes("占位"));
    }
  }

  console.log("project-snapshot-isolation: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
