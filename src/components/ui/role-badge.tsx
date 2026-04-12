import { cn } from "@/lib/utils";
import { orgRoleLabel, projectRoleLabel, platformRoleLabel } from "@/lib/permissions-client";

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-[rgba(128,80,120,0.08)] text-[#805078]",
  super_admin: "bg-[rgba(128,80,120,0.08)] text-[#805078]",
  sales: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  trade: "bg-[rgba(59,130,246,0.08)] text-[#3b82f6]",
  org_admin: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  org_member: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
  org_viewer: "bg-[rgba(110,125,118,0.06)] text-[#8a9590]",
  project_admin: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]",
  operator: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  tester: "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]",
  viewer: "bg-[rgba(110,125,118,0.06)] text-[#8a9590]",
  user: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
};

export function RoleBadge({
  role,
  type = "org",
  className,
}: {
  role: string;
  type?: "platform" | "org" | "project";
  className?: string;
}) {
  const label =
    type === "platform"
      ? platformRoleLabel(role)
      : type === "project"
        ? projectRoleLabel(role)
        : orgRoleLabel(role);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        ROLE_STYLES[role] ?? "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]",
        className
      )}
    >
      {label}
    </span>
  );
}
