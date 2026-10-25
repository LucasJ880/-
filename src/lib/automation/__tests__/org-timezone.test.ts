import { strict as assert } from "node:assert";
import { isValidTimeZone } from "../local-time";
import { AUTOMATION_TIMEZONE, orgsAtLocalHour, resolveOrgTimezone } from "../registry";

assert.equal(isValidTimeZone("Asia/Shanghai"), true);
assert.equal(isValidTimeZone("Mars/Olympus"), false);
assert.equal(isValidTimeZone(""), false);

assert.equal(resolveOrgTimezone({ timezone: "Asia/Shanghai" }), "Asia/Shanghai");
assert.equal(resolveOrgTimezone({ timezone: "  Asia/Shanghai " }), "Asia/Shanghai");
assert.equal(resolveOrgTimezone({ timezone: "Mars/Olympus" }), AUTOMATION_TIMEZONE);
assert.equal(resolveOrgTimezone({ timezone: 8 }), AUTOMATION_TIMEZONE);
assert.equal(resolveOrgTimezone({ tenderProfile: {} }), AUTOMATION_TIMEZONE);
assert.equal(resolveOrgTimezone(null), AUTOMATION_TIMEZONE);
assert.equal(resolveOrgTimezone(["Asia/Shanghai"]), AUTOMATION_TIMEZONE);

const orgs = [
  { id: "mengxin", settingsJson: { timezone: "Asia/Shanghai" } },
  { id: "sunny", settingsJson: null },
];

// 2026-10-21 23:00 UTC = 上海 10-22 07:00，多伦多（EDT）10-21 19:00
assert.deepEqual(
  orgsAtLocalHour(orgs, new Date("2026-10-21T23:00:00.000Z"), [7]).map((o) => [o.id, o.timezone]),
  [["mengxin", "Asia/Shanghai"]],
);
// 2026-10-22 11:00 UTC = 多伦多 07:00，上海 19:00
assert.deepEqual(
  orgsAtLocalHour(orgs, new Date("2026-10-22T11:00:00.000Z"), [7]).map((o) => [o.id, o.timezone]),
  [["sunny", AUTOMATION_TIMEZONE]],
);
// 跟进 09:00 / 14:00：上海 14:00 = 06:00 UTC
assert.deepEqual(
  orgsAtLocalHour(orgs, new Date("2026-10-22T06:00:00.000Z"), [9, 14]).map((o) => o.id),
  ["mengxin"],
);
// 一天 24 次唤醒里，每个组织在 07 点各命中一次
for (const org of orgs) {
  let hits = 0;
  for (let h = 0; h < 24; h++) {
    const now = new Date(Date.UTC(2026, 9, 22, h, 30));
    if (orgsAtLocalHour([org], now, [7]).length === 1) hits++;
  }
  assert.equal(hits, 1, `${org.id} 每天命中一次`);
}

console.log("automation org-timezone: 15/15 passed");
