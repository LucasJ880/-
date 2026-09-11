/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/resolve.test.ts
 */
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import { resolveModelPolicy } from "../resolve";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const off = resolveModelPolicy({
  role: "supervisor",
  env: {},
  userId: "u1",
});
expect(off.upgraded === false, "flag 关时不升级");
expect(off.model === OPENAI_BUILTIN.reasoning, "supervisor 基线仍是 reasoning");
expect(off.model !== OPENAI_GPT6_ASTRA, "kill switch 生效");

const on = resolveModelPolicy({
  role: "supervisor",
  userId: "u1",
  env: {
    ENABLE_GPT6_ASTRA: "1",
    ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
  },
});
expect(on.upgraded === true, "flag 开时 supervisor 升级");
expect(on.model === OPENAI_GPT6_ASTRA, "升级目标为 gpt-6-astra");
expect(on.fallbackModel === OPENAI_BUILTIN.chat, "fallback 仍是 chat");
expect(on.reasoningEffort === "high", "supervisor reasoning = high 而非 max");

const classifier = resolveModelPolicy({
  role: "classifier",
  userId: "u1",
  env: {
    ENABLE_GPT6_ASTRA: "1",
    ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
  },
});
expect(classifier.upgraded === false, "classifier 默认不升级");
expect(classifier.model !== OPENAI_GPT6_ASTRA, "低成本角色保持原模型");

const envOverride = resolveModelPolicy({
  role: "planner",
  userId: "u1",
  env: {
    ENABLE_GPT6_ASTRA: "1",
    ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
    OPENAI_MODEL_PLANNER: OPENAI_BUILTIN.chat,
  },
});
expect(
  envOverride.model === OPENAI_BUILTIN.chat,
  "角色 env 可把 GPT-6 回退到便宜模型",
);

const leaked = resolveModelPolicy({
  role: "supervisor",
  env: { OPENAI_MODEL_SUPERVISOR: OPENAI_GPT6_ASTRA },
  userId: "u1",
});
expect(
  leaked.model === OPENAI_BUILTIN.reasoning,
  "flag 关闭时即使 env 写 gpt-6 也被 kill switch 挡回",
);

const researcher = resolveModelPolicy({
  role: "researcher",
  userId: "u1",
  env: {
    ENABLE_GPT6_ASTRA: "1",
    ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
  },
});
expect(researcher.upgraded === true, "Phase 1 researcher 升级");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-resolve: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
