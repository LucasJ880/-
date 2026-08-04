import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSalesActionEffectiveness } from "../action-effectiveness";

test("行动效果区分人工完成、自动收口并按商机去重辅助签约", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const result = summarizeSalesActionEffectiveness([
    { id: "a1", signalKey: "viewed_not_signed", status: "completed", createdAt: "2026-08-01T08:00:00Z", startedAt: "2026-08-01T10:00:00Z", dueAt: null, assignedToId: "u1", assignedToName: "Amy", opportunityId: "o1", opportunityStage: "signed", opportunityWonAt: "2026-08-03T08:00:00Z" },
    { id: "a2", signalKey: "quote_pending", status: "dismissed", createdAt: "2026-08-01T08:00:00Z", startedAt: "2026-08-01T14:00:00Z", dueAt: null, assignedToId: "u1", assignedToName: "Amy", opportunityId: "o1", opportunityStage: "signed", opportunityWonAt: "2026-08-03T08:00:00Z" },
    { id: "a3", signalKey: "stale_opportunity", status: "auto_resolved", createdAt: "2026-08-02T08:00:00Z", startedAt: null, dueAt: null, assignedToId: "u2", assignedToName: "Ben", opportunityId: "o2", opportunityStage: "negotiation", opportunityWonAt: null },
    { id: "a4", signalKey: "overdue_followup", status: "open", createdAt: "2026-08-03T08:00:00Z", startedAt: null, dueAt: "2026-08-04T08:00:00Z", assignedToId: "u2", assignedToName: "Ben", opportunityId: "o3", opportunityStage: "quoted", opportunityWonAt: null },
  ], now);
  assert.deepEqual(result.overview, {
    created: 4,
    active: 1,
    overdue: 1,
    completed: 1,
    autoResolved: 1,
    completionRate: 50,
    medianResponseHours: 4,
    assistedWins: 1,
  });
  assert.equal(result.signals.find((row) => row.key === "viewed_not_signed")?.assistedWins, 1);
  assert.equal(result.team.find((row) => row.name === "Amy")?.medianResponseHours, 4);
});
