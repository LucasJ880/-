import { AutopilotGate } from "@/components/auth/autopilot-gate";

export default function AutopilotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AutopilotGate>{children}</AutopilotGate>;
}
