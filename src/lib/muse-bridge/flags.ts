/**
 * Muse Bridge — 开关（生产默认全关）
 *
 *   MUSE_BRIDGE_ENABLED   "1" 才开；否则 /api/bridge/muse/* 一律 BRIDGE_DISABLED
 *   MUSE_BRIDGE_INTENTS   逗号分隔的意图白名单；为空 → 仅 Phase 0 四个意图（status,ask,approve,reject）
 *                         Phase 1 按需逐个打开：rfq（P1-2 询价）、compare / price_scenario（P1-6 比价 / 定价情景）
 *                         例：status,ask,approve,reject,rfq,compare,price_scenario
 *   MUSE_BRIDGE_ORG_ALLOWLIST  逗号分隔 orgId；为空 → 任意 org（仍需绑定 + membership）
 */

import { MUSE_PHASE0_INTENTS, isMuseIntent, type MuseIntent } from "./contract";

function envOn(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "on";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

export function isMuseBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envOn(env.MUSE_BRIDGE_ENABLED);
}

/** 当前放行的意图集（纯函数，便于测试）。 */
export function enabledMuseIntents(env: NodeJS.ProcessEnv = process.env): ReadonlySet<MuseIntent> {
  const configured = envList(env.MUSE_BRIDGE_INTENTS).filter(isMuseIntent);
  return new Set(configured.length > 0 ? configured : MUSE_PHASE0_INTENTS);
}

export function isMuseIntentEnabled(intent: MuseIntent, env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledMuseIntents(env).has(intent);
}

export function isMuseOrgAllowed(orgId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = envList(env.MUSE_BRIDGE_ORG_ALLOWLIST);
  return list.length === 0 || list.includes(orgId);
}
