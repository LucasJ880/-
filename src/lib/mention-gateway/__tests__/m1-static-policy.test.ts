/**
 * Mention Gateway M1 — 结构级静态断言（源码扫描）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m1-static-policy.test.ts
 *
 * 证明（by construction）：
 * - 网关源码不引用任何记忆写入 / 外部发送 / Runtime V2 / Workforce / 旧渠道路径
 * - 源码中不存在 `hasMembership: true` 字面量（membership 只能来自查询）
 * - 只通过 agent-core runAgent 进入模型；不调用 executeConversationRun
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { finish, ok } from "./helpers";

const root = process.cwd();
const dir = join(root, "src/lib/mention-gateway");

function listSources(d: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(d)) {
    const p = join(d, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...listSources(p));
    } else if (p.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = [
  ...listSources(dir),
  join(root, "src/app/api/mention-gateway/mock/route.ts"),
];

const FORBIDDEN: Array<{ token: RegExp; why: string }> = [
  { token: /extractAndIndex/, why: "记忆写入（gateway.ts extractAndIndex）" },
  { token: /saveMemories|extractMemoriesFromConversation|memory-storage|user-memory/, why: "UserMemory 写入/读取面" },
  { token: /updateAgentSessionSummary|session-memory/, why: "会话摘要持久化" },
  { token: /corporate-memory\/claim-service|createMemoryClaim/, why: "企业记忆写入" },
  { token: /context_index_messages|rebuildIndex|MessageEmbedding/, why: "对话索引写入" },
  { token: /pushMessage\(|sendToExternalUser|pushNotification|push-service/, why: "微信/企微推送" },
  { token: /sendGmail|sendSalesEmail|createGmailDraft|google-email|email\/sender/, why: "邮件发送/草稿" },
  { token: /WeComAdapter|PersonalWeChatAdapter|messaging\/gateway|messaging\/adapters/, why: "真实渠道适配器" },
  { token: /dispatchWebhook|webhook\/dispatcher/, why: "出站 webhook" },
  { token: /agent-runtime-v2|executeRuntimeV2Tool|RUNTIME_V2_TOOL/, why: "Runtime V2 executor" },
  { token: /workforce-runtime|createWorkforceJob/, why: "Workforce runtime" },
  { token: /executeConversationRun|agent-runtime\/process/, why: "旧渠道会话壳（缺租户字段）" },
  { token: /runSupervisor|agent-supervisor/, why: "Supervisor 路径" },
  { token: /createDraft|pending-actions\/drafts|approveApprovalItem|rejectApprovalItem/, why: "M1 不创建/决定审批" },
  { token: /hasMembership:\s*true/, why: "硬编码 membership" },
  { token: /isPlatformAdmin:\s*true/, why: "硬编码平台管理员" },
  { token: /maxRisk:\s*["'](l1_internal_write|l2_soft|l3_strong)["']/, why: "硬编码高于 l0 的 maxRisk" },
  { token: /fetch\(\s*["']https?:/, why: "直接外网调用" },
];

console.log(`扫描 ${files.length} 个源码文件`);
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const rel = f.replace(root + "/", "");
  for (const rule of FORBIDDEN) {
    ok(!rule.token.test(text), `${rel}: 不含 ${rule.why}`);
  }
}

{
  const handle = readFileSync(join(dir, "handle.ts"), "utf8");
  ok(/import\("@\/lib\/agent-core"\)/.test(handle) && /runAgent\(/.test(handle), "handle.ts 通过 @/lib/agent-core runAgent 进入模型");
  ok(/import\("@\/lib\/agent-core\/tools"\)/.test(handle), "handle.ts 注册 Registry 工具（与 Web/agent-core chat 同一 Registry）");
  ok(/resolveMentionIdentity\(/.test(handle) && /resolveMentionContext\(/.test(handle), "handle.ts 先 identity/context 再 runAgent");
  const identity = readFileSync(join(dir, "identity.ts"), "utf8");
  ok(/resolveAgentTenant/.test(identity) && /hasMembership !== true/.test(identity), "identity.ts 以 resolveAgentTenant.hasMembership 作为唯一 membership 来源");
  const context = readFileSync(join(dir, "context.ts"), "utf8");
  ok(/resolveAgentScope/.test(context) && /CHANNEL_ORG_MISMATCH/.test(context) && /CONTEXT_UNRESOLVED/.test(context), "context.ts 经 resolveAgentScope，且 fail-closed 码齐全");
  const policy = readFileSync(join(dir, "policy.ts"), "utf8");
  ok(/tools:\s*\[\.\.\.policy\.tools\]/.test(policy) && /resolveMentionToolPolicy\(input\.contextType\)/.test(policy), "policy.ts 只传按上下文解析的显式 allowlist（M2-C）");
  ok(/toScopeGuard\(input\.scope\)/.test(policy), "policy.ts scopeGuard 来自 resolveAgentScope 结果");
  const route = readFileSync(join(root, "src/app/api/mention-gateway/mock/route.ts"), "utf8");
  ok(/withAuth\(/.test(route) && /isMentionMockEnabled\(\)/.test(route) && /checkRateLimitAsync/.test(route), "route：withAuth + mock flag/生产门禁 + 限流");
  ok(!/export const GET|export async function GET/.test(route), "route 无 GET（无匿名/公开面）");
}

console.log("");
console.log("MENTION_GATEWAY_CANNOT_WRITE_MEMORY = PASS");
console.log("MENTION_GATEWAY_CANNOT_EXTERNAL_SEND = PASS");
console.log("RUNTIME_V2_USED = NO");
finish("M1 Static Policy");
