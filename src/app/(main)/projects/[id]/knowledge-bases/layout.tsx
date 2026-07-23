import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function ProjectKnowledgeBasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformAdminGate fallbackPath="/projects">{children}</PlatformAdminGate>;
}
