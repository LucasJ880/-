/**
 * P2-3a「跟这个标」：采购监控里的招标公告 → 招投标项目 + 关联（本项目）+ 改为关注。
 *
 * - 只建一次（design D1）：事务里锁公告行（FOR UPDATE），
 *   先认指向还在的项目的「本项目」关联（最早的一条，与候选卡片一致），没有再认本组织里由跟标建出、还在的项目；
 *   有就返回那个项目。不是招标公告先拒（D4）。
 * - 建项步骤与 POST /api/projects 相同（design D2）：项目 + 创建者 project_admin + 测试 / 正式环境 +
 *   讨论区系统消息 + 台账 project.created（台账闸开时同事务，actor 取服务端用户）。
 * - 不发任何外部请求、不调模型；项目不带文件，上传后走现有入队。
 */

import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { onProjectCreated } from "@/lib/project-discussion/system-events";
import { appendProjectEvent } from "@/lib/project-ledger/event-service";
import { projectCreatedEventKey } from "@/lib/project-ledger/event-keys";
import { isLedgerProducerActive } from "@/lib/project-ledger/flags";
import { syncProjectMilestoneCalendars } from "@/lib/projects/sync-milestone-calendar";
import { followEligibility, projectFieldsFromInstrument, ORG_ARCHIVED_ZH, NOTICE_EVIDENCE_ORDER, type FollowRefusal } from "./tender-follow-pure";

/** 项目来源元数据里的公告 id（JSON.stringify 的固定写法；跟标建出的项目都带它） */
export const followMarker = (instrumentId: string) => `"procurementInstrumentId":${JSON.stringify(instrumentId)}`;

export type FollowResult = { ok: true; projectId: string; created: boolean } | FollowRefusal | { ok: false; status: 404; code: string; message: string };

export async function followTenderNotice(input: { orgId: string; user: AuthUser; instrumentId: string; now?: Date }): Promise<FollowResult> {
  const { user } = input;
  const now = input.now ?? new Date();
  const org = await db.organization.findUnique({ where: { id: input.orgId }, select: { status: true } });
  if (!org) return { ok: false, status: 404, code: "ORG_NOT_FOUND", message: "组织不存在" };
  if (org.status !== "active") return { ok: false, status: 403, code: "ORG_ARCHIVED", message: ORG_ARCHIVED_ZH };

  const out = await db.$transaction(async (tx) => {
    // 锁公告行：两人同时点时第二个在这里等，拿到锁后能看到第一个建的关联
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ProcurementInstrument" WHERE id = ${input.instrumentId} AND "orgId" = ${input.orgId} FOR UPDATE`;
    if (locked.length !== 1) return { ok: false as const, status: 404 as const, code: "INSTRUMENT_NOT_FOUND", message: "采购工具不存在" };

    const inst = await tx.procurementInstrument.findUniqueOrThrow({
      where: { id: input.instrumentId },
      select: { id: true, officialNumber: true, title: true, jurisdiction: true, origin: true, instrumentClass: true, contractingInstitution: true, buyingInstitution: true, publishedAt: true, closingAt: true },
    });
    // 不是招标公告：一律拒（即使有人手工关联过）
    if (inst.instrumentClass !== "SOLICITATION") return followEligibility(inst, now) as FollowRefusal;

    // ① 指向还在的项目的「本项目」关联（最早的一条，与候选卡片的「已跟进」一致；项目被删了的关联不算，审查 M1）
    const links = await tx.procurementTenderLink.findMany({
      where: { orgId: input.orgId, instrumentId: inst.id, relation: "CURRENT" },
      orderBy: { createdAt: "asc" },
      select: { projectId: true },
    });
    if (links.length) {
      const alive = await tx.project.findMany({ where: { id: { in: links.map((l) => l.projectId) }, orgId: input.orgId }, select: { id: true } });
      const hit = links.find((l) => alive.some((p) => p.id === l.projectId));
      if (hit) return { ok: true as const, projectId: hit.projectId, created: false };
    }

    // ② 没有「本项目」关联时：本组织里由跟标建出、还在的项目（关联被改成「前序 / 历史」也认得出，不会建第二个，审查 H2）
    const followed = await tx.project.findFirst({
      where: { orgId: input.orgId, sourceMetadataJson: { contains: followMarker(inst.id) } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (followed) return { ok: true as const, projectId: followed.id, created: false };
    // 已跟过的即使截标也返回原项目（上面）；新跟要求未截标
    const elig = followEligibility(inst, now);
    if (!elig.ok) return elig;
    // 与候选列表同一查询（有链接的证据，新到旧，同时间按 id），保证预填的公告链接与列表里的一样（P2-1 审查 L1）
    const evidence = await tx.procurementSourceEvidence.findMany({
      where: { orgId: input.orgId, instrumentId: inst.id, sourceUrl: { not: null } },
      orderBy: NOTICE_EVIDENCE_ORDER,
      select: { sourceType: true, sourceUrl: true },
    });
    const f = projectFieldsFromInstrument(inst, evidence);

    const p = await tx.project.create({
      data: {
        name: f.name,
        description: null,
        color: "#3B82F6",
        ownerId: user.id,
        orgId: input.orgId,
        workDomain: "tender",
        solicitationNumber: f.solicitationNumber,
        closeDate: f.closeDate,
        publicDate: f.publicDate,
        clientOrganization: f.clientOrganization,
        sourcePlatform: f.sourcePlatform,
        sourceMetadataJson: JSON.stringify(f.sourceMetadata),
        members: { create: { userId: user.id, role: "project_admin", status: "active" } },
        environments: {
          create: [
            { name: "测试环境", code: "test", status: "active" },
            { name: "正式环境", code: "prod", status: "active" },
          ],
        },
      },
      select: { id: true, name: true, createdAt: true },
    });
    await onProjectCreated(p.id, p.name, user.id, user.name, tx);
    if (isLedgerProducerActive()) {
      await appendProjectEvent({
        tx,
        orgId: input.orgId,
        projectId: p.id,
        eventType: "project.created",
        eventKey: projectCreatedEventKey(p.id),
        occurredAt: p.createdAt,
        actor: { actorType: "user", actorId: user.id },
        title: `项目创建：${p.name}`,
        payload: { schemaVersion: 1, name: p.name, workDomain: "tender", ownerId: user.id },
      });
    }
    await tx.procurementTenderLink.create({
      data: { orgId: input.orgId, projectId: p.id, instrumentId: inst.id, relation: "CURRENT", note: "跟这个标", createdById: user.id },
    });
    await tx.procurementInstrument.update({ where: { id: inst.id }, data: { triageStatus: "WATCHING", triagedById: user.id, triagedAt: now } });
    return { ok: true as const, projectId: p.id, created: true, name: p.name, instrumentId: inst.id, instrumentTitle: inst.title?.trim() || inst.officialNumber, hasCloseDate: !!f.closeDate };
  });

  if (out.ok && out.created && "name" in out) {
    // 截标日已预填：同步里程碑日程（与改截标日、文件元数据回填相同；失败不影响建项，审查 M2）
    if (out.hasCloseDate) await syncProjectMilestoneCalendars(out.projectId).catch(() => null);
    await logAudit({
      userId: user.id,
      orgId: input.orgId,
      projectId: out.projectId,
      action: AUDIT_ACTIONS.CREATE,
      targetType: AUDIT_TARGETS.PROJECT,
      targetId: out.projectId,
      afterData: { id: out.projectId, name: out.name, orgId: input.orgId, defaultEnvironments: ["test", "prod"], fromProcurementInstrumentId: out.instrumentId },
    });
    await logAudit({
      userId: user.id,
      orgId: input.orgId,
      projectId: out.projectId,
      action: "procurement_instrument.follow_tender",
      targetType: "procurement_instrument",
      targetId: out.instrumentId,
      // title：活动流显示「从采购监控跟进了采购公告「…」」
      afterData: { title: out.instrumentTitle, projectId: out.projectId, relation: "CURRENT", triageStatus: "WATCHING" },
    });
  }
  if (!out.ok) return out;
  return { ok: true, projectId: out.projectId, created: out.created };
}
