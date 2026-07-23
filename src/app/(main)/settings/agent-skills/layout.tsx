import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function AgentSkillsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlatformAdminGate fallbackPath="/settings">{children}</PlatformAdminGate>
  );
}
