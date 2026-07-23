import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function ProjectToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformAdminGate fallbackPath="/projects">{children}</PlatformAdminGate>;
}
