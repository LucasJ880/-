/**
 * Muse Bridge — 事件信封构造（纯函数，零 DB），供 events.ts 与测试共用。
 */

import { MUSE_BRIDGE_CONTRACT_VERSION, museEventEnvelopeSchema, type MuseEventEnvelope } from "./contract";
import { sanitizeOutbound } from "./router-pure";

export type EmitMuseEventInput = Omit<MuseEventEnvelope, "contractVersion" | "occurredAt"> & {
  occurredAt?: string;
};

/** 纯函数：构造并校验信封（测试用；不落库）。 */
export function buildMuseEvent(input: EmitMuseEventInput): MuseEventEnvelope | null {
  const candidate = {
    ...input,
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    summary: sanitizeOutbound(input.summary).slice(0, 300),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  const r = museEventEnvelopeSchema.safeParse(candidate);
  return r.success ? r.data : null;
}

