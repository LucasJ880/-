import { strict as assert } from "node:assert";
import { getLocalTimeParts, isLocalScheduleHour } from "../local-time";

const summer = getLocalTimeParts(new Date("2026-07-15T11:00:00.000Z"), "America/Toronto");
assert.deepEqual(summer, { date: "2026-07-15", hour: 7, minute: 0 });

const winter = getLocalTimeParts(new Date("2026-01-15T12:00:00.000Z"), "America/Toronto");
assert.deepEqual(winter, { date: "2026-01-15", hour: 7, minute: 0 });

assert.equal(
  isLocalScheduleHour(new Date("2026-07-15T13:00:00.000Z"), "America/Toronto", [9, 14]),
  true,
);
assert.equal(
  isLocalScheduleHour(new Date("2026-07-15T12:00:00.000Z"), "America/Toronto", [9, 14]),
  false,
);

console.log("automation local-time: 4/4 passed");
