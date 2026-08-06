/**
 * TenderAnalysisRun 幂等键
 * 组成：projectId + sourceHashFingerprint + promptVersion + analysisVersion
 */

import { createHash } from "node:crypto";
import type { BuildIdempotencyKeyInput } from "./types";

/** 明文业务键（调试用） */
export function buildIdempotencyPlain(input: BuildIdempotencyKeyInput): string {
  return [
    "tender-analysis",
    input.projectId,
    input.fingerprint,
    input.promptVersion,
    input.analysisVersion,
  ].join(":");
}

/** 存库用 sha256 hex */
export function buildIdempotencyKey(input: BuildIdempotencyKeyInput): string {
  return createHash("sha256").update(buildIdempotencyPlain(input), "utf8").digest("hex");
}
