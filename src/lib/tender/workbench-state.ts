/**
 * Tender Workbench 状态投影（单一事实源 → UI）
 *
 * 背景（PR #106 UAT）：工作台把「右上角上传」「快速开始 去上传」「决策摘要 缺少源文件」
 * 等多个 CTA/状态各自计算，出现「AI 正在解析」同时「0/3 / 去上传 / 缺少源文件」的冲突。
 *
 * 本模块把 canonical 后端状态（documentCount / 最新 TenderAnalysisRun 状态 / 解析中）
 * 投影为工作台需要的：三步状态 + 单一 primary CTA + 推荐下一步 + 文件入口标签。
 * 纯函数，便于单测（见 __tests__/workbench-state.test.ts）。绝不伪造状态（§13）。
 */

/** 最新 TenderAnalysisRun 的业务相位（由 run.status 归一）。 */
export type TenderAnalysisPhase =
  | "none" // 无分析 run
  | "processing" // PENDING / EXTRACTING / ANALYZING / SUPERSEDED
  | "review_required" // REVIEW_REQUIRED
  | "approved" // APPROVED（= 要求已确认）
  | "failed"; // FAILED

export function analysisPhaseFromRunStatus(
  status: string | null | undefined,
): TenderAnalysisPhase {
  switch ((status ?? "").toUpperCase()) {
    case "PENDING":
    case "EXTRACTING":
    case "ANALYZING":
    case "SUPERSEDED":
      return "processing";
    case "REVIEW_REQUIRED":
      return "review_required";
    case "APPROVED":
      return "approved";
    case "FAILED":
      return "failed";
    default:
      return "none";
  }
}

export type WbStepState = "pending" | "processing" | "active" | "done";

export type WbTarget = "files" | "requirements" | "bid";
export type WbCta = { label: string; target: WbTarget };

export type WbStep = {
  key: "upload" | "requirements" | "bid";
  title: string;
  caption: string;
  state: WbStepState;
  cta: WbCta | null;
};

export type TenderWorkbenchState = {
  documentCount: number;
  /** 0..3；仅在有 canonical 依据时才算 completed（§6/§13） */
  completedSteps: number;
  steps: [WbStep, WbStep, WbStep];
  /** 全页当前唯一 primary CTA；AI 工作中时为 null（§11） */
  primaryAction: WbCta | null;
  recommendation: { title: string; body: string };
  /** 单一文件入口标签（§2/§10） */
  fileEntryLabel: string;
  /** 是否处于「AI 正在工作」相位（用于隐藏所有上传/确认 CTA） */
  analysisActive: boolean;
};

export type DeriveWorkbenchInput = {
  documentCount: number;
  analysisPhase: TenderAnalysisPhase;
  /** 文件解析流水线（process-next）进行中 —— 真实 active 状态，非伪造 */
  parsingActive?: boolean;
};

export function deriveTenderWorkbenchState(
  input: DeriveWorkbenchInput,
): TenderWorkbenchState {
  const n = Math.max(0, input.documentCount | 0);
  const hasDocs = n > 0;
  // 阶段 A：文件预处理（解析/提取/逐文件摘要）；阶段 B：Tender Package AI（跨文件整包理解）。
  // 两者必须区分文案（§9），且都属于「AI 正在工作」相位（隐藏所有上传/确认 CTA）。
  const phaseAParsing = hasDocs && Boolean(input.parsingActive);
  const phaseBPackageAi = hasDocs && input.analysisPhase === "processing";
  const analysisActive = phaseAParsing || phaseBPackageAi;

  const upload = (): WbStep =>
    hasDocs
      ? {
          key: "upload",
          title: "上传项目文件",
          caption: `已上传 ${n} 个文件`,
          state: "done",
          cta: null, // §3：documentCount>0 时移除任何上传 CTA
        }
      : {
          key: "upload",
          title: "上传项目文件",
          caption: "上传招标文件、需求文档，青砚将自动解析内容。",
          state: "pending",
          cta: { label: "去上传", target: "files" },
        };

  const requirements = (): WbStep => {
    if (!hasDocs) {
      return {
        key: "requirements",
        title: "确认招标要求",
        caption: "上传招标文件后，AI 将提取范围、要求、风险和澄清问题。",
        state: "pending",
        cta: null,
      };
    }
    if (analysisActive) {
      return {
        key: "requirements",
        title: "确认招标要求",
        // §9：阶段 A（文件预处理）≠ 阶段 B（Tender Package AI），不得混称「分析完成/分析中」
        caption: phaseAParsing ? "文件解析中" : "AI 正在理解整个招标项目",
        state: "processing",
        cta: null, // §4：结果未就绪不显示「去确认」
      };
    }
    switch (input.analysisPhase) {
      case "review_required":
        return {
          key: "requirements",
          title: "确认招标要求",
          caption: "AI 分析完成，待你确认",
          state: "active",
          cta: { label: "查看并确认", target: "requirements" },
        };
      case "approved":
        return {
          key: "requirements",
          title: "确认招标要求",
          caption: "招标要求已确认",
          state: "done",
          cta: null,
        };
      case "failed":
        return {
          key: "requirements",
          title: "确认招标要求",
          caption: "分析失败，结果可能过期",
          state: "active",
          cta: { label: "查看招标分析", target: "requirements" },
        };
      default:
        // 有文件但尚无 run、且未在解析（legacy / flag-off / 入队间隙）——
        // 真实状态 + 真实入口（§11/§13：不伪造「分析中/等待开始」的永久转圈）
        return {
          key: "requirements",
          title: "确认招标要求",
          caption: "Tender Package 尚未开始分析",
          state: "active",
          cta: { label: "开始项目解读", target: "requirements" },
        };
    }
  };

  const bid = (): WbStep => {
    const requirementsConfirmed = hasDocs && input.analysisPhase === "approved";
    return requirementsConfirmed
      ? {
          key: "bid",
          title: "准备标书与报价",
          caption: "可开始",
          state: "active",
          cta: { label: "准备标书与报价", target: "bid" },
        }
      : {
          key: "bid",
          title: "准备标书与报价",
          caption: "完成招标要求确认后进入",
          state: "pending",
          cta: null,
        };
  };

  const steps: [WbStep, WbStep, WbStep] = [upload(), requirements(), bid()];

  // completedSteps：仅 canonical 依据（§6）——step1=有文件；step2=已确认(approved)；step3 无可靠信号→不计
  let completedSteps = 0;
  if (hasDocs) completedSteps += 1;
  if (input.analysisPhase === "approved") completedSteps += 1;

  // 单一 primary CTA（§11）：AI 工作中为 null
  let primaryAction: WbCta | null;
  let recommendation: { title: string; body: string };
  if (!hasDocs) {
    primaryAction = { label: "上传招标文件", target: "files" };
    recommendation = {
      title: "上传招标文件",
      body: "先补充完整源文件，AI 才能可靠分析项目范围、要求和风险。",
    };
  } else if (analysisActive) {
    primaryAction = null;
    recommendation = phaseAParsing
      ? {
          title: "等待文件解析完成",
          body: `已接收 ${n} 个文件，正在解析文件、提取文字与逐文件摘要。解析完成后 AI 将开始理解整个招标项目。`,
        }
      : {
          title: "等待 AI 完成整包分析",
          body: `AI 正在理解整个招标项目：整合 ${n} 个文件的跨文件要求，分析冲突、风险和澄清项。完成后请确认招标要求。`,
        };
  } else if (input.analysisPhase === "review_required") {
    primaryAction = { label: "查看并确认招标要求", target: "requirements" };
    recommendation = {
      title: "确认关键招标要求",
      body: "AI 已完成 Tender Package 分析。请确认强制要求、风险和待澄清事项。",
    };
  } else if (input.analysisPhase === "approved") {
    primaryAction = { label: "准备标书与报价", target: "bid" };
    recommendation = {
      title: "准备标书与报价",
      body: "关键招标要求已确认，可以进入报价和标书准备。",
    };
  } else if (input.analysisPhase === "failed") {
    primaryAction = { label: "查看招标分析", target: "requirements" };
    recommendation = {
      title: "招标分析失败",
      body: "AI 分析失败或结果可能过期，请在招标要求中重新发起分析。",
    };
  } else {
    // 有文件、无 run、未解析：真实引导到招标要求发起分析（不许诺不会发生的自动分析）
    primaryAction = { label: "开始项目解读", target: "requirements" };
    recommendation = {
      title: "开始项目解读",
      body: `已上传 ${n} 个文件。发起 Tender Package 分析，AI 将提取范围、要求、风险和澄清项。`,
    };
  }

  return {
    documentCount: n,
    completedSteps,
    steps,
    primaryAction,
    recommendation,
    fileEntryLabel: hasDocs ? `项目文件 · ${n}` : "上传招标文件",
    analysisActive,
  };
}
