/**
 * Autopilot service / data layer：未授权不得读
 * 运行：npx tsx src/lib/autopilot/__tests__/service-access.test.ts
 */

import { AutopilotAccessError } from "../access";
import { getAutopilotOverview, getAutopilotRun, getAutopilotTelemetryHealth, listAutopilotRuns } from "../service";

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

async function main() {
  console.log("autopilot service access");

  const prevEnabled = process.env.AUTOPILOT_ENABLED;
  const prevOwners = process.env.AUTOPILOT_OWNER_USER_IDS;
  process.env.AUTOPILOT_ENABLED = "1";
  process.env.AUTOPILOT_OWNER_USER_IDS = "lucas_canonical_id";

  try {
    const admin = { id: "admin_user", role: "admin" };
    const orgId = "org_1";

    async function expectDenied(fn: () => Promise<unknown>, name: string) {
      try {
        await fn();
        ok(false, name);
      } catch (err) {
        ok(err instanceof AutopilotAccessError, name);
      }
    }

    await expectDenied(
      () => getAutopilotOverview(admin, orgId),
      "admin 读 overview → denied（不碰数据）",
    );
    await expectDenied(
      () => listAutopilotRuns(admin, orgId),
      "admin 读 runs → denied",
    );
    await expectDenied(
      () => getAutopilotRun(admin, orgId, "run_1"),
      "admin 读 run detail → denied",
    );
    await expectDenied(
      () => getAutopilotTelemetryHealth(admin, orgId),
      "admin 读 telemetry health → denied",
    );
  } finally {
    if (prevEnabled === undefined) delete process.env.AUTOPILOT_ENABLED;
    else process.env.AUTOPILOT_ENABLED = prevEnabled;
    if (prevOwners === undefined) delete process.env.AUTOPILOT_OWNER_USER_IDS;
    else process.env.AUTOPILOT_OWNER_USER_IDS = prevOwners;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
