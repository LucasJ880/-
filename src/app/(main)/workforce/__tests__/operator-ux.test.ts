/**
 * Workforce Operator UX — 展示层契约测试（2D-1 / D1-D10）
 *
 * D1 Working / D2 Needs You / D3 Completed / D4 Partial / D5 Failed+Cancelled
 * D6 多 currentTask / D7 worker 可选兼容 / D8 timeline 零内部泄漏
 * D9 跨 org（列表面见 list-service.test.ts；此处覆盖详情 404 语义依赖）
 * D10 响应式（静态审计）+ 任务书 §21 无 mutation（静态审计）
 *
 * 展示层是纯函数字典——直接对"用户最终看到的字符串"断言。
 * 运行：npx tsx "src/app/(main)/workforce/__tests__/operator-ux.test.ts"
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  buildWorkforceJobViewModel,
  projectTaskView,
} from "../../../../lib/workforce-runtime/read-model/projection";
import {
  at,
  makeEvents,
  makePendingAction,
  makePlan,
  makeRun,
  makeStep,
  workingEventPrefix,
} from "../../../../lib/workforce-runtime/read-model/__tests__/fixtures";
import {
  JOB_STATUS_PRESENTATION,
  businessRefLabel,
  currentTasksHeading,
  finalResultPlaceholder,
  formatDuration,
  formatRelativeTime,
  hasPlannedTasks,
  isActiveJobStatus,
  jobStatusLabel,
  needsYouCardModel,
  progressPercent,
  progressText,
  taskStatusPresentation,
  timelineItemText,
  timelineKindPresentation,
  workerLabel,
} from "../presentation";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

function section(name: string): void {
  console.log(`\n━━ ${name}`);
}

/** #85 canonical workforce-task/v1 信封（真实 persist 形状） */
function canonicalTaskInput(
  workerKey: string,
  role: string,
  taskKind: "work" | "synthesis",
  objective = "整理销售跟进优先级并给出建议",
): unknown {
  return {
    workforceTask: {
      contractVersion: "workforce-task/v1",
      worker: { workerKey, role },
      taskKind,
      objective,
    },
  };
}

/* ================================================================== */

function main(): void {
  console.log("Workforce Operator UX — 展示层契约测试（2D-1）");

  /* ================================================================ */
  section("D1 Working Job：状态/进度/当前任务的用户面呈现");
  {
    const view = buildWorkforceJobViewModel({
      run: makeRun({
        id: "run_d1",
        status: "executing",
        planJson: makePlan(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]),
        startedAt: at(0),
      }),
      steps: [
        makeStep("s1", "completed", { completedAt: at(2) }),
        makeStep("s2", "completed", { completedAt: at(3) }),
        makeStep("s3", "skipped"),
        makeStep("s4", "running", {
          startedAt: at(4),
          inputJson: { worker: { id: "sales" } },
        }),
        makeStep("s5", "pending"),
        makeStep("s6", "pending"),
        makeStep("s7", "pending"),
      ],
      events: makeEvents(workingEventPrefix()),
      pendingActions: [],
    });

    ok(view.status === "WORKING", "用户态 = WORKING");
    ok(jobStatusLabel(view.status) === "进行中", "状态友好中文 = 进行中");
    ok(
      JOB_STATUS_PRESENTATION.WORKING.tone === "in-progress",
      "WORKING 语义色 = in-progress",
    );
    ok(
      progressText(view.progress) === "3 / 7 项任务完成",
      "进度 = deterministic 计数文案（skipped 计入分子）",
      progressText(view.progress),
    );
    ok(progressPercent(view.progress) === 43, "进度条 43%（3/7 取整）");
    ok(hasPlannedTasks(view.progress), "已有任务拆解");
    ok(
      view.currentTasks.length === 1 &&
        currentTasksHeading(view.currentTasks.length) === "当前任务",
      "单 currentTask 标题 = 当前任务",
    );
    ok(isActiveJobStatus(view.status), "WORKING 属活跃态（详情页轮询依据）");
    ok(!isActiveJobStatus("COMPLETED"), "COMPLETED 非活跃态（停止轮询）");
  }

  /* ================================================================ */
  section("D2 Needs You Job：结构化等待原因 → 卡片模型（只读入口）");
  {
    const view = buildWorkforceJobViewModel({
      run: makeRun({ id: "run_d2", status: "awaiting_approval" }),
      steps: [makeStep("s1", "awaiting_approval", { startedAt: at(5) })],
      events: makeEvents([
        ...workingEventPrefix(),
        {
          type: "job.waiting_human",
          visible: true,
          title: "等待审批后继续",
          payload: {
            humanRequirement: {
              type: "APPROVAL_REQUIRED",
              refs: { pendingActionIds: ["pa_1"] },
            },
          },
        },
      ]),
      pendingActions: [
        makePendingAction("pa_1", "pending", "发送跟进邮件"),
        makePendingAction("pa_2", "pending", "更新客户备注"),
      ],
    });

    ok(view.status === "NEEDS_YOU" && view.needsYou !== undefined, "NEEDS_YOU 视图存在");
    const card = needsYouCardModel(view.needsYou!);
    ok(card.title === "等待你审批", "审批类标题 = 字典文案");
    ok(card.pendingCount === 2, "审批计数 = open PendingAction 集合", card);
    ok(
      card.action?.href === "/capabilities/approvals" &&
        card.action.label === "前往审批中心",
      "只读入口 → 已有成熟审批中心（无内联 mutation）",
    );

    const rejected = needsYouCardModel({
      type: "APPROVAL_REJECTED",
      title: "审批被拒绝，需要你决定后续",
      pendingActionIds: ["pa_9"],
    });
    ok(
      rejected.action?.href === "/capabilities/approvals",
      "拒绝类同样跳转审批中心（查看决定）",
    );

    const clarification = needsYouCardModel({
      type: "CLARIFICATION_REQUIRED",
      title: "需要补充信息后继续",
      detail: "请确认目标客户范围",
    });
    ok(
      clarification.detail === "请确认目标客户范围" &&
        clarification.action === undefined,
      "clarification 类：结构化 detail 直出、本阶段无提交入口",
    );

    const unknown = needsYouCardModel({
      type: "UNKNOWN_HUMAN_INTERVENTION",
      title: "需要人工处理",
    });
    ok(
      unknown.title === "需要人工处理" && unknown.action === undefined,
      "未知原因 fail-safe 显示，不猜测入口",
    );
  }

  /* ================================================================ */
  section("D3 Completed Job：最终结果优先已有摘要，缺失显式占位");
  {
    const done = buildWorkforceJobViewModel({
      run: makeRun({
        id: "run_d3",
        status: "completed",
        startedAt: at(0),
        completedAt: at(31),
      }),
      steps: [makeStep("s1", "completed", { completedAt: at(30) })],
      events: makeEvents([
        { type: "job.created", visible: true },
        {
          type: "job.completed",
          visible: true,
          payload: { status: "completed", summary: "已整理 3 位客户的优先顺序与建议" },
        },
      ]),
      pendingActions: [],
    });
    ok(jobStatusLabel(done.status) === "已完成", "状态 = 已完成");
    ok(
      done.finalSummary === "已整理 3 位客户的优先顺序与建议",
      "已有摘要 → 直接展示（不由前端拼装）",
    );
    ok(
      finalResultPlaceholder("COMPLETED") === "尚未生成最终结果",
      "无摘要的 COMPLETED → 占位文案「尚未生成最终结果」",
    );
    ok(
      formatDuration(done.startedAt, done.completedAt) === "31 分钟",
      "用时 = deterministic（completedAt - startedAt）",
      formatDuration(done.startedAt, done.completedAt),
    );
  }

  /* ================================================================ */
  section("D4 Partial Job");
  {
    const partial = buildWorkforceJobViewModel({
      run: makeRun({ id: "run_d4", status: "partially_executed" }),
      steps: [
        makeStep("s1", "completed", { completedAt: at(3) }),
        makeStep("s2", "failed"),
      ],
      events: makeEvents([
        { type: "job.created", visible: true },
        {
          type: "job.completed",
          visible: true,
          payload: { status: "partially_executed" },
        },
      ]),
      pendingActions: [],
    });
    ok(partial.status === "PARTIAL", "用户态 = PARTIAL");
    ok(jobStatusLabel("PARTIAL") === "部分完成", "PARTIAL 友好中文 = 部分完成");
    ok(
      JOB_STATUS_PRESENTATION.PARTIAL.tone === "warning",
      "PARTIAL 语义色 = warning（不伪装成功）",
    );
    ok(
      partial.timeline.some((t) => t.kind === "PARTIAL"),
      "timeline 终态条目 = PARTIAL（payload 分流）",
    );
    ok(
      finalResultPlaceholder("PARTIAL") === "尚未生成最终结果",
      "PARTIAL 无摘要 → 同样显式占位",
    );
  }

  /* ================================================================ */
  section("D5 Failed / Cancelled Job");
  {
    ok(jobStatusLabel("FAILED") === "未能完成", "FAILED 友好中文 = 未能完成");
    ok(JOB_STATUS_PRESENTATION.FAILED.tone === "danger", "FAILED 语义色 = danger");
    ok(
      finalResultPlaceholder("FAILED") === "任务未能完成，暂无最终结果",
      "FAILED 最终结果占位",
    );
    ok(jobStatusLabel("CANCELLED") === "已取消", "CANCELLED 友好中文 = 已取消");
    ok(
      finalResultPlaceholder("CANCELLED") === "任务已取消，未生成最终结果",
      "CANCELLED 最终结果占位",
    );
    ok(
      finalResultPlaceholder("WORKING") === "任务完成后，这里会展示最终结果",
      "进行中 → 预告式占位",
    );

    const failed = buildWorkforceJobViewModel({
      run: makeRun({ id: "run_d5", status: "failed", errorCode: "external_timeout" }),
      steps: [makeStep("s1", "failed")],
      events: makeEvents([
        { type: "job.created", visible: true },
        { type: "job.failed", visible: true, title: "Workforce Job 失败" },
      ]),
      pendingActions: [],
    });
    ok(failed.status === "FAILED", "failed run → FAILED");
    const failedText = failed.timeline
      .map((t) => timelineItemText(t))
      .join("\n");
    ok(
      !failedText.includes("Workforce Job"),
      "失败条目使用字典文案（工程话术标题不进用户面）",
      failedText,
    );
  }

  /* ================================================================ */
  section("D6 多 currentTask（2B-2 前向兼容：canonical workforce-task/v1 数组契约）");
  {
    const view = buildWorkforceJobViewModel({
      run: makeRun({
        id: "run_d6",
        status: "executing",
        planJson: makePlan(["a", "b", "c", "d"]),
      }),
      steps: [
        makeStep("a", "running", {
          startedAt: at(2),
          inputJson: canonicalTaskInput("sales_worker", "sales_specialist", "work"),
        }),
        makeStep("b", "running", {
          startedAt: at(3),
          inputJson: canonicalTaskInput("tender_worker", "tender_specialist", "work"),
        }),
        makeStep("c", "running", {
          startedAt: at(4),
          inputJson: canonicalTaskInput(
            "synthesis_worker",
            "synthesis_lead",
            "synthesis",
          ),
        }),
        makeStep("d", "pending"),
      ],
      events: makeEvents(workingEventPrefix()),
      pendingActions: [],
    });
    ok(view.currentTasks.length === 3, "3 项 canonical 并行任务全部进入 currentTasks");
    ok(
      currentTasksHeading(3) === "正在执行 3 项",
      "多任务标题 = 正在执行 N 项",
    );
    ok(
      view.currentTasks[0].stepKey === "a" &&
        view.currentTasks[2].stepKey === "c",
      "startedAt 升序（最早开始的排前）",
    );
    ok(
      view.currentTasks[0].workerKey === "sales_worker" &&
        view.currentTasks[1].workerKey === "tender_worker" &&
        view.currentTasks[2].workerKey === "synthesis_worker",
      "canonical workerKey 逐项投影正确",
      view.currentTasks.map((t) => t.workerKey),
    );
    const labels = view.currentTasks.map((t) => workerLabel(t.workerKey));
    ok(
      labels[0] === "销售" && labels[1] === "投标" && labels[2] === "综合汇总",
      "三个 Worker Badge：销售 / 投标 / 综合汇总",
      labels,
    );
    ok(
      view.currentTasks[2].taskKind === "synthesis",
      "synthesis_worker 任务 taskKind = synthesis",
    );
  }

  /* ================================================================ */
  section("D7 Task Contract：canonical（#85）/ legacy / invalid 三态");
  {
    // A. canonical sales_worker
    const salesTask = projectTaskView(
      makeStep("t_sales", "running", {
        inputJson: canonicalTaskInput("sales_worker", "sales_specialist", "work"),
      }),
    );
    ok(
      salesTask.workerKey === "sales_worker" && salesTask.taskKind === "work",
      "A. canonical sales_worker → workerKey/taskKind 投影",
      salesTask,
    );
    ok(workerLabel(salesTask.workerKey) === "销售", "A. UI Badge = 销售");

    // B. canonical tender_worker
    const tenderTask = projectTaskView(
      makeStep("t_tender", "running", {
        inputJson: canonicalTaskInput("tender_worker", "tender_specialist", "work"),
      }),
    );
    ok(tenderTask.workerKey === "tender_worker", "B. canonical tender_worker 投影");
    ok(workerLabel(tenderTask.workerKey) === "投标", "B. UI Badge = 投标");

    // C. canonical synthesis_worker
    const synthTask = projectTaskView(
      makeStep("t_synth", "running", {
        inputJson: canonicalTaskInput(
          "synthesis_worker",
          "synthesis_lead",
          "synthesis",
        ),
      }),
    );
    ok(
      synthTask.workerKey === "synthesis_worker" &&
        synthTask.taskKind === "synthesis",
      "C. canonical synthesis_worker → taskKind = synthesis",
    );
    ok(workerLabel(synthTask.workerKey) === "综合汇总", "C. UI Badge = 综合汇总");

    // D. pre-2B1 legacy shapes 继续兼容（信封 absent → #84 fallback）
    const legacyWorkerId = projectTaskView(
      makeStep("t_leg1", "running", {
        inputJson: { worker: { id: "sales" }, taskKind: "analysis" },
      }),
    );
    ok(
      legacyWorkerId.workerKey === "sales" && legacyWorkerId.taskKind === "analysis",
      "D. legacy worker.id / taskKind 继续兼容",
    );
    ok(workerLabel("sales") === "销售", "D. legacy 别名 sales → 销售");
    const legacyFlat = projectTaskView(
      makeStep("t_leg2", "running", {
        inputJson: { workerKey: "research", kind: "read" },
      }),
    );
    ok(
      legacyFlat.workerKey === "research" && legacyFlat.taskKind === "read",
      "D. legacy workerKey / kind 继续兼容",
    );
    const noWorker = projectTaskView(makeStep("t_leg3", "pending"));
    ok(
      noWorker.workerKey === undefined && workerLabel(noWorker.workerKey) === undefined,
      "D. 无任何 worker 信息 → 不渲染徽标（2B-1 前存量 Job）",
    );

    // E. malformed / unknown contract version → fail-safe，不透出 raw 数据
    const badVersion = projectTaskView(
      makeStep("t_bad1", "running", {
        inputJson: {
          workforceTask: {
            contractVersion: "workforce-task/v99",
            worker: { workerKey: "secret_internal_worker_x", role: "r" },
            taskKind: "work",
            objective: "x",
          },
        },
      }),
    );
    ok(
      badVersion.workerKey === undefined && badVersion.taskKind === undefined,
      "E. 未知 contract version → invalid → 双 undefined",
      badVersion,
    );
    ok(
      JSON.stringify(badVersion).includes("secret_internal_worker_x") === false,
      "E. raw internal worker 数据零透出",
    );
    const brokenEnvelope = projectTaskView(
      makeStep("t_bad2", "running", {
        inputJson: {
          workforceTask: { contractVersion: "workforce-task/v1", taskKind: "work" },
          worker: { id: "sales" },
        },
      }),
    );
    ok(
      brokenEnvelope.workerKey === undefined && brokenEnvelope.taskKind === undefined,
      "E. 信封损坏 → 不回退旁路 legacy 字段（fail-safe 不猜测）",
      brokenEnvelope,
    );
    const unknownButValid = projectTaskView(
      makeStep("t_bad3", "running", {
        inputJson: canonicalTaskInput("quantum_worker_x9", "mystery", "work"),
      }),
    );
    ok(
      workerLabel(unknownButValid.workerKey) === "数字员工",
      "E. 结构合法但 registry 外的 workerKey → UI fail-safe 数字员工（不直出）",
    );

    ok(
      taskStatusPresentation("awaiting_approval").label === "等待审批" &&
        taskStatusPresentation("blocked").label === "受阻",
      "任务状态友好中文映射",
    );
    ok(
      taskStatusPresentation("hyper_step_v3").label === "处理中",
      "未知任务状态 fail-safe → 处理中（不透传内部词汇）",
    );
  }

  /* ================================================================ */
  section("D8 Timeline 零内部泄漏（渲染输出级防线）");
  {
    const view = buildWorkforceJobViewModel({
      run: makeRun({ id: "run_d8", status: "completed" }),
      steps: [makeStep("s1", "completed", { completedAt: at(3) })],
      events: makeEvents([
        ...workingEventPrefix(),
        {
          type: "job.waiting_human",
          visible: true,
          title: "等待审批后继续",
          payload: {
            humanRequirement: { type: "APPROVAL_REQUIRED" },
            clarification: null,
          },
        },
        { type: "job.resumed", visible: true, title: "Workforce Job 已恢复" },
        {
          type: "job.completed",
          visible: true,
          title: "Workforce Job 已完成",
          payload: { status: "completed", correlation: { traceId: "trace_secret_9" } },
        },
      ]),
      pendingActions: [],
    });

    ok(view.internalTimeline === undefined, "默认视图无 internalTimeline");

    // 用户最终看到的全部字符串（条目正文 + 类别标签 + 状态标签）
    const rendered = [
      ...view.timeline.map(
        (t) => `${timelineKindPresentation(t.kind).label}｜${timelineItemText(t)}`,
      ),
      jobStatusLabel(view.status),
    ].join("\n");

    const forbidden = [
      "lease",
      "租约",
      "fence",
      "trace",
      "correlation",
      "internalArgs",
      "sales_get_pipeline",
      "tool.",
      "step.started",
      "job.claimed",
      "Workforce Job",
      "stack",
      "errorMessage",
    ];
    const leaked = forbidden.filter((word) => rendered.includes(word));
    ok(leaked.length === 0, "渲染输出不含任何内部词汇", { leaked, rendered });

    ok(
      view.timeline.some(
        (t) => t.kind === "NEEDS_YOU" && timelineItemText(t) === "等待审批后继续",
      ),
      "NEEDS_YOU 条目使用事件人话标题",
    );
    ok(
      view.timeline.some(
        (t) => t.kind === "PROGRESS" && timelineItemText(t) === "任务 s1 完成",
      ),
      "PROGRESS 条目使用步骤人话标题",
    );
    ok(
      view.timeline.some(
        (t) => t.kind === "COMPLETED" && timelineItemText(t) === "任务已完成",
      ),
      "终态条目使用字典文案（覆盖工程话术标题）",
    );
    ok(
      view.timeline.some(
        (t) => t.eventType === "plan.created" && timelineItemText(t) === "已拆解任务计划",
      ),
      "plan.created → 已拆解任务计划",
    );
    ok(
      timelineKindPresentation("SOME_FUTURE_KIND").label === "动态",
      "未知 timeline 类别 fail-safe（前向兼容）",
    );
  }

  /* ================================================================ */
  section("辅助展示函数（业务归属 / 相对时间）");
  {
    ok(businessRefLabel("project") === "项目", "businessRef project → 项目");
    ok(businessRefLabel("tender") === "招标", "businessRef tender → 招标");
    ok(businessRefLabel("unknown_entity") === "关联业务", "未知 ref 类型 fail-safe");
    const now = new Date("2026-08-10T10:00:00.000Z");
    ok(
      formatRelativeTime("2026-08-10T09:55:00.000Z", now) === "5 分钟前",
      "相对时间：5 分钟前",
    );
    ok(
      formatRelativeTime("2026-08-10T07:00:00.000Z", now) === "3 小时前",
      "相对时间：3 小时前",
    );
    ok(formatDuration(undefined, "2026-08-10T10:00:00.000Z") === undefined, "缺 startedAt 不显示用时");
  }

  /* ================================================================ */
  section("D10 响应式（静态审计：桌面双栏 / 移动单列 / 可横滑 Tab）");
  {
    const uiDir = join(__dirname, "..");
    const centerSrc = readFileSync(join(uiDir, "page.tsx"), "utf8");
    const detailSrc = readFileSync(join(uiDir, "[id]", "page.tsx"), "utf8");
    const cardSrc = readFileSync(join(uiDir, "job-card.tsx"), "utf8");

    ok(
      centerSrc.includes("overflow-x-auto") && centerSrc.includes("max-w-3xl"),
      "Job Center：Tab 可横滑 + 移动优先单列容器",
    );
    ok(
      detailSrc.includes("grid-cols-1") && detailSrc.includes("lg:grid-cols-"),
      "Job Detail：移动单列、桌面(lg+)双栏",
    );
    ok(
      cardSrc.includes("flex-wrap") && cardSrc.includes("truncate"),
      "Job Card：窄屏元信息换行 + 长标题截断",
    );
    ok(
      centerSrc.includes("EmptyState") &&
        centerSrc.includes("JobListSkeleton") &&
        centerSrc.includes("needsSelection"),
      "Job Center：loading / empty / 403 org selection 状态齐备",
    );
    ok(
      detailSrc.includes("not_found") &&
        detailSrc.includes("org_selection") &&
        detailSrc.includes("server_error") &&
        detailSrc.includes("DetailSkeleton"),
      "Job Detail：loading / 404 / 403 / 5xx 状态齐备",
    );
  }

  /* ================================================================ */
  section("任务书 §21 无 Runtime Mutation（静态审计：全只读）");
  {
    // API 面：src/app/api/workforce 下所有 route.ts 只允许 GET
    const apiDir = join(__dirname, "..", "..", "..", "api", "workforce");
    const routeFiles = walk(apiDir).filter((f) => f.endsWith("route.ts"));
    ok(routeFiles.length >= 2, `审计 ${routeFiles.length} 个 API 路由文件`, routeFiles);
    for (const file of routeFiles) {
      const text = readFileSync(file, "utf8");
      const rel = file.slice(file.indexOf("api"));
      ok(text.includes("export const GET"), `${rel} 导出 GET`);
      const mutationExports = ["POST", "PUT", "PATCH", "DELETE"].filter((m) =>
        new RegExp(`export\\s+(const|async function|function)\\s+${m}\\b`).test(text),
      );
      ok(mutationExports.length === 0, `${rel} 零 mutation 方法导出`, mutationExports);
      const dbMutations = [
        ".create(",
        ".createMany(",
        ".update(",
        ".updateMany(",
        ".upsert(",
        ".delete(",
        ".deleteMany(",
        "$executeRaw",
        "$transaction",
      ].filter((m) => text.includes(m));
      ok(dbMutations.length === 0, `${rel} 零 DB 写入标记`, dbMutations);
      ok(!text.includes("includeInternal"), `${rel} 不透出 internal 视图开关`);
    }

    // UI 面：workforce 目录零 mutation fetch、零 internalTimeline 消费、
    // 零 Runtime core import
    const uiDir = join(__dirname, "..");
    const uiFiles = walk(uiDir).filter(
      (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes("__tests__"),
    );
    ok(uiFiles.length >= 4, `审计 ${uiFiles.length} 个 UI 源文件`, uiFiles);
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      const rel = file.slice(file.indexOf("workforce"));
      const mutatingFetch = /method:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(text);
      ok(!mutatingFetch, `${rel} 零 mutation fetch`);
      ok(!text.includes("internalTimeline"), `${rel} 不消费 internalTimeline`);
      const coreImports = [
        "workforce-runtime/processor",
        "workforce-runtime/resume",
        "workforce-runtime/job",
        "agent-runtime-v2/executor",
        "agent-runtime-v2/persist",
        "pending-actions/executor",
      ].filter((m) => text.includes(m));
      ok(coreImports.length === 0, `${rel} 零 Runtime core import`, coreImports);
    }
  }

  /* ================================================================ */
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

main();
