/**
 * 客户跟进场景契约（解析 + 双 PA 批次一致性）
 * 运行：npx tsx src/lib/assistant/__tests__/customer-followup-scenario.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import {
  detectFollowupActionKind,
  detectOtherAssignee,
  extractCustomerNameHint,
  parseFollowupRequest,
} from "@/lib/assistant/scenarios/entity-parse";
import { commitCustomerFollowup } from "@/lib/assistant/scenarios/customer-followup";
import { friendlyScenarioError } from "@/lib/assistant/scenarios/types";
import type { CreateDraftInput } from "@/lib/pending-actions/drafts";
import { createDraftBatch } from "@/lib/pending-actions/drafts";
import { computePayloadHash } from "@/lib/capabilities/approvals/integrity";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("customer-followup-scenario");

  ok(
    "意图：周五提醒我跟进 ABC → customer_followup_task",
    routeAssistantIntent("周五提醒我跟进 ABC").intent ===
      "customer_followup_task",
  );

  ok(
    "把 ABC 商机的下次跟进改到周五 → customerName=ABC",
    parseFollowupRequest("把 ABC 商机的下次跟进改到周五").customerName ===
      "ABC",
  );

  ok(
    "更新 ABC 客户的跟进日期 → customerName=ABC",
    extractCustomerNameHint("更新 ABC 客户的跟进日期") === "ABC",
  );

  ok(
    "将 ABC 的 follow-up date 改到周五 → customerName=ABC",
    extractCustomerNameHint("将 ABC 的 follow-up date 改到周五") === "ABC",
  );

  ok(
    "不得把时间短语识别成客户名",
    extractCustomerNameHint("把下次跟进改到周五") === null &&
      extractCustomerNameHint("更新这个客户的跟进") === null,
  );

  ok(
    "日历动作：提醒我跟进 → calendar",
    detectFollowupActionKind("周五提醒我跟进 ABC") === "calendar",
  );

  ok(
    "销售跟进：把下次跟进改到周五 → sales_followup",
    detectFollowupActionKind("把 ABC 商机的下次跟进改到周五") ===
      "sales_followup",
  );

  ok(
    "双动作：同时要求跟进更新与提醒 → both",
    detectFollowupActionKind("把下次跟进改到周五，同时提醒我") === "both",
  );

  ok(
    "提醒其他成员 → 追问，不假装分配",
    (() => {
      const name = detectOtherAssignee("提醒 Alex 明天下午联系 ABC");
      return (
        name === "Alex" &&
        parseFollowupRequest("提醒 Alex 明天下午联系 ABC").otherAssignee ===
          "Alex"
      );
    })(),
  );

  ok(
    "模糊时间「过几天」→ needsTimeClarification",
    parseFollowupRequest("过几天提醒我跟进 ABC").needsTimeClarification ===
      true,
  );

  ok(
    "明确周五 → 产出 ISO 时间且 customerName=ABC",
    (() => {
      const p = parseFollowupRequest("周五提醒我跟进 ABC");
      return (
        p.customerName === "ABC" &&
        !!p.startIso &&
        !!p.endIso &&
        p.startIso.includes("T")
      );
    })(),
  );

  {
    const payloads = [
      {
        opportunityId: "opp-1",
        nextFollowupAt: "2026-07-25T13:00:00.000Z",
        metadata: { orgId: "sunny" },
      },
      {
        title: "跟进 ABC",
        startTime: "2026-07-25T13:00:00.000Z",
        endTime: "2026-07-25T13:30:00.000Z",
        metadata: { orgId: "sunny" },
      },
    ];
    const inputs: CreateDraftInput[] = [
      {
        type: "sales.update_followup",
        title: "更新跟进",
        preview: "sales",
        payload: payloads[0],
        userId: "u1",
        orgId: "sunny",
        threadId: "t1",
        messageId: "am-1",
        agentRunId: "run-1",
      },
      {
        type: "calendar.create_event",
        title: "日历提醒",
        preview: "cal",
        payload: payloads[1],
        userId: "u1",
        orgId: "sunny",
        threadId: "t1",
        messageId: "am-1",
        agentRunId: "run-1",
      },
    ];
    let markCount = 0;
    const result = await createDraftBatch(inputs, {
      createAllInTransaction: async (rows) =>
        rows.map((r, i) => ({
          actionId: `pa-${i + 1}`,
          type: r.type,
          title: r.title,
          preview: r.preview,
          payloadHash: computePayloadHash(r.payload),
          agentRunId: r.agentRunId ?? null,
        })),
      auditCreated: async () => {},
      markAwaitingApproval: async () => {
        markCount += 1;
      },
      compensate: async () => 0,
    });
    ok(
      "双 PA 正常批次：两张独立、同 run、不同 payloadHash、只 mark 一次",
      result.success === true &&
        result.actions.length === 2 &&
        result.actions[0].type === "sales.update_followup" &&
        result.actions[1].type === "calendar.create_event" &&
        result.actions.every((a) => a.agentRunId === "run-1") &&
        new Set(result.actions.map((a) => a.payloadHash)).size === 2 &&
        markCount === 1,
    );
  }

  {
    const pendingAlive = new Set<string>();
    const compensated: string[] = [];
    const inputs: CreateDraftInput[] = [
      {
        type: "sales.update_followup",
        title: "A",
        preview: "a",
        payload: { a: 1 },
        userId: "u1",
        orgId: "sunny",
        messageId: "am-1",
        agentRunId: "run-1",
      },
      {
        type: "calendar.create_event",
        title: "B",
        preview: "b",
        payload: { b: 2 },
        userId: "u1",
        orgId: "sunny",
        messageId: "am-1",
        agentRunId: "run-1",
      },
    ];
    const result = await createDraftBatch(inputs, {
      __failAfterCreateIndex: 1,
      createAllInTransaction: async (rows) => {
        return rows.map((r) => {
          const id = `created-${r.type}-${pendingAlive.size}`;
          pendingAlive.add(id);
          return {
            actionId: id,
            type: r.type,
            title: r.title,
            preview: r.preview,
            payloadHash: computePayloadHash(r.payload),
            agentRunId: r.agentRunId ?? null,
          };
        });
      },
      auditCreated: async () => {},
      markAwaitingApproval: async () => {},
      compensate: async (ids) => {
        for (const id of ids) {
          compensated.push(id);
          pendingAlive.delete(id);
        }
        return ids.length;
      },
    });

    const commitResult = await commitCustomerFollowup(
      {
        orgId: "sunny",
        userId: "u1",
        role: "sales",
        threadId: "t1",
        userMessageId: "um-1",
        assistantMessageId: "am-1",
        agentRunId: "run-1",
        message: "把下次跟进改到周五，同时提醒我",
      },
      {
        kind: "ready",
        assistantLines: ["preview"],
        plans: [
          {
            type: "sales.update_followup",
            title: "A",
            preview: "a",
            payload: { a: 1 },
          },
          {
            type: "calendar.create_event",
            title: "B",
            preview: "b",
            payload: { b: 2 },
          },
        ],
        customerName: "ABC",
        parsed: parseFollowupRequest("把下次跟进改到周五，同时提醒我"),
      },
      {
        __failAfterCreateIndex: 1,
        createAllInTransaction: async (rows) =>
          rows.map((r) => {
            const id = `c-${r.type}-${pendingAlive.size}`;
            pendingAlive.add(id);
            return {
              actionId: id,
              type: r.type,
              title: r.title,
              preview: r.preview,
              payloadHash: "h",
              agentRunId: "run-1",
            };
          }),
        auditCreated: async () => {},
        markAwaitingApproval: async () => {},
        compensate: async (ids) => {
          for (const id of ids) pendingAlive.delete(id);
          return ids.length;
        },
      },
    );

    ok(
      "双 PA 第二张失败：actionable pending=0，Run 可 failed，无孤立确认卡",
      result.success === false &&
        result.errorCode === "DRAFT_CREATION_FAILED" &&
        compensated.length >= 1 &&
        pendingAlive.size === 0 &&
        commitResult.kind === "failed" &&
        commitResult.errorCode === "DRAFT_CREATION_FAILED",
    );
  }

  ok(
    "跨 org / 未找到客户错误码友好且无敏感细节",
    (() => {
      const msg = friendlyScenarioError("CUSTOMER_NOT_FOUND");
      return (
        msg.includes("客户") &&
        !msg.includes("orgId") &&
        !msg.includes("SELECT")
      );
    })(),
  );

  console.log(`结果: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
