import { strict as assert } from "node:assert";
import "./index";
import {
  mentionsCalendar,
  needsTools,
  requestsCalendarWrite,
  toolLabel,
} from "../streaming";
import { registry } from "../tool-registry";

const requests = [
  "帮我把明天下午三点的客户会议加到日历",
  "创建一个周五上午的日程",
  "remind me with a calendar event tomorrow",
  "约个会，明天上午十点",
  "安排会议到后天下午",
  "帮我创建日历：周五量房",
];
for (const request of requests) {
  assert.equal(needsTools(request), true, `应进入工具模式：${request}`);
  assert.equal(requestsCalendarWrite(request), true, `应强制进入日历工具链：${request}`);
}

for (const role of ["admin", "manager", "sales", "trade", "user"] as const) {
  const names = registry.list({
    domains: ["secretary"],
    role,
    maxRisk: "l2_soft",
  }).map((tool) => tool.name);
  assert.equal(
    names.includes("calendar_create_event_draft"),
    true,
    `${role} 应可创建个人日历草稿`,
  );
}

const readOnlyNames = registry.list({
  domains: ["secretary"],
  role: "user",
  maxRisk: "l0_read",
}).map((tool) => tool.name);
assert.equal(readOnlyNames.includes("calendar_create_event_draft"), false);
assert.equal(toolLabel("calendar_create_event_draft"), "准备日历事件");

assert.equal(requestsCalendarWrite("帮我看看今天有什么会议"), false);
assert.equal(mentionsCalendar("帮我看看今天有什么会议"), true);

console.log("calendar tool access: ok");
