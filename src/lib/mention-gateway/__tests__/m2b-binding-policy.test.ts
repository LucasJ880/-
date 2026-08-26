/**
 * Mention Gateway M2-B — Persistent Channel Context Binding 纯逻辑测试（无 DB / 模型 / 网络）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m2b-binding-policy.test.ts
 *
 * 覆盖：binding 来源/管理 flags（fail-closed）/ 键归一化与 threadId 哨兵 /
 * decideCreateBindingOutcome（NO BLIND UPSERT）/ DB 行 → 运行期 contextType 映射 /
 * fixture 租户键隔离 / hash 隐私 / 管理端点守卫存在性（fs）/ AI-write 端点缺席 /
 * dedupe 次序（binding/scope 失败不得污染 DuplicateEventGuard）。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isMentionBindingAdminEnabledWithEnv,
  resolveMentionBindingSourceWithEnv,
} from "../flags";
import {
  bindingRowToContextType,
  decideCreateBindingOutcome,
  hashChannelToken,
  normalizeBindingKey,
} from "../binding-service";
import { MentionFixtureStore } from "../fixtures";
import { DuplicateEventGuard, handleMentionEvent } from "../handle";
import { TEST_ENV, baseRaw, finish, isCode, makeFakeDeps, ok } from "./helpers";

async function main() {
  let noBlindUpsert = true;
  let revokedTerminalPure = true;
  let tenantKeyIsolation = true;
  let failedBindingCannotPoison = true;
  let failedScopeCannotPoison = true;
  let sourceFailClosed = true;

  console.log("M2B-1 binding 来源 flag：默认 fixture / db 显式 / 非法值 fail-closed（null）");
  {
    ok(resolveMentionBindingSourceWithEnv({}) === "fixture", "缺省 → fixture");
    ok(resolveMentionBindingSourceWithEnv({ MENTION_GATEWAY_BINDING_SOURCE: "fixture" }) === "fixture", "fixture → fixture");
    ok(resolveMentionBindingSourceWithEnv({ MENTION_GATEWAY_BINDING_SOURCE: "db" }) === "db", "db → db");
    ok(resolveMentionBindingSourceWithEnv({ MENTION_GATEWAY_BINDING_SOURCE: "DB" }) === "db", "大小写归一");
    for (const bad of ["database", "fixture,db", "1", "yes"]) {
      const v = resolveMentionBindingSourceWithEnv({ MENTION_GATEWAY_BINDING_SOURCE: bad });
      ok(v === null, `非法值 ${JSON.stringify(bad)} → null（网关将 GATEWAY_DISABLED）`);
      if (v !== null) sourceFailClosed = false;
    }
    ok(isMentionBindingAdminEnabledWithEnv({}) === false, "BINDING_ADMIN 缺省 → false");
    ok(isMentionBindingAdminEnabledWithEnv({ MENTION_GATEWAY_BINDING_ADMIN_ENABLED: "1" }) === true, "=1 → true");
  }

  console.log("M2B-2 handle 层：binding 来源非法 → GATEWAY_DISABLED（不触达任何依赖）");
  {
    const { deps, adapter, calls } = makeFakeDeps();
    const r = await handleMentionEvent({
      raw: baseRaw(),
      adapter,
      deps,
      env: { ...TEST_ENV, MENTION_GATEWAY_BINDING_SOURCE: "database" },
    });
    ok(isCode(r, "GATEWAY_DISABLED"), "非法 MENTION_GATEWAY_BINDING_SOURCE → GATEWAY_DISABLED");
    if (!isCode(r, "GATEWAY_DISABLED")) sourceFailClosed = false;
    ok(calls.length === 0 && adapter.outbox.length === 0, "未触达依赖 / 未外发");
  }

  console.log("M2B-3 键归一化：threadId 哨兵（B5 设计）");
  {
    const channel = normalizeBindingKey({ provider: "wecom", providerTenantId: " corp1 ", providerChannelId: " chan1 " });
    ok(channel.ok && channel.key.bindingLevel === "CHANNEL" && channel.key.providerThreadId === "", "缺省 threadId → CHANNEL + \"\" 哨兵");
    const thread = normalizeBindingKey({ provider: "wecom", providerTenantId: "corp1", providerChannelId: "chan1", providerThreadId: " t1 " });
    ok(thread.ok && thread.key.bindingLevel === "THREAD" && thread.key.providerThreadId === "t1", "显式 threadId → THREAD + trim 后真实 id");
    ok(!normalizeBindingKey({ provider: "wecom", providerTenantId: "corp1", providerChannelId: "chan1", providerThreadId: "" }).ok, "显式空串 threadId → INVALID（不得静默降级 channel 级）");
    ok(!normalizeBindingKey({ provider: "wecom", providerTenantId: "corp1", providerChannelId: "chan1", providerThreadId: "   " }).ok, "全空白 threadId → INVALID");
    ok(!normalizeBindingKey({ provider: "email", providerTenantId: "t", providerChannelId: "c" }).ok, "未知 provider 拒绝");
    ok(!normalizeBindingKey({ provider: "wecom", providerTenantId: " ", providerChannelId: "c" }).ok, "空 tenant 拒绝");
    ok(!normalizeBindingKey({ provider: "wecom", providerTenantId: "t", providerChannelId: "" }).ok, "空 channel 拒绝");
    const n = normalizeBindingKey({ provider: "mock", providerTenantId: "mock", providerChannelId: "c", providerThreadId: null });
    ok(n.ok && n.key.bindingLevel === "CHANNEL", "null threadId → channel 级（对外 API 语义）");
  }

  console.log("M2B-4 decideCreateBindingOutcome：NO BLIND UPSERT / REVOKED 终态");
  {
    const target = { projectId: "p1", customerId: null, contextRole: null };
    ok(decideCreateBindingOutcome(null, target) === "CREATE", "不存在 → CREATE");
    ok(decideCreateBindingOutcome({ status: "ACTIVE", ...target }, target) === "IDEMPOTENT", "ACTIVE 同 target 同 role → IDEMPOTENT（零写）");
    const diffTarget = decideCreateBindingOutcome({ status: "ACTIVE", projectId: "p2", customerId: null, contextRole: null }, target);
    ok(diffTarget === "ALREADY_EXISTS", "ACTIVE 不同 target → ALREADY_EXISTS（必须显式 rebind）");
    if (diffTarget !== "ALREADY_EXISTS") noBlindUpsert = false;
    ok(decideCreateBindingOutcome({ status: "ACTIVE", projectId: "p1", customerId: null, contextRole: "tender" }, target) === "ALREADY_EXISTS", "同 target 不同 contextRole → ALREADY_EXISTS");
    ok(decideCreateBindingOutcome({ status: "ACTIVE", projectId: null, customerId: "c1", contextRole: null }, target) === "ALREADY_EXISTS", "project vs customer 冲突 → ALREADY_EXISTS");
    ok(decideCreateBindingOutcome({ status: "DISABLED", ...target }, target) === "REQUIRE_ENABLE_OR_REBIND", "DISABLED → REQUIRE_ENABLE_OR_REBIND");
    const revoked = decideCreateBindingOutcome({ status: "REVOKED", ...target }, target);
    ok(revoked === "REVOKED_TERMINAL", "REVOKED → 终态，同 exact key 不能 recreate");
    if (revoked !== "REVOKED_TERMINAL") revokedTerminalPure = false;
    const revokedSame = decideCreateBindingOutcome({ status: "REVOKED", ...target }, { ...target });
    ok(revokedSame === "REVOKED_TERMINAL", "REVOKED + 同 target 也不能 recreate（不偷偷复活）");
    if (revokedSame !== "REVOKED_TERMINAL") revokedTerminalPure = false;
  }

  console.log("M2B-5 DB 行 → 运行期 contextType（§35：M2-C 工具策略零第二套实现）");
  {
    ok(bindingRowToContextType({ projectId: "p", customerId: null, contextRole: null }) === "project", "project + role null → project");
    ok(bindingRowToContextType({ projectId: "p", customerId: null, contextRole: "tender" }) === "tender", "project + tender → tender（canonical 仍是 Project）");
    ok(bindingRowToContextType({ projectId: null, customerId: "c", contextRole: null }) === "sales", "customer → sales");
    ok(bindingRowToContextType({ projectId: null, customerId: null, contextRole: null }) === null, "XOR 破损（双空）→ null（上层 fail closed）");
    ok(bindingRowToContextType({ projectId: "p", customerId: "c", contextRole: null }) === null, "XOR 破损（双有）→ null");
  }

  console.log("M2B-6 hash 隐私：审计用 sha256 截断，不含 raw channel/thread id");
  {
    const h = hashChannelToken("secret-channel-id-123");
    ok(/^[0-9a-f]{16}$/.test(h) && !h.includes("secret"), "16 位 hex，无 raw 片段");
    ok(hashChannelToken("a") !== hashChannelToken("b"), "不同输入不同 hash");
  }

  console.log("M2B-7 fixture 租户键隔离（B1：provider+tenant+channel+thread）");
  {
    const store = new MentionFixtureStore();
    store.registerBinding({
      provider: "mock",
      providerTenantId: "tenant_a",
      channelId: "C1",
      threadId: "T1",
      organizationId: "org_a",
      contextType: "project",
      contextId: "proj_a",
    });
    store.registerBinding({
      provider: "mock",
      providerTenantId: "tenant_b",
      channelId: "C1",
      threadId: "T1",
      organizationId: "org_b",
      contextType: "project",
      contextId: "proj_b",
    });
    const a = store.lookupBinding("mock", "tenant_a", "C1", "T1");
    const b = store.lookupBinding("mock", "tenant_b", "C1", "T1");
    ok(a?.contextId === "proj_a" && b?.contextId === "proj_b", "同 channel/thread 不同租户 → 独立并存，互不命中");
    if (a?.contextId === b?.contextId) tenantKeyIsolation = false;
    ok(store.lookupBinding("mock", "tenant_c", "C1", "T1") === null, "未知租户 → null");
  }

  console.log("M2B-8 B5 dedupe 次序：binding / scope 失败不得消耗 DuplicateEventGuard key");
  {
    const guard = new DuplicateEventGuard();
    const { deps, adapter } = makeFakeDeps({ duplicateGuard: guard });
    // 未知频道 → CONTEXT_UNRESOLVED；guard 必须保持空
    const noBinding = await handleMentionEvent({
      raw: baseRaw({ channelId: "mock-unbound", eventId: "evt-b5" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(isCode(noBinding, "CONTEXT_UNRESOLVED"), "unknown binding → CONTEXT_UNRESOLVED");
    ok(guard.size() === 0, "binding 失败未写 dedupe（guard.size=0）");
    if (guard.size() !== 0) failedBindingCannotPoison = false;
    // 跨租户对象 → SCOPE_DENIED；guard 仍为空
    const scopeDenied = await handleMentionEvent({
      raw: baseRaw({ channelId: "mock-cross-tenant", eventId: "evt-b5" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(isCode(scopeDenied, "SCOPE_DENIED"), "scope denied → SCOPE_DENIED");
    ok(guard.size() === 0, "scope 失败未写 dedupe");
    if (guard.size() !== 0) failedScopeCannotPoison = false;
    // 修复后同 eventId 正常执行；完成后重放 → DUPLICATE
    const legit = await handleMentionEvent({
      raw: baseRaw({ eventId: "evt-b5" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(legit.ok === true, "修复 binding 后同 eventId → 正常执行（此前失败未预占键）");
    ok(guard.size() === 1, "成功执行后才写入 dedupe");
    const replay = await handleMentionEvent({
      raw: baseRaw({ eventId: "evt-b5" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(isCode(replay, "DUPLICATE_EVENT"), "合法完成后的重放 → DUPLICATE_EVENT");
  }

  console.log("M2B-9 管理端点守卫（fs）：写路由全部挂 requireBindingAdminContext；无 AI-write 端点");
  {
    const bindingsDir = join(process.cwd(), "src/app/api/mention-gateway/bindings");
    const entries = readdirSync(bindingsDir);
    ok(entries.includes("route.ts") && entries.includes("[id]"), "bindings 路由存在");
    const files = [
      "route.ts",
      "[id]/route.ts",
      "[id]/rebind/route.ts",
      "[id]/disable/route.ts",
      "[id]/enable/route.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(bindingsDir, rel), "utf8");
      ok(src.includes("requireBindingAdminContext"), `${rel} 挂 requireBindingAdminContext`);
      ok(!/runAgent|agent-core|executeConversation/.test(src), `${rel} 无任何 AI 执行路径（B0）`);
    }
    const create = readFileSync(join(bindingsDir, "route.ts"), "utf8");
    ok(create.includes(".strict()"), "create body zod strict");
    ok(!/orgId|bindingLevel|status|createdById|updatedById/.test(create.match(/CreateSchema = z[\s\S]*?\.strict\(\)/)?.[0] ?? "orgId"), "create body 不收 orgId/status/bindingLevel/createdById/updatedById");
  }

  finish("M2-B Binding Policy（纯逻辑）");
  console.log(`NO_BLIND_UPSERT = ${noBlindUpsert ? "PASS" : "FAIL"}`);
  console.log(`REVOKED_TERMINAL_PURE = ${revokedTerminalPure ? "PASS" : "FAIL"}`);
  console.log(`CROSS_TENANT_KEY_ISOLATION = ${tenantKeyIsolation ? "PASS" : "FAIL"}`);
  console.log(`FAILED_BINDING_CANNOT_POISON_DEDUPE = ${failedBindingCannotPoison ? "PASS" : "FAIL"}`);
  console.log(`FAILED_SCOPE_CANNOT_POISON_DEDUPE = ${failedScopeCannotPoison ? "PASS" : "FAIL"}`);
  console.log(`BINDING_SOURCE_FAIL_CLOSED = ${sourceFailClosed ? "PASS" : "FAIL"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
