/**
 * CHAIN-2c 谁能更换项目负责人：纯判定、固定文字、四个入口与项目团队卡片的接线（源码断言）
 *
 * 运行：npx tsx src/lib/projects/__tests__/owner-change.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_CHANGE_TEXT, checkNewOwner, decideOwnerChange, ownerChangeConfirm, ownerChangeFlags, ownerChangeHint, type OwnerChangeActor } from "../owner-change";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : ""); }
}

const OWNER = "u_owner", ME = "u_me", OTHER = "u_other";
const actor = (p: Partial<OwnerChangeActor>): OwnerChangeActor => ({ actorUserId: ME, isSuperAdmin: false, hasFinancePrivilege: false, isManager: false, hasOrg: true, ...p });
const code = (a: OwnerChangeActor, current: string, target: string) => {
  const d = decideOwnerChange(a, current, target);
  return d.ok ? (d.changed ? "OK" : "SAME") : d.code;
};

console.log("判定：换给别人");
{
  ok("项目管理员（不是负责人、不是管理者、没有财务特权）：403 OWNER_CHANGE_FORBIDDEN", code(actor({}), OWNER, OTHER) === "OWNER_CHANGE_FORBIDDEN");
  ok("组织管理员（管理者）、当前负责人、有财务特权的人、平台超级管理员：可以", code(actor({ isManager: true }), OWNER, OTHER) === "OK" && code(actor({ actorUserId: OWNER }), OWNER, OTHER) === "OK" && code(actor({ hasFinancePrivilege: true }), OWNER, OTHER) === "OK" && code(actor({ isSuperAdmin: true }), OWNER, OTHER) === "OK");
  ok("个人项目：管理者标记不算；当前负责人与平台超级管理员可以", code(actor({ hasOrg: false, isManager: true }), OWNER, OTHER) === "OWNER_CHANGE_FORBIDDEN" && code(actor({ hasOrg: false, actorUserId: OWNER }), OWNER, OTHER) === "OK" && code(actor({ hasOrg: false, isSuperAdmin: true }), OWNER, OTHER) === "OK");
  const d = decideOwnerChange(actor({}), OWNER, OTHER);
  const dp = decideOwnerChange(actor({ hasOrg: false }), OWNER, OTHER);
  ok("403 的话：组织项目与个人项目各一句", !d.ok && d.status === 403 && d.messageZh === "只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。请找现在的主负责人或组织管理员。" && !dp.ok && dp.messageZh === "这是个人项目，只有项目负责人或平台管理员能更换负责人。");
}

console.log("判定：换给自己");
{
  ok("组织管理员、项目管理员把自己设为负责人：403 OWNER_SELF_ASSIGN_FORBIDDEN", code(actor({ isManager: true }), OWNER, ME) === "OWNER_SELF_ASSIGN_FORBIDDEN" && code(actor({}), OWNER, ME) === "OWNER_SELF_ASSIGN_FORBIDDEN");
  ok("有财务特权的人、平台超级管理员：可以", code(actor({ hasFinancePrivilege: true }), OWNER, ME) === "OK" && code(actor({ isSuperAdmin: true }), OWNER, ME) === "OK");
  ok("当前负责人「设为自己」= 不变", code(actor({ actorUserId: OWNER }), OWNER, OWNER) === "SAME" && code(actor({}), OWNER, OWNER) === "SAME");
  const d = decideOwnerChange(actor({ isManager: true }), OWNER, ME);
  const dp = decideOwnerChange(actor({ hasOrg: false }), OWNER, ME);
  ok("403 的话：指向能把负责人交给你的人", !d.ok && d.messageZh === "你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。" && !dp.ok && dp.messageZh === "不能把自己设为负责人：请项目负责人把负责人交给你。");
}

console.log("新负责人的条件");
{
  const bad = checkNewOwner({ hasOrg: true, userActive: true, orgMemberActive: false });
  const badUser = checkNewOwner({ hasOrg: true, userActive: false, orgMemberActive: true });
  const personal = checkNewOwner({ hasOrg: false, userActive: false, orgMemberActive: false });
  ok("不在组织 / 已停用：400 OWNER_INVALID；个人项目只看在用", !bad.ok && bad.status === 400 && bad.code === "OWNER_INVALID" && bad.messageZh === "新负责人必须是本组织的有效成员（账号没停用、没离开组织），请换一位。" && !badUser.ok && !personal.ok && personal.messageZh === "新负责人的账号已停用，请换一位。" && checkNewOwner({ hasOrg: false, userActive: true, orgMemberActive: false }).ok && checkNewOwner({ hasOrg: true, userActive: true, orgMemberActive: true }).ok);
}

console.log("成员接口的两个标记与卡片说明");
{
  const f = (a: OwnerChangeActor, edit = true) => ownerChangeFlags(a, OWNER, edit);
  ok("项目管理员 false/false；组织管理员 true/false；有财务特权 true/true；不能修改本项目 false/false；负责人本人 true/false", JSON.stringify([f(actor({})), f(actor({ isManager: true })), f(actor({ hasFinancePrivilege: true })), f(actor({ hasFinancePrivilege: true }), false), f(actor({ actorUserId: OWNER }))]) === JSON.stringify([{ canChange: false, canSelfAssign: false }, { canChange: true, canSelfAssign: false }, { canChange: true, canSelfAssign: true }, { canChange: false, canSelfAssign: false }, { canChange: true, canSelfAssign: false }]));
  ok("卡片说明：不能换 → 第一句；能换不能给自己 → 第二句；负责人本人、有财务特权、不能修改本项目、个人项目 → 不写", ownerChangeHint({ canChange: false, canSelfAssign: false }, { hasOrg: true, isCurrentOwner: false, canManage: true }) === "你不能更换主负责人。需要更换，请找现在的主负责人或组织管理员。" && ownerChangeHint({ canChange: true, canSelfAssign: false }, { hasOrg: true, isCurrentOwner: false, canManage: true }) === "你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。" && ownerChangeHint({ canChange: false, canSelfAssign: false }, { hasOrg: false, isCurrentOwner: false, canManage: true }) === null && ownerChangeHint({ canChange: true, canSelfAssign: false }, { hasOrg: true, isCurrentOwner: true, canManage: true }) === null && ownerChangeHint({ canChange: true, canSelfAssign: true }, { hasOrg: true, isCurrentOwner: false, canManage: true }) === null && ownerChangeHint({ canChange: false, canSelfAssign: false }, { hasOrg: true, isCurrentOwner: false, canManage: false }) === null);
  ok("409 的话与换前确认（调用人是现在的负责人时多一句）", OWNER_CHANGE_TEXT.conflict === "负责人刚被别人换过了，请刷新页面，看清现在的负责人再操作。" && ownerChangeConfirm("Example Lee", true) === "把主负责人换成「Example Lee」？换完后你不能自己改回来，要请新的主负责人或组织管理员交还。" && ownerChangeConfirm("Example Lee", false) === "把主负责人换成「Example Lee」？");
}

console.log("接线（源码断言）");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pure = read("src/lib/projects/owner-change.ts");
  ok("纯模块不依赖 db（页面也用）", !/from "@\/lib\/db"|from "@prisma|node:/.test(pure));
  const acc = read("src/lib/projects/owner-change-access.ts");
  ok("财务特权用 resolveFinancePrivilege(user, orgId, null).privileged；带条件写入；先权限后目标", acc.includes("resolveFinancePrivilege(user, orgId, null)") && acc.includes("hasFinancePrivilege: finance.privileged") && acc.includes("updateMany({ where: { id: projectId, ownerId: expectedOwnerId }, data: { ownerId: newOwnerId } })") && acc.indexOf("decideOwnerChange(actor") < acc.indexOf("checkNewOwnerInDb(input.targetUserId"));
  const patch = read("src/app/api/projects/[id]/route.ts");
  ok("PATCH /api/projects/{项目}：写库前判定、被拒提前返回、带条件写入、409、审计带 ownerId、账本仍记 ownerId", patch.indexOf("guardOwnerChange({ user, orgId: beforeProject.orgId ?? null, currentOwnerId: beforeProject.ownerId") > 0 && patch.indexOf("if (guard instanceof NextResponse) return guard;") < patch.indexOf("db.$transaction(async (tx) => {") && patch.includes("if (newOwnerId) await writeOwnerIfUnchanged(tx, id, beforeProject.ownerId, newOwnerId);") && patch.includes("if (err instanceof OwnerChangeConflict) return ownerConflictResponse();") && patch.includes("...(newOwnerId ? { ownerId: beforeProject.ownerId } : {}),") && patch.includes("...(newOwnerId ? { ownerId: project.ownerId } : {}),") && !patch.includes("data.ownerId = String(body.ownerId)") && patch.includes('...(newOwnerId ? ["ownerId"] : [])'));
  const members = read("src/app/api/projects/[id]/members/route.ts");
  ok("加成员设为主负责人：先判权限（目标沿用原来的检查）、带条件写入、409、审计带前后负责人；GET 返回 ownerChange，不能修改本项目时不查授权", members.includes("guardOwnerChange({ user, orgId: project.orgId ?? null, currentOwnerId: project.ownerId, targetUserId: userId, skipTargetCheck: true })") && members.indexOf("guardOwnerChange(") < members.indexOf("db.$transaction(") && members.includes("if (ownerChanged) await writeOwnerIfUnchanged(tx, projectId, project.ownerId, userId);") && members.includes('if (member === "OWNER_CONFLICT") return ownerConflictResponse();') && members.includes("ownerChange,") && members.includes("...(ownerChanged ? { beforeData: { ownerId: project.ownerId } } : {}),") && /const ownerChange = canEditProject\s*\?\s*ownerChangeFlags\(await resolveOwnerChangeActor\(access\.user, project\.orgId \?\? null\), project\.ownerId, true\)\s*:\s*\{ canChange: false, canSelfAssign: false \};/.test(members));
  const member = read("src/app/api/projects/[id]/members/[memberId]/route.ts");
  ok("把成员设为主负责人：判定在事务前、带条件写入、409", member.includes("guardOwnerChange({ user, orgId: project.orgId ?? null, currentOwnerId: project.ownerId, targetUserId: member.userId })") && member.indexOf("guardOwnerChange(") < member.indexOf("db.$transaction(") && member.includes("if (ownerChanged) await writeOwnerIfUnchanged(tx, projectId, project.ownerId, member.userId);") && member.includes("if (err instanceof OwnerChangeConflict) return ownerConflictResponse();") && !/data: \{ ownerId: member\.userId \}/.test(member));
  const ops = read("src/app/api/ops/projects/[id]/route.ts");
  ok("执行项目：不能管理执行项目的人照旧得到原来的 403「无权重新分配负责人」（code FORBIDDEN），在新判定之前", ops.includes('{ error: "无权重新分配负责人", code: "FORBIDDEN" }') && ops.indexOf('{ error: "无权重新分配负责人", code: "FORBIDDEN" }') < ops.indexOf("guardOwnerChange("));
  ok("执行项目：既有门槛之后同一判定（管理者）、带条件写入、409、写审计", ops.indexOf("canManageDeliveryProjects(opsCtx)") < ops.indexOf("guardOwnerChange({ user, orgId: project.orgId, currentOwnerId: project.ownerId, targetUserId: ownerId, isManager: true })") && ops.includes("if (newOwnerId) await writeOwnerIfUnchanged(tx, project.id, project.ownerId, newOwnerId);") && ops.includes("if (err instanceof OwnerChangeConflict) return ownerConflictResponse();") && ops.includes("beforeData: { ownerId: project.ownerId },") && ops.includes("afterData: { ownerId: newOwnerId },") && !ops.includes("data.ownerId = ownerId;"));
  const page = read("src/app/(main)/projects/[id]/page.tsx");
  const card = read("src/components/project-detail/tabs/workbench-tab.tsx");
  // 含 ?? 的期望串单独一行（check-swc-nullish-logical 不让 ?? 与 && 同一行）
  const OWNER_PROP = "ownerId={project.owner?.id ?? null}";
  ok("页面把 ownerChange 传给工作台", page.includes("setOwnerChange({ canChange: m.ownerChange?.canChange === true, canSelfAssign: m.ownerChange?.canSelfAssign === true });") && page.includes("ownerChange={ownerChange}"));
  ok("卡片：负责人按项目本身判断；两个身份下拉按标记给「主负责人」、已离开组织的成员不给、当前负责人那一行照旧；选了不能给的人改回「参与者」；换前确认；409 刷新；说明一句", card.includes("const isCurrentOwner = !!ownerId && ownerId === currentUserId;") && card.includes(OWNER_PROP) && card.includes('currentDuty === "owner" ||') && card.includes("(ownerChange.canChange && (userId !== currentUserId || ownerChange.canSelfAssign) && !(orgId && memberOrgRole === null))") && card.includes("{dutiesFor(m.userId, m.duty, m.orgRole).map((d) => (") && card.includes("{dutiesFor(selectedUser?.id).map((d) => (") && card.includes('if (addDuty === "owner" && !ownerOptionFor(c.id)) setAddDuty("participant");') && card.includes('if (addDuty === "owner" && !confirmOwnerChange(selectedUser?.name ?? "")) return;') && card.includes("if (!confirmOwnerChange(who)) return;") && (card.match(/if \(res\.status === 409\) onChanged\(\);/g) ?? []).length === 2 && card.includes("ownerChangeHint(ownerChange, { hasOrg: !!orgId, isCurrentOwner, canManage })") && card.includes('data-testid="owner-change-hint"') && !card.includes("{PROJECT_DUTIES.map((d) => (") && !card.includes("effectiveAddDuty"));
}

console.log(`\nowner-change: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
