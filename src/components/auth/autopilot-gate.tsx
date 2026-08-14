import type { ReactNode } from "react";
import { requireAutopilotPage } from "@/lib/autopilot/page-guard";
import type { AutopilotCapability } from "@/lib/autopilot/types";

export async function AutopilotGate({
  children,
  capability = "autopilot.view",
  fallbackPath = "/",
}: {
  children: ReactNode;
  capability?: AutopilotCapability;
  fallbackPath?: string;
}) {
  await requireAutopilotPage(capability, fallbackPath);
  return children;
}
