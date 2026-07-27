import assert from "node:assert/strict";
import {
  isScheduleCalendarEventVisible,
  isScheduleFollowupVisible,
} from "../active-view-filter";
import { reminderReadMarkerKey } from "@/lib/reminders/canonical-key";

const actionable = new Set(["proj-active"]);

// 3. read marker 不进入 /api/schedule
assert.equal(
  isScheduleFollowupVisible(
    {
      type: "deadline",
      status: "read",
      sourceKey: reminderReadMarkerKey("u1", "deadline:T1"),
    },
    actionable
  ),
  false
);

// 4. status=read 的 followup 不进入时间轴
assert.equal(
  isScheduleFollowupVisible(
    {
      type: "followup",
      status: "read",
      sourceKey: "followup:x",
    },
    actionable
  ),
  false
);

// pending followup + actionable 任务 → 显示
assert.equal(
  isScheduleFollowupVisible(
    {
      type: "followup",
      status: "pending",
      sourceKey: "followup:ok",
      task: { status: "todo", projectId: "proj-active" },
    },
    actionable
  ),
  true
);

// 无项目个人 followup → 保留
assert.equal(
  isScheduleFollowupVisible(
    {
      type: "followup",
      status: "pending",
      sourceKey: "followup:personal",
      task: null,
    },
    actionable
  ),
  true
);

// 5. completed 项目的 CalendarEvent 不进入 schedule
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      projectId: "proj-done",
      project: { status: "completed", abandonedAt: null },
    },
    actionable
  ),
  false
);

// 6. abandoned 项目的 CalendarEvent 不进入 schedule
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      projectId: "proj-abandoned",
      project: { status: "abandoned", abandonedAt: new Date() },
    },
    actionable
  ),
  false
);
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      projectId: "proj-abandoned-2",
      project: { status: "active", abandonedAt: new Date() },
    },
    actionable
  ),
  false
);

// 7. done/cancelled 任务关联事件不进入 schedule
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      taskId: "t1",
      task: { status: "done", projectId: "proj-active" },
    },
    actionable
  ),
  false
);
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      taskId: "t2",
      task: { status: "cancelled", projectId: "proj-active" },
    },
    actionable
  ),
  false
);

// 任务属非 actionable 项目 → 隐藏
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      taskId: "t3",
      task: { status: "todo", projectId: "proj-archived" },
    },
    actionable
  ),
  false
);

// 直接关联 active 项目 → 保留
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      projectId: "proj-active",
      project: { status: "active", abandonedAt: null },
    },
    actionable
  ),
  true
);

// 8. 无项目的个人/Google 日程继续正常显示
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "google",
      projectId: null,
      taskId: null,
      task: null,
      project: null,
    },
    actionable
  ),
  true
);
assert.equal(
  isScheduleCalendarEventVisible(
    {
      source: "qingyan",
      projectId: null,
      taskId: null,
      task: null,
      project: null,
    },
    actionable
  ),
  true
);

console.log("active-view-filter.test.ts OK");
