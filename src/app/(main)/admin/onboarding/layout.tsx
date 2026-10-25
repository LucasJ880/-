import { PlatformAdminGate } from "@/components/auth/platform-admin-gate";

export default function FactoryOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PlatformAdminGate fallbackPath="/">{children}</PlatformAdminGate>;
}
