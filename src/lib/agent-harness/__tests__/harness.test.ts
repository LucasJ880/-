import assert from "node:assert/strict";
import { runWithHarness, intersectToolAllowlists } from "../adapter";
import type { HarnessInput } from "../types";
import type { ScopeContext } from "@/lib/scope";
import type { AgentRunResult } from "@/lib/agent-core/types";
import { AgentTimeoutError } from "@/lib/agent-core/engine";

function baseScope(over?: Partial<ScopeContext>): ScopeContext {
  return {
    orgId: "orgA",
    principalUserId: "userA",
    principalRole: "org_member",
    scopeType: "ORG",
    scopeId: "orgA",
    correlationId: "tr_test_corr_1",
    hasMembership: true,
    isPlatformAdmin: false,
    ...over,
  };
}

function baseInput(over?: Partial<HarnessInput>): HarnessInput {
  return {
    scope: baseScope(),
    messages: [{ role: "user", content: "hello" }],
    systemPrompt: "you are helpful",
    allowedTools: ["project_list"],
    approvalPolicy: { maxDirectRisk: "l0_read" },
    model: { provider: "openai", mode: "fast", model: "gpt-test" },
    ...over,
  };
}

async function main() {
  // allowlist intersection
  assert.deepEqual(
    intersectToolAllowlists(["a", "b", "c"], ["b", "c", "d"], ["c", "b"]).sort(),
    ["b", "c"],
  );
  assert.deepEqual(intersectToolAllowlists(["a", "b"], ["c"]), []);

  // happy path via injected runAgent
  {
    const fake: AgentRunResult = {
      content: "ok",
      model: "gpt-test",
      rounds: 1,
      toolCalls: [
        {
          name: "project_list",
          args: { orgId: "orgA" },
          result: { success: true, data: { items: [] } },
        },
      ],
    };
    const out = await runWithHarness(baseInput(), {
      audit: false,
      runAgentFn: async (opts) => {
        assert.equal(opts.orgId, "orgA");
        assert.equal(opts.userId, "userA");
        assert.deepEqual(opts.tools, ["project_list"]);
        assert.equal(opts.maxRisk, "l0_read");
        return fake;
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.correlationId, "tr_test_corr_1");
    assert.equal(out.provider, "openai");
    assert.equal(out.finishReason, "completed");
    assert.equal(out.structuredResult.content, "ok");
  }

  // tool override attempt recorded via hook (does not throw harness)
  {
    const out = await runWithHarness(baseInput(), {
      audit: false,
      runAgentFn: async (opts) => {
        await opts.hooks?.onToolCall?.({
          name: "evil",
          args: { orgId: "orgB" },
          result: { success: false, data: null, error: "x" },
          durationMs: 1,
          round: 1,
        });
        return {
          content: "done",
          model: "gpt-test",
          rounds: 1,
          toolCalls: [],
        };
      },
    });
    assert.equal(out.ok, true);
    assert.ok(out.deniedTools.some((d) => d.name === "evil"));
  }

  // pending action proposal extraction
  {
    const out = await runWithHarness(baseInput(), {
      audit: false,
      runAgentFn: async () => ({
        content: "propose",
        model: "gpt-test",
        rounds: 1,
        toolCalls: [
          {
            name: "suggest",
            args: {},
            result: {
              success: true,
              data: {
                pendingActionProposal: {
                  type: "project.add_note",
                  title: "添加备注",
                  preview: "建议添加进度备注",
                  payload: { text: "x" },
                  idempotencyKey: "k1",
                },
              },
            },
          },
        ],
      }),
    });
    assert.equal(out.pendingActionProposals.length, 1);
    assert.equal(out.pendingActionProposals[0].type, "project.add_note");
  }

  // timeout classification
  {
    const out = await runWithHarness(baseInput(), {
      audit: false,
      runAgentFn: async () => {
        throw new AgentTimeoutError("timeout");
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.errorClass, "timeout");
    assert.equal(out.finishReason, "timeout");
  }

  // provider error classification
  {
    const out = await runWithHarness(baseInput(), {
      audit: false,
      runAgentFn: async () => {
        throw new Error("OpenAI API key missing");
      },
    });
    assert.equal(out.errorClass, "provider_error");
  }

  // empty allowlist → tools: []
  {
    let seen: string[] | undefined;
    await runWithHarness(baseInput({ allowedTools: [] }), {
      audit: false,
      runAgentFn: async (opts) => {
        seen = opts.tools;
        return { content: "", model: "m", rounds: 0, toolCalls: [] };
      },
    });
    assert.deepEqual(seen, []);
  }

  console.log("harness: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
