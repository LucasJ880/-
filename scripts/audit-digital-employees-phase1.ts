import { db } from "../src/lib/db";
import {
  describeDigitalEmployeeRollout,
  describeDigitalEmployees,
} from "../src/lib/digital-employees/activation";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const orgId = getArg("org-id");
  const userId = getArg("user-id");

  if (!orgId) throw new Error("Missing --org-id=<Organization.id>");

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      status: true,
      modulesJson: true,
      _count: { select: { members: true } },
    },
  });
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  const user = userId
    ? await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          activeOrgId: true,
        },
      })
    : null;

  const activeBindings = userId
    ? await db.weChatBinding.count({ where: { userId, status: "active" } })
    : 0;
  const emailProviderCount = userId
    ? await db.emailProvider.count({ where: { userId } })
    : 0;
  const notificationPreference = userId
    ? await db.userNotificationPreference.findUnique({
        where: { userId },
        select: { metadata: true },
      })
    : null;

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        organization: org,
        user,
        rollout: describeDigitalEmployeeRollout(),
        employees: describeDigitalEmployees({
          orgId,
          userId: user?.id,
          role: user?.role,
        }),
        prerequisites: {
          openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
          cronSecretConfigured: Boolean(process.env.CRON_SECRET),
          activeWechatBindings: activeBindings,
          connectedEmailProviders: emailProviderCount,
          automationPreferenceMetadata: notificationPreference?.metadata ?? null,
        },
        safety: {
          automaticEmailSend: false,
          highRiskWritesRequireApproval: true,
          recommendation:
            "Keep Supervisor and employee learning disabled until Phase 1 acceptance passes.",
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
