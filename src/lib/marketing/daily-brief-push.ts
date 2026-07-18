import { db } from "@/lib/db";
import { pushMessage } from "@/lib/messaging/gateway";
import { buildMarketingDailyBrief } from "./wechat-daily-brief";
import { GROWTH_CENTER_WORKFLOW } from "./team";

export async function pushMarketingDailyBrief(orgId: string) {
  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      ownerId: true,
      members: {
        where: { status: "active", role: { in: ["org_admin"] } },
        select: { userId: true },
      },
    },
  });
  if (!organization) throw new Error("组织不存在");
  const growthProjects = await db.project.findMany({
    where: { orgId, status: "active", workflowTemplate: GROWTH_CENTER_WORKFLOW },
    select: {
      ownerId: true,
      members: {
        where: { status: "active", role: "project_admin" },
        select: { userId: true },
      },
    },
  });
  const recipients = [...new Set([
    organization.ownerId,
    ...organization.members.map((row) => row.userId),
    ...growthProjects.map((row) => row.ownerId),
    ...growthProjects.flatMap((row) => row.members.map((member) => member.userId)),
  ])];
  const content = await buildMarketingDailyBrief(orgId);
  const results = [];
  for (const userId of recipients) {
    const delivery = await pushMessage(userId, content, { channels: ["personal_wechat", "wecom"] });
    results.push({ userId, ...delivery });
  }
  return {
    recipients: results.length,
    sent: results.reduce((sum, row) => sum + row.sent, 0),
    failed: results.reduce((sum, row) => sum + row.failed, 0),
    results,
  };
}
