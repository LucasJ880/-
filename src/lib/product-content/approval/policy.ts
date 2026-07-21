import type { AgentApprovalSettings } from "@prisma/client";
import type {
  ApprovalActionKey,
  ApprovalPolicy,
  ExecutionMode,
} from "@/lib/product-content/types";

type SettingsLike = Pick<
  AgentApprovalSettings,
  | "autoAnalyzeFiles"
  | "autoCreateProductDraft"
  | "autoGenerateLowCostVisuals"
  | "autoRunFidelityQa"
  | "autoGenerateCopyDraft"
  | "autoGenerateFormalDocuments"
  | "askBeforeHighCostModel"
  | "askBeforeCreativeMode"
  | "askBeforeFormalPdf"
  | "askBeforeOverwriteApprovedContent"
  | "askBeforeExternalSend"
  | "askBeforePublish"
>;

function boolToPolicy(auto: boolean, executionMode: ExecutionMode): ApprovalPolicy {
  if (executionMode === "ALWAYS_ASK") return "ASK_BEFORE";
  return auto ? "AUTO_ALLOW" : "ASK_BEFORE";
}

function askToPolicy(ask: boolean, executionMode: ExecutionMode): ApprovalPolicy {
  if (executionMode === "ALWAYS_ASK") return "ASK_BEFORE";
  return ask ? "ASK_BEFORE" : "AUTO_ALLOW";
}

export function resolveApprovalPolicy(
  settings: SettingsLike,
  executionMode: ExecutionMode,
  actionKey: ApprovalActionKey,
): ApprovalPolicy {
  switch (actionKey) {
    case "analyze_files":
      return boolToPolicy(settings.autoAnalyzeFiles, executionMode);
    case "create_product_draft":
      return boolToPolicy(settings.autoCreateProductDraft, executionMode);
    case "generate_low_cost_visuals":
      return boolToPolicy(settings.autoGenerateLowCostVisuals, executionMode);
    case "run_fidelity_qa":
      return boolToPolicy(settings.autoRunFidelityQa, executionMode);
    case "generate_copy_draft":
      return boolToPolicy(settings.autoGenerateCopyDraft, executionMode);
    case "generate_formal_pdf":
      return askToPolicy(settings.askBeforeFormalPdf, executionMode);
    case "generate_formal_zip":
      return boolToPolicy(settings.autoGenerateFormalDocuments, executionMode);
    case "high_cost_model":
      return askToPolicy(settings.askBeforeHighCostModel, executionMode);
    case "creative_mode":
      return askToPolicy(settings.askBeforeCreativeMode, executionMode);
    case "overwrite_approved":
      return askToPolicy(settings.askBeforeOverwriteApprovedContent, executionMode);
    case "external_send":
      return askToPolicy(settings.askBeforeExternalSend, executionMode);
    case "publish":
      return askToPolicy(settings.askBeforePublish, executionMode);
    case "modify_price":
      return executionMode === "ALWAYS_ASK" ? "ASK_BEFORE" : "MANUAL_ONLY";
    case "modify_certification":
      return "MANUAL_ONLY";
    default:
      return "ASK_BEFORE";
  }
}
