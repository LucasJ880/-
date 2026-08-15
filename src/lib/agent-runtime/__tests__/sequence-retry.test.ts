/**
 * AgentRunEvent sequence collision: retry the WHOLE transaction.
 * 运行：npx tsx src/lib/agent-runtime/__tests__/sequence-retry.test.ts
 */

import {
  AGENT_RUN_EVENT_SEQUENCE_MAX_RETRIES,
  isAgentRunEventSequenceConflict,
  withAgentRunEventSequenceRetry,
} from "../run";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function p2002(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

async function main() {
  console.log("agent-run sequence retry");

  ok(isAgentRunEventSequenceConflict(p2002()), "P2002 is sequence conflict");
  ok(!isAgentRunEventSequenceConflict(new Error("other")), "non-P2002 is not");
  ok(AGENT_RUN_EVENT_SEQUENCE_MAX_RETRIES === 8, "bounded retries = 8");

  let calls = 0;
  const result = await withAgentRunEventSequenceRetry(async () => {
    calls += 1;
    if (calls < 3) throw p2002();
    return "ok";
  });
  ok(result === "ok" && calls === 3, "retries WHOLE work() on P2002 then succeeds");

  let bounded = 0;
  try {
    await withAgentRunEventSequenceRetry(async () => {
      bounded += 1;
      throw p2002();
    });
    ok(false, "exhausted retries should throw");
  } catch (error) {
    ok(isAgentRunEventSequenceConflict(error), "exhausted retries rethrow P2002");
    ok(
      bounded === AGENT_RUN_EVENT_SEQUENCE_MAX_RETRIES + 1,
      "does not retry unboundedly",
    );
  }

  let otherCalls = 0;
  try {
    await withAgentRunEventSequenceRetry(async () => {
      otherCalls += 1;
      throw new Error("not unique");
    });
    ok(false, "non-P2002 should throw immediately");
  } catch (error) {
    ok(
      error instanceof Error && error.message === "not unique" && otherCalls === 1,
      "non-P2002 不重试（避免已 abort TX 内重试）",
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
