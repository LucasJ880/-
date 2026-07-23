import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function MemoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformAdminGate fallbackPath="/">{children}</PlatformAdminGate>;
}
