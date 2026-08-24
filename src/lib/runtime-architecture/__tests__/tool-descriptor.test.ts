/**
 * R1 §8 — canonical tool descriptor bridge describes existing catalogs
 * WITHOUT importing runtime modules (source-parsed, zero behavior change).
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/tool-descriptor.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  fromAgentCorePolicy,
  fromRuntimeV2Descriptor,
  fromLegacySkill,
  fromUnratedTool,
} from "../tool-descriptor";
import { finish, ok } from "./helpers";

const root = process.cwd();

// ── Parse TOOL_POLICY (agent-core) from source ──────────────────────────────
const policyText = readFileSync(join(root, "src/lib/agent-core/tools/_policy.ts"), "utf8");
const policyBlock = policyText.slice(
  policyText.indexOf("export const TOOL_POLICY"),
  policyText.indexOf("\n};", policyText.indexOf("export const TOOL_POLICY")),
);
const policyEntries = [
  ...policyBlock.matchAll(/^\s*([a-z0-9_]+):\s*\{\s*risk:\s*"([a-z0-9_]+)"/gim),
].map((m) => ({ name: m[1], risk: m[2] }));
ok(policyEntries.length >= 90, `TOOL_POLICY 解析出 ≥90 个工具（实际 ${policyEntries.length}）`);

const policyDescriptors = policyEntries.map((e) => fromAgentCorePolicy(e));
ok(policyDescriptors.every((d) => d.sourceRegistry === "agent-core.tool-policy"), "agent-core 描述符 sourceRegistry 正确");
ok(policyDescriptors.every((d) => !d.failClosedRisk), "全部 93 风险值可无损归一化（无 fail-closed）");
ok(
  policyDescriptors.filter((d) => d.originalRisk.value === "l3_strong").every((d) => d.requiresApproval),
  "l3_strong → requiresApproval=true（审批语义保留）",
);
ok(
  policyDescriptors.every((d) => d.originalRisk.vocabulary === "agent-core.tool-risk"),
  "原始风险词表逐条保留（审计）",
);

// ── Parse RUNTIME_V2_TOOL_CATALOG from source ───────────────────────────────
const catalogText = readFileSync(join(root, "src/lib/agent-runtime-v2/tool-catalog.ts"), "utf8");
const catalogBlock = catalogText.slice(
  catalogText.indexOf("RUNTIME_V2_TOOL_CATALOG"),
  catalogText.indexOf("\n];", catalogText.indexOf("RUNTIME_V2_TOOL_CATALOG")),
);
const v2Entries = [...catalogBlock.matchAll(/\{[^{}]*?\}/gs)]
  .map((m) => m[0])
  .filter((o) => /name:\s*"/.test(o))
  .map((o) => ({
    name: /name:\s*"([^"]+)"/.exec(o)![1],
    riskLevel: /riskLevel:\s*"([A-Z]+)"/.exec(o)?.[1] ?? "UNKNOWN",
    readOnly: /readOnly:\s*true/.test(o),
    requiresApproval: /requiresApproval:\s*true/.test(o),
  }));
ok(v2Entries.length === 13, `RUNTIME_V2_TOOL_CATALOG 解析出 13 个描述符（实际 ${v2Entries.length}）`);

const v2Descriptors = v2Entries.map((e) => fromRuntimeV2Descriptor(e));
ok(v2Descriptors.every((d) => !d.failClosedRisk), "V2 目录风险值全部可归一化");
ok(
  v2Descriptors.filter((d) => d.originalRisk.requiresApproval).every((d) => d.requiresApproval),
  "V2 requiresApproval 永不丢失",
);
ok(
  v2Descriptors
    .filter((d) => d.originalRisk.readOnly !== true)
    .every((d) => d.risk !== "read"),
  "非 readOnly 的 V2 工具不会归一化为 read（不降级）",
);

// 同名工具在两套目录下的 canonical 风险不允许 V2 比 agent-core 更宽松。
const policyByName = new Map(policyDescriptors.map((d) => [d.name, d]));
const order = { read: 0, low_write: 1, sensitive_write: 2, high_impact: 3, restricted: 4 } as const;
for (const d of v2Descriptors) {
  const p = policyByName.get(d.name);
  if (!p) continue;
  ok(
    order[d.risk] >= order[p.risk] || p.requiresApproval === d.requiresApproval,
    `重名工具 ${d.name}: V2 canonical 风险不低于 agent-core（${d.risk} vs ${p.risk}）或审批语义一致`,
  );
}

// ── Legacy / unrated bridges ────────────────────────────────────────────────
const legacy = fromLegacySkill({ name: "email-draft", riskLevel: "high", requiresApproval: true });
ok(legacy.risk === "high_impact" && legacy.requiresApproval, "legacy high → high_impact + 审批保留");
const unrated = fromUnratedTool({ name: "echo", domain: "project-conversation", sourceRegistry: "db.tool-registry" });
ok(unrated.risk === "restricted" && unrated.requiresApproval && unrated.failClosedRisk, "无风险元数据的 DB 工具 → restricted fail-closed");

finish("canonical tool descriptor bridge");
