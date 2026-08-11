import { redirect } from "next/navigation";

/**
 * T1A：/projects/[id]/quality 此前只有孤儿 layout、无 page（404 死路由，T0 审计 §2.4）。
 * 补一条安全跳转回项目详情；layout 的 PlatformAdminGate 保留（物理删除留待后续 Cleanup）。
 */

type Props = { params: Promise<{ id: string }> };

export default async function ProjectQualityIndexPage({ params }: Props) {
  const { id } = await params;
  redirect(`/projects/${id}`);
}
