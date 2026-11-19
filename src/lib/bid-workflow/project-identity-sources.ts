/**
 * CHAIN-4b — 读出一个项目的禁出清单来源（只读）
 *
 * 项目字段 + 当前可用招标分析（最新一份等待审核或已批准，与询价单取要求的规则相同）
 * 里状态为已知的五个关键事实槽；组织代码与时区；询价设置里允许出现的我方邮箱。
 * 询价生成、询价入口、发送执行与供应商侧文件生成共用这一个加载器。
 */

import { db } from "@/lib/db";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { readCriticalFactSlot, readTenderRfqSettings } from "@/lib/tender-rfq/round-pure";
import {
  buildProjectIdentityDenyList,
  rfqReference,
  type ProjectIdentityDenyList,
  type ProjectIdentitySources,
} from "./project-identity-deny";

export type LoadedProjectIdentity = {
  sources: ProjectIdentitySources;
  denyList: ProjectIdentityDenyList;
  /** 对供应商的中性询价编号 */
  reference: string;
  timeZone: string;
};

const FACT_SLOTS = {
  tenderNumber: "tender_number",
  buyer: "buyer",
  projectTitle: "project_title",
  closingDatetime: "closing_datetime",
  location: "location",
} as const;

export async function loadProjectIdentity(projectId: string): Promise<LoadedProjectIdentity | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      solicitationNumber: true,
      clientOrganization: true,
      closeDate: true,
      createdAt: true,
      org: { select: { code: true, settingsJson: true } },
    },
  });
  if (!project) return null;

  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { summaryJson: true },
  });

  const facts: ProjectIdentitySources["facts"] = { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [] };
  if (run) {
    const byId: Array<{ key: keyof typeof FACT_SLOTS; factId: string }> = [];
    for (const [key, slotType] of Object.entries(FACT_SLOTS) as Array<[keyof typeof FACT_SLOTS, string]>) {
      const slot = readCriticalFactSlot(run.summaryJson, slotType);
      if (!slot) continue;
      if ("text" in slot) facts[key].push(slot.text);
      else byId.push({ key, factId: slot.factId });
    }
    if (byId.length) {
      const rows = await db.tenderAnalysisFact.findMany({
        where: { id: { in: byId.map((f) => f.factId) } },
        select: { id: true, contentZh: true, contentOriginal: true },
      });
      for (const f of byId) {
        const r = rows.find((x) => x.id === f.factId);
        if (!r) continue;
        if (r.contentOriginal?.trim()) facts[f.key].push(r.contentOriginal);
        if (r.contentZh?.trim()) facts[f.key].push(r.contentZh);
      }
    }
  }

  const settingsJson = project.org?.settingsJson ?? null;
  const timeZone = resolveOrgTimezone(settingsJson);
  const rfq = readTenderRfqSettings(settingsJson);
  const sources: ProjectIdentitySources = {
    projectName: project.name,
    solicitationNumber: project.solicitationNumber,
    clientOrganization: project.clientOrganization,
    closeDate: project.closeDate,
    timeZone,
    facts,
    allowedEmails: [rfq.fromEmail, rfq.mailboxEmail],
  };
  return {
    sources,
    denyList: buildProjectIdentityDenyList(sources),
    reference: rfqReference({ projectId: project.id, projectCreatedAt: project.createdAt, orgCode: project.org?.code ?? null, timeZone }),
    timeZone,
  };
}
