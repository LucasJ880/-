/**
 * P2-3a「跟这个标」：采购监控里的招标公告 → 招投标项目 + 关联（本项目）+ 改为关注。
 *
 * - 只建一次（design D1）：事务里锁公告行（FOR UPDATE），再查有没有 CURRENT 关联；有就返回那个项目。
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
import { followEligibility, projectFieldsFromInstrument, ORG_ARCHIVED_ZH, type FollowRefusal } from "./tender-follow-pure";

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

    const existing = await tx.procurementTenderLink.findFirst({
      where: { orgId: input.orgId, instrumentId: input.instrumentId, relation: "CURRENT" },
      orderBy: { createdAt: "asc" },
      select: { projectId: true },
    });
    if (existing) return { ok: true as const, projectId: existing.projectId, created: false };

    const inst = await tx.procurementInstrument.findUniqueOrThrow({
      where: { id: input.instrumentId },
      select: { id: true, officialNumber: true, title: true, jurisdiction: true, origin: true, instrumentClass: true, contractingInstitution: true, buyingInstitution: true, publishedAt: true, closingAt: true },
    });
    const elig = followEligibility(inst, now);
    if (!elig.ok) return elig;
    const evidence = await tx.procurementSourceEvidence.findMany({
      where: { orgId: input.orgId, instrumentId: inst.id },
      orderBy: { fetchedAt: "desc" },
      take: 20,
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
    return { ok: true as const, projectId: p.id, created: true, name: p.name, instrumentId: inst.id, instrumentTitle: inst.title?.trim() || inst.officialNumber };
  });

  if (out.ok && out.created && "name" in out) {
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
