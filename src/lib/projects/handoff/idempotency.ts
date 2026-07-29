import { createHash } from "node:crypto";
import {
  HANDOFF_TYPE_AWARD_TO_DELIVERY,
  type HandoffType,
} from "./types";

/** 服务端确定性业务键明文 */
export function buildHandoffIdempotencyPlain(input: {
  orgId: string;
  sourceTenderProjectId: string;
  handoffType?: HandoffType;
}): string {
  const type = input.handoffType ?? HANDOFF_TYPE_AWARD_TO_DELIVERY;
  return `award-to-delivery:${input.orgId}:${input.sourceTenderProjectId}:${type}`;
}

/** 存库用 hash，避免过长明文 */
export function buildHandoffIdempotencyKey(input: {
  orgId: string;
  sourceTenderProjectId: string;
  handoffType?: HandoffType;
}): string {
  const plain = buildHandoffIdempotencyPlain(input);
  return createHash("sha256").update(plain).digest("hex");
}

export function buildHandoffTaskBatchKey(handoffId: string): string {
  return `handoff:${handoffId}`;
}
