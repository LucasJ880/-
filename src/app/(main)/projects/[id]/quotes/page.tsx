import { redirect } from "next/navigation";

/**
 * T1A：/projects/[id]/quotes 此前无 page.tsx（404 死路由，T0 审计 §2.4）。
 * 补一条安全跳转到「标书与报价」tab；报价编辑器 [quoteId] 子路由不受影响。
 */

type Props = { params: Promise<{ id: string }> };

export default async function ProjectQuotesIndexPage({ params }: Props) {
  const { id } = await params;
  redirect(`/projects/${id}?tab=bid`);
}
