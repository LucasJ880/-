/**
 * 协作通知 COLLAB-2：通知类型与偏好
 * - 五个新类型进注册表、名称表与两处图标表
 * - 类型开关：清单记下保存时已登记的类型（knownTypes），每次写入物化生效清单
 * - 邮件偏好的生效值：明确选过按选择，否则为开
 * - 设置页文案
 * 运行：npx tsx src/lib/notifications/__tests__/collab-preferences.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_TYPE_KEYS,
  NOTIFICATION_TYPE_LABELS,
  notificationTypeLabel,
} from "../constants";
import {
  TYPE_INTRODUCED_AT,
  effectiveEnabledTypes,
  evaluateDeliveryGate,
  isTypeEnabledForUser,
  knownTypesFromMetadata,
  parsePreferenceMetadata,
} from "../delivery-gate";
import {
  buildPreferenceUpdate,
  effectiveEmailEnabled,
  initialPreferenceData,
  rowToDTO,
  typePreferenceWriteFields,
} from "../preferences";

let passed = 0;
let failed = 0;
function ok(cond: unknown, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const COLLAB_TYPES = ["mention", "task_assigned", "task_status", "task_comment", "order_stage"] as const;
const REGISTRY: string[] = [...NOTIFICATION_TYPE_KEYS];

type Row = {
  id: string;
  userId: string;
  orgId: string | null;
  enableInAppNotifications: boolean;
  onlyHighPriority: boolean;
  onlyMyItems: boolean;
  includeWatchedProjects: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
  enabledTypesJson: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function row(over: Partial<Row>): Row {
  return {
    id: "p1",
    userId: "u1",
    orgId: null,
    enableInAppNotifications: true,
    onlyHighPriority: false,
    onlyMyItems: false,
    includeWatchedProjects: true,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    emailEnabled: false,
    pushEnabled: false,
    enabledTypesJson: null,
    metadata: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

/** 模拟一次写入：把 update 的 data 合进行，updatedAt 刷新为 now */
function applyWrite(before: Row, data: Record<string, unknown>, now: Date): Row {
  return { ...before, ...(data as Partial<Row>), updatedAt: now };
}

/** 门禁：该行对某类型是否投递（只看类型开关这一步） */
function typeOn(r: Row, type: string): boolean {
  return evaluateDeliveryGate({
    type,
    priority: "medium",
    pref: {
      enableInAppNotifications: true,
      onlyHighPriority: false,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      enabledTypes: new Set(JSON.parse(r.enabledTypesJson ?? "[]") as string[]),
    },
    hasCustomList: !!r.enabledTypesJson,
    listUpdatedAt: r.updatedAt,
    knownTypes: knownTypesFromMetadata(parsePreferenceMetadata(r.metadata)),
  });
}

const SEPT = new Date("2026-09-15T00:00:00Z");
const OCT = new Date("2026-10-15T00:00:00Z");
const AFTER_DEPLOY = new Date("2026-11-10T12:00:00Z");
// 2026-09 保存的清单：没有 install_* 与五个新类型，也主动关了 followup
const SEPT_LIST = REGISTRY.filter((t) => !t.startsWith("install_") && !(COLLAB_TYPES as readonly string[]).includes(t) && t !== "followup");

console.log("注册表与名称");
for (const t of COLLAB_TYPES) ok(REGISTRY.includes(t), `注册表含 ${t}`);
ok(NOTIFICATION_TYPE_LABELS.mention === "@提及", "mention → @提及");
ok(NOTIFICATION_TYPE_LABELS.task_assigned === "任务指派", "task_assigned → 任务指派");
ok(NOTIFICATION_TYPE_LABELS.task_status === "任务状态变化", "task_status → 任务状态变化");
ok(NOTIFICATION_TYPE_LABELS.task_comment === "任务新评论", "task_comment → 任务新评论");
ok(NOTIFICATION_TYPE_LABELS.order_stage === "工艺单阶段变化", "order_stage → 工艺单阶段变化");
ok(NOTIFICATION_TYPE_LABELS.task_due === "任务截止与逾期", "既有名称随表迁移：task_due");
ok(notificationTypeLabel("approval") === "其他通知", "未登记类型的名称回落为「其他通知」");
for (const t of COLLAB_TYPES) ok(!!TYPE_INTRODUCED_AT[t], `${t} 登记了引入时间`);

const toggleSrc = read("src/components/notification/notification-type-toggle-list.tsx");
ok(/NOTIFICATION_TYPE_LABELS/.test(toggleSrc) && !/const LABELS: Record<string, string> = \{/.test(toggleSrc), "设置页类型开关用共享名称表");
const itemSrc = read("src/components/notification/notification-list-item.tsx");
const headerSrc = read("src/components/header.tsx");
const itemIcons = itemSrc.slice(itemSrc.indexOf("const TYPE_ICONS"), itemSrc.indexOf("};", itemSrc.indexOf("const TYPE_ICONS")));
const headerIcons = headerSrc.slice(headerSrc.indexOf("const NTYPE_ICONS"), headerSrc.indexOf("};", headerSrc.indexOf("const NTYPE_ICONS")));
for (const t of COLLAB_TYPES) {
  ok(new RegExp(`\\b${t}:`).test(itemIcons), `通知页图标表含 ${t}`);
  ok(new RegExp(`\\b${t}:`).test(headerIcons), `铃铛图标表含 ${t}`);
}

console.log("类型开关判定");
const sept = row({ enabledTypesJson: JSON.stringify(SEPT_LIST), updatedAt: SEPT });
ok(typeOn(sept, "mention"), "上线前保存的清单（无 knownTypes）：mention 视为开启");
ok(COLLAB_TYPES.every((t) => typeOn(sept, t)), "上线前保存的清单：五个新类型都视为开启");
ok(typeOn(sept, "install_completed"), "2026-09 的清单：install_completed（10-28 引入）按时间规则视为开启");
ok(!typeOn(sept, "followup"), "清单里没有、也没有引入时间的 followup：仍是关闭");
const oct30 = row({ enabledTypesJson: JSON.stringify(SEPT_LIST), updatedAt: new Date("2026-10-30T00:00:00Z") });
ok(!typeOn(oct30, "install_completed"), "无 knownTypes、10-30 保存且不含 install_completed：按时间规则关闭（既有行为）");
ok(typeOn(oct30, "task_comment"), "无 knownTypes 的清单不论何时保存：新类型都视为开启");

const known = row({
  enabledTypesJson: JSON.stringify(REGISTRY.filter((t) => t !== "task_comment")),
  metadata: JSON.stringify({ knownTypes: REGISTRY }),
  updatedAt: AFTER_DEPLOY,
});
ok(!typeOn(known, "task_comment"), "有 knownTypes：保存时已登记、但不在清单里 → 关闭（用户自己关的）");
ok(typeOn(known, "mention"), "有 knownTypes：在清单里 → 开");
const knownOld = row({
  enabledTypesJson: JSON.stringify(SEPT_LIST),
  metadata: JSON.stringify({ knownTypes: SEPT_LIST.concat(["followup"]) }),
  updatedAt: AFTER_DEPLOY,
});
ok(typeOn(knownOld, "order_stage"), "有 knownTypes：保存之后才登记的类型 → 开");
ok(!typeOn(knownOld, "followup"), "有 knownTypes：保存时已登记、不在清单 → 关");
ok(
  !isTypeEnabledForUser({ type: "approval", enabledTypes: new Set(["task_due"]), hasCustomList: true, listUpdatedAt: AFTER_DEPLOY, knownTypes: new Set(REGISTRY) }),
  "未登记类型不适用新规则：不在清单 → 关（与之前相同）",
);
ok(
  isTypeEnabledForUser({ type: "approval", enabledTypes: new Set(["task_due"]), hasCustomList: false, listUpdatedAt: null }),
  "从未自定义清单：全开（不变）",
);

console.log("生效清单（设置页显示）");
const septEffective = effectiveEnabledTypes(sept);
ok(COLLAB_TYPES.every((t) => septEffective.includes(t)), "上线前清单的生效清单含五个新类型", septEffective);
ok(septEffective.includes("install_completed"), "生效清单含按时间规则开启的 install_completed");
ok(!septEffective.includes("followup"), "生效清单不含用户关掉的 followup");
ok(effectiveEnabledTypes(row({ enabledTypesJson: null })).length === REGISTRY.length, "没有清单：生效清单为全部已登记类型");
const septDto = rowToDTO(sept);
ok(COLLAB_TYPES.every((t) => septDto.enabledTypes.includes(t)), "接口返回的 enabledTypes 是生效清单");

console.log("写入时物化");
for (const [label, write] of [
  ["只改免打扰", buildPreferenceUpdate(sept, { quietHoursStart: "23:00" }, AFTER_DEPLOY)],
  ["改自动化偏好", typePreferenceWriteFields(sept, { meta: { automation: { enabled: true } } })],
] as const) {
  const after = applyWrite(sept, write as Record<string, unknown>, AFTER_DEPLOY);
  ok(COLLAB_TYPES.every((t) => typeOn(after, t)), `老用户${label}之后，五个新类型仍开启`);
  ok(typeOn(after, "install_completed"), `老用户${label}之后，install_completed 仍开启`);
  ok(!typeOn(after, "followup"), `老用户${label}之后，followup 仍关闭`);
  const meta = parsePreferenceMetadata(after.metadata);
  ok(Array.isArray(meta.knownTypes) && (meta.knownTypes as string[]).length === REGISTRY.length, `${label}：metadata 记下写入时的注册表`);
}
const autoWrite = typePreferenceWriteFields(sept, { meta: { automation: { enabled: true } } });
ok((parsePreferenceMetadata(autoWrite.metadata).automation as { enabled?: boolean })?.enabled === true, "改自动化偏好：metadata 保留 automation 键");
const withOther = row({ ...sept, metadata: JSON.stringify({ automation: { enabled: true }, foo: 1 }) });
const keepMeta = parsePreferenceMetadata(buildPreferenceUpdate(withOther, { onlyHighPriority: true }, AFTER_DEPLOY).metadata as string);
ok(keepMeta.foo === 1 && (keepMeta.automation as { enabled?: boolean })?.enabled === true, "设置页保存：metadata 原有键保留");

const offComment = buildPreferenceUpdate(sept, { enabledTypes: septEffective.filter((t) => t !== "task_comment") }, AFTER_DEPLOY);
const afterOff = applyWrite(sept, offComment, AFTER_DEPLOY);
ok(!typeOn(afterOff, "task_comment"), "上线后在设置页关掉任务新评论 → 不再投递");
ok(typeOn(afterOff, "mention"), "关掉任务新评论不影响 @提及");
const noList = row({ enabledTypesJson: null });
ok(typePreferenceWriteFields(noList, {}).enabledTypesJson === undefined, "没有清单的行：不凭空写清单（仍为全开）");

const fresh = initialPreferenceData("u9");
ok(fresh.enabledTypesJson === JSON.stringify(REGISTRY), "自动建行：清单为当前注册表");
ok((parsePreferenceMetadata(fresh.metadata).knownTypes as string[]).length === REGISTRY.length, "自动建行：记下 knownTypes");
ok(fresh.quietHoursStart === "22:00" && fresh.quietHoursEnd === "08:00", "自动建行：免打扰缺省值不变");

const autoSrc = read("src/lib/proactive/automation-prefs.ts");
const updFn = autoSrc.slice(autoSrc.indexOf("export async function updateUserAutomationPrefs"));
ok(/typePreferenceWriteFields\(/.test(updFn), "自动化偏好写入走物化");
ok(updFn.indexOf("findUnique") >= 0 && updFn.indexOf("findUnique") < updFn.indexOf(".update("), "自动化偏好：写入前先读出原行");
const prefSrc = read("src/lib/notifications/preferences.ts");
ok(/create\(\{\s*data: initialPreferenceData\(userId\)/.test(prefSrc), "自动建行使用 initialPreferenceData");

console.log("邮件偏好的生效值");
ok(effectiveEmailEnabled(row({ emailEnabled: false, metadata: null })) === true, "没有选择记录（自动建的行，列为 false）→ 开");
ok(effectiveEmailEnabled(row({ emailEnabled: false, metadata: JSON.stringify({ knownTypes: REGISTRY }) })) === true, "只有 knownTypes、没有选择记录 → 开");
ok(rowToDTO(row({ emailEnabled: false })).emailEnabled === true, "接口返回生效值 true");
// 上线前在设置页保存过：那时邮件开关还没接发信，列里的 false 不算选择（任务书 D3）
const septSaved = row({
  enabledTypesJson: JSON.stringify(SEPT_LIST),
  emailEnabled: false,
  metadata: JSON.stringify({ automation: { enabled: true, autoCreateTasks: false, autoOverdueFollowup: false } }),
  updatedAt: SEPT,
});
ok(
  effectiveEmailEnabled(septSaved) === true && rowToDTO(septSaved).emailEnabled === true,
  "上线前保存过设置页（列为 false、没有 emailChoiceAt）→ 开；上线后关掉并保存才算选择",
);
const turnOff = buildPreferenceUpdate(sept, { emailEnabled: false }, AFTER_DEPLOY);
const afterEmailOff = applyWrite(sept, turnOff, AFTER_DEPLOY);
ok(parsePreferenceMetadata(afterEmailOff.metadata).emailChoiceAt === AFTER_DEPLOY.toISOString(), "PATCH 带 emailEnabled 时记 emailChoiceAt");
ok(effectiveEmailEnabled(afterEmailOff) === false && rowToDTO(afterEmailOff).emailEnabled === false, "关掉后生效值为 false");
const turnOn = applyWrite(afterEmailOff, buildPreferenceUpdate(afterEmailOff, { emailEnabled: true }, AFTER_DEPLOY), AFTER_DEPLOY);
ok(effectiveEmailEnabled(turnOn) === true, "关掉后再打开 → true");
const noEmailPatch = buildPreferenceUpdate(sept, { onlyHighPriority: true }, AFTER_DEPLOY);
ok(parsePreferenceMetadata(noEmailPatch.metadata as string).emailChoiceAt === undefined, "PATCH 不带 emailEnabled 时不记选择");
ok(!("emailEnabled" in noEmailPatch), "PATCH 不带 emailEnabled 时不改这一列");
ok(OCT < AFTER_DEPLOY, "时间常量自检");

console.log("设置页文案");
const page = read("src/app/(main)/settings/notifications/page.tsx");
ok(page.includes('label="未读提醒与每日汇总邮件"'), "邮件开关名称");
ok(page.includes("@提及与任务指派 15 分钟未读时发一封提醒；每天早上 7 点（组织时区）发一封未读汇总。发到你的青砚账号邮箱。"), "邮件开关说明");
ok(page.includes(">站外通道</h2>") && !page.includes("站外通道（预留）"), "分组标题为「站外通道」");
ok(page.includes("控制站内通知类型、优先级、静默时段，以及未读提醒与每日汇总邮件。推送通道已预留，后续版本接入。"), "页面说明");
ok(!page.includes("当前未连接发信"), "不再写「当前未连接发信」");
ok(page.includes('label="推送通知"') && page.includes("浏览器或 App 推送（后续版本）。"), "推送开关保持原样");

console.log("T-1 询价进展的四个类型");
{
  const RFQ_TYPES = ["rfq_quote_received", "rfq_reply_received", "rfq_chase_ready", "rfq_no_response"] as const;
  const RFQ_LABELS: Record<(typeof RFQ_TYPES)[number], string> = {
    rfq_quote_received: "供应商报价了",
    rfq_reply_received: "供应商回信（无报价）",
    rfq_chase_ready: "催单待批",
    rfq_no_response: "供应商未响应",
  };
  for (const t of RFQ_TYPES) {
    ok(REGISTRY.includes(t), `注册表含 ${t}`);
    ok(NOTIFICATION_TYPE_LABELS[t] === RFQ_LABELS[t], `${t} → ${RFQ_LABELS[t]}`);
    ok(TYPE_INTRODUCED_AT[t] === "9999-12-31T00:00:00Z", `${t} 用远未来哨兵`);
    ok(new RegExp(`\\b${t}:`).test(itemIcons), `通知页图标表含 ${t}`);
    ok(new RegExp(`\\b${t}:`).test(headerIcons), `铃铛图标表含 ${t}`);
  }
  // 本次上线前的清单：当时注册表里还没有这四个类型
  const BEFORE_T1 = REGISTRY.filter((t) => !(RFQ_TYPES as readonly string[]).includes(t));
  const octNoKnown = row({ enabledTypesJson: JSON.stringify(BEFORE_T1), updatedAt: OCT });
  ok(RFQ_TYPES.every((t) => typeOn(octNoKnown, t)), "2026-10 保存、无 knownTypes 的清单：四个询价类型视为开启");
  const savedAfterCollab = row({
    enabledTypesJson: JSON.stringify(BEFORE_T1),
    metadata: JSON.stringify({ knownTypes: BEFORE_T1 }),
    updatedAt: new Date("2026-11-06T00:00:00Z"),
  });
  ok(RFQ_TYPES.every((t) => typeOn(savedAfterCollab, t)), "COLLAB-2 之后、T-1 之前保存（knownTypes 里没有询价类型）：视为开启");
  const turnedOff = row({
    enabledTypesJson: JSON.stringify(REGISTRY.filter((t) => t !== "rfq_chase_ready")),
    metadata: JSON.stringify({ knownTypes: REGISTRY }),
    updatedAt: AFTER_DEPLOY,
  });
  ok(!typeOn(turnedOff, "rfq_chase_ready"), "上线后在设置页关掉「催单待批」并保存 → 关闭");
  ok(typeOn(turnedOff, "rfq_quote_received"), "关掉「催单待批」不影响「供应商报价了」");
}

console.log(`\ncollab-preferences: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
