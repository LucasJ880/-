/**
 * R1 — NEGATIVE tests: prove each architecture guard actually rejects an
 * invalid new surface (synthetic fixtures; never touches the real tree).
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/guards-negative.test.ts
 */
import { checkAgainstBaseline, computeBaseline } from "../guards";
import type { RepoScan } from "../scan";
import { finish, ok } from "./helpers";

function scanOf(entries: Record<string, string>): RepoScan {
  return { files: new Map(Object.entries(entries)) };
}

/** Baseline computed from an EMPTY tree — everything current becomes "new". */
const emptyBaseline = computeBaseline(scanOf({}));

function violationsFor(files: Record<string, string>) {
  return checkAgainstBaseline(computeBaseline(scanOf(files)), emptyBaseline);
}
function hasRule(files: Record<string, string>, rule: string): boolean {
  return violationsFor(files).some((v) => v.rule === rule);
}

// 1) frozen area gains a new file
ok(
  hasRule({ "src/lib/agent-supervisor/new-brain.ts": "export const x = 1;" }, "FROZEN_AREA_NEW_FILE"),
  "冻结目录新增文件 → FROZEN_AREA_NEW_FILE",
);

// 2) new approval bypass — direct table write
ok(
  hasRule(
    { "src/lib/somewhere/new-feature.ts": 'await db.pendingAction.create({ data: {} });' },
    "NEW_APPROVAL_BYPASS_FORBIDDEN",
  ),
  "直接 db.pendingAction.create → NEW_APPROVAL_BYPASS_FORBIDDEN",
);
// 2b) new approval bypass — legacy helper import
ok(
  hasRule(
    { "src/lib/somewhere/new-feature.ts": 'import { createDraft } from "@/lib/pending-actions/drafts";' },
    "NEW_APPROVAL_BYPASS_FORBIDDEN",
  ),
  "新代码 import 旧创建 helper → NEW_APPROVAL_BYPASS_FORBIDDEN",
);
// 2c) canonical owners stay exempt
ok(
  !hasRule(
    { "src/lib/approval/request.ts": 'import { createDraftBatch } from "@/lib/pending-actions/drafts";' },
    "NEW_APPROVAL_BYPASS_FORBIDDEN",
  ),
  "approval/ 与 pending-actions/ 属 canonical owner，不误报",
);
// 2d) approvalRequest create
ok(
  hasRule(
    { "src/lib/somewhere/x.ts": "await tx.approvalRequest.create({});" },
    "NEW_APPROVAL_BYPASS_FORBIDDEN",
  ),
  "直接 approvalRequest.create → NEW_APPROVAL_BYPASS_FORBIDDEN",
);

// 3) new Run model writer / status writer
ok(hasRule({ "src/lib/x/y.ts": "db.agentRun.create({ data: {} })" }, "NEW_RUN_MODEL_WRITER_FORBIDDEN"), "新 agentRun.create → NEW_RUN_MODEL_WRITER_FORBIDDEN");
ok(hasRule({ "src/lib/x/y.ts": "db.agentRun.update({ where: {} })" }, "NEW_RUN_STATUS_WRITER_FORBIDDEN"), "新 agentRun.update → NEW_RUN_STATUS_WRITER_FORBIDDEN");

// 4) new Step / event / legacy-task writers
ok(hasRule({ "src/lib/x/y.ts": "db.agentRunStep.update({})" }, "NEW_STEP_MODEL_WRITER_FORBIDDEN"), "新 agentRunStep writer → NEW_STEP_MODEL_WRITER_FORBIDDEN");
ok(hasRule({ "src/lib/x/y.ts": "tx.agentRunEvent.create({})" }, "NEW_EVENT_WRITER_FORBIDDEN"), "新 agentRunEvent writer → NEW_EVENT_WRITER_FORBIDDEN");
ok(hasRule({ "src/lib/x/y.ts": "db.agentTask.create({})" }, "NEW_LEGACY_TASK_WRITER_FORBIDDEN"), "新 AgentTask writer → NEW_LEGACY_TASK_WRITER_FORBIDDEN");

// 5) new generic Run/Step persistence model in prisma
ok(
  hasRule(
    { "prisma/schema.prisma": "model ShadowAgentRun {\n  id String @id\n}\n" },
    "NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN",
  ),
  "新 prisma 架构模型（*Run）→ NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN",
);
ok(
  !hasRule(
    { "prisma/schema.prisma": "model CustomerNote {\n  id String @id\n}\n" },
    "NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN",
  ),
  "非架构命名的业务模型不误报",
);

// 6) new planner / engine / registry surfaces
ok(hasRule({ "src/lib/tender/mega-planner.ts": "export {}" }, "NEW_PLANNER_SURFACE_FORBIDDEN"), "新 *planner* 文件 → NEW_PLANNER_SURFACE_FORBIDDEN");
ok(hasRule({ "src/lib/tender/super-executor.ts": "export {}" }, "NEW_ENGINE_SURFACE_FORBIDDEN"), "新 *executor* 文件 → NEW_ENGINE_SURFACE_FORBIDDEN");
ok(hasRule({ "src/lib/tender/my-tools.ts": "export const MY_TOOL_CATALOG = [];" }, "NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN"), "新 *_TOOL_CATALOG → NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN");
ok(!hasRule({ "src/lib/tender/service.ts": "export const helper = 1;" }, "NEW_ENGINE_SURFACE_FORBIDDEN"), "普通业务文件不误报");

// 7) new runtime event vocabulary (literal outside the union)
const unionSrc = 'export type AgentRunEventType =\n  | "run.started"\n  | "tool.started";\n';
ok(
  checkAgainstBaseline(
    computeBaseline(
      scanOf({
        "src/lib/agent-runtime/types.ts": unionSrc,
        "src/lib/agent-runtime/emitter.ts": 'appendAgentRunEvent({ eventType: "totally.new_event" })',
      }),
    ),
    emptyBaseline,
  ).some((v) => v.rule === "NEW_RUNTIME_EVENT_TYPE_FORBIDDEN"),
  "未注册 eventType 字面量 → NEW_RUNTIME_EVENT_TYPE_FORBIDDEN",
);
ok(
  !checkAgainstBaseline(
    computeBaseline(
      scanOf({
        "src/lib/agent-runtime/types.ts": unionSrc,
        "src/lib/agent-runtime/emitter.ts": 'appendAgentRunEvent({ eventType: "run.started" })',
      }),
    ),
    emptyBaseline,
  ).some((v) => v.rule === "NEW_RUNTIME_EVENT_TYPE_FORBIDDEN"),
  "union 内 eventType 不误报",
);

// 8) frozen module importer
ok(
  hasRule(
    { "src/lib/somewhere/new.ts": 'import { runSupervisor } from "@/lib/agent-supervisor";' },
    "NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN",
  ),
  "新 import agent-supervisor → NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN",
);
ok(
  hasRule(
    { "src/lib/somewhere/new.ts": 'const m = await import("@/lib/agent-core/skills/flow-runner");' },
    "NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN",
  ),
  "动态 import flow-runner 同样被捕获",
);

// 9) forbidden import directions (incl. the runtime⇄workforce inversion)
ok(
  hasRule(
    { "src/lib/agent-runtime-v2/new-file.ts": 'import { x } from "@/lib/workforce-runtime/execution-policy";' },
    "FORBIDDEN_IMPORT_DIRECTION_GROWTH",
  ),
  "V2 新增 workforce 反向依赖 → FORBIDDEN_IMPORT_DIRECTION_GROWTH（倒置不得恶化）",
);
ok(
  hasRule(
    { "src/lib/autopilot/new-file.ts": 'import { executeRuntimeV2Round } from "@/lib/agent-runtime-v2/executor";' },
    "FORBIDDEN_IMPORT_DIRECTION_GROWTH",
  ),
  "autopilot 引 executor → FORBIDDEN_IMPORT_DIRECTION_GROWTH（评估层不得拥有执行）",
);
ok(
  hasRule(
    { "src/lib/autopilot/new-file.ts": 'import { x } from "../agent-runtime-v2/process";' },
    "FORBIDDEN_IMPORT_DIRECTION_GROWTH",
  ),
  "相对路径反向依赖同样被捕获",
);
ok(
  !hasRule(
    { "src/lib/workforce-runtime/new-file.ts": 'import { x } from "@/lib/agent-runtime-v2/process";' },
    "FORBIDDEN_IMPORT_DIRECTION_GROWTH",
  ),
  "workforce → V2 是目标方向，不误报",
);

// 10) baseline semantics: entries present in baseline do NOT fail (shrink-only)
const withBaseline = computeBaseline(
  scanOf({ "src/lib/agent-supervisor/existing.ts": "export {}" }),
);
ok(
  checkAgainstBaseline(withBaseline, withBaseline).length === 0,
  "与 baseline 一致 → 零违规（存量允许，收缩不罚）",
);

finish("architecture guards (negative)");
