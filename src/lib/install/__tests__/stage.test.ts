/**
 * INSTALL-2d：安装阶段推导与文案；"待收尾款"与 2b 会计列表同一规则（任务书 §12 Q11）
 * 运行：npx tsx src/lib/install/__tests__/stage.test.ts
 */
import { isAwaitingBalance } from "../balance";
import { INSTALL_STAGES, installStage, salesStageText, STAGE_LABEL, type StageInput } from "../stage";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const base: StageInput = { orderStatus: "scheduled", balanceConfirmed: false, closedOut: false, openRepair: null };

console.log("INSTALL-2d 安装阶段查表");
ok(installStage(base) === "scheduled", "已排期、无维修单 → scheduled");
ok(installStage({ ...base, openRepair: { needsFactory: true } }) === "repair_open", "已排期、维修单含需工厂行 → repair_open");
ok(installStage({ ...base, openRepair: { needsFactory: false } }) === "repair_ready_to_schedule", "已排期、维修单只有客户原因 → repair_ready_to_schedule");
ok(installStage({ ...base, orderStatus: "installed" }) === "awaiting_balance", "已安装、未确认 → awaiting_balance");
ok(installStage({ ...base, orderStatus: "completed", balanceConfirmed: true, closedOut: true }) === "closed", "有尾款确认 → closed");
ok(installStage({ ...base, orderStatus: "completed", closedOut: true }) === "awaiting_balance", "已完工、当前预约有完成收口记录、未确认 → awaiting_balance");
ok(installStage({ ...base, orderStatus: "completed", closedOut: false }) === "closed", "已完工、无收口记录（历史手工完工）→ closed");
ok(installStage({ ...base, orderStatus: "cancelled", openRepair: { needsFactory: true } }) === "cancelled", "取消优先于未关闭维修单");
for (const s of ["draft", "confirmed", "in_production", "ready"]) {
  ok(installStage({ ...base, orderStatus: s }) === "not_scheduled", `${s} → not_scheduled`);
}
ok(INSTALL_STAGES.every((s) => !!STAGE_LABEL[s]), "每个阶段都有中文名");

console.log("INSTALL-2d 待收尾款与 2b 列表同一规则");
{
  let same = true;
  const diffs: unknown[] = [];
  for (const orderStatus of ["scheduled", "installed", "completed", "cancelled"]) {
    for (const confirmed of [false, true]) {
      for (const closedOut of [false, true]) {
        const stageSays = installStage({ orderStatus, balanceConfirmed: confirmed, closedOut, openRepair: null }) === "awaiting_balance";
        const listSays = isAwaitingBalance(
          { status: orderStatus, appointmentId: "a1" },
          { confirmed, closedOutAppointmentIds: new Set(closedOut ? ["a1"] : []) },
        );
        if (orderStatus !== "cancelled" && stageSays !== listSays) {
          same = false;
          diffs.push({ orderStatus, confirmed, closedOut, stageSays, listSays });
        }
      }
    }
  }
  ok(same, "installStage 的 awaiting_balance ⇔ isAwaitingBalance（全组合）", diffs);
}

console.log("INSTALL-2d 销售文案");
ok(salesStageText("repair_open", { targetDate: "2026-11-04" }) === "返修中，目标 2026-11-04", "返修中，目标 2026-11-04");
ok(salesStageText("repair_ready_to_schedule", { targetDate: "2026-11-04" }) === "返修中，目标 2026-11-04", "返修待排期销售文案同返修中");
ok(salesStageText("scheduled", { installDate: "2026-10-30" }) === "已排 2026-10-30 安装", "已排 <日期> 安装");
ok(salesStageText("awaiting_balance") === "已装完，收尾款", "已装完，收尾款");
ok(salesStageText("closed", { balanceConfirmed: true, warranty: "sent" }) === "已结清 · 质保邮件已发送", "已结清 + 质保已发送");
ok(salesStageText("closed", { balanceConfirmed: true, warranty: "pending_approval" }) === "已结清 · 质保邮件待批准", "已结清 + 质保待批准");
ok(salesStageText("closed", { balanceConfirmed: true }) === "已结清 · 质保邮件未发出", "已结清 + 质保未发出");
ok(salesStageText("closed", { balanceConfirmed: false }) === "已完工", "历史手工完工 → 已完工");
ok(salesStageText("not_scheduled") === "未排安装" && salesStageText("cancelled") === "已取消", "未排安装 / 已取消");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
