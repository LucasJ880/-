import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function CapabilitiesRunsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlatformAdminGate fallbackPath="/capabilities">{children}</PlatformAdminGate>
  );
}
