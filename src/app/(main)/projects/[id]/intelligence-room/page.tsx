import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { IntelligenceRoomClient } from "@/components/bid-workflow/intelligence-room-client";

type Props = { params: Promise<{ id: string }> };

export default async function IntelligenceRoomPage({ params }: Props) {
  const { id } = await params;
  // 轻量服务端加载；权限由 API 与中间件会话保证，详情页另有 access
  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      closeDate: true,
      bidPhaseStatus: true,
      category: true,
      projectTypes: true,
      aiAdviceStatus: true,
      intelligence: { select: { recommendation: true } },
      owner: { select: { name: true } },
    },
  });
  if (!project) notFound();

  // 避免未登录空读（cookie 存在性提示；真正鉴权在 API）
  const jar = await cookies();
  if (!jar.get("qy_session")) {
    notFound();
  }

  const types = Array.isArray(project.projectTypes)
    ? (project.projectTypes as unknown[]).filter((t) => typeof t === "string")
    : [];
  const projectTypeLabel =
    types.length > 0
      ? types.join(" / ")
      : project.category?.trim() || null;

  return (
    <IntelligenceRoomClient
      projectId={project.id}
      projectName={project.name}
      closeDate={project.closeDate?.toISOString().slice(0, 10) ?? null}
      ownerName={project.owner?.name ?? null}
      bidPhaseStatus={project.bidPhaseStatus}
      projectTypeLabel={projectTypeLabel}
      aiSuggestion={
        project.intelligence?.recommendation ?? project.aiAdviceStatus ?? null
      }
    />
  );
}
