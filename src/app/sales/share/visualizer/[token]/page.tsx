/**
 * 公开分享页 — 客户只读查看可视化方案
 *
 * /sales/share/visualizer/[token]
 *
 * - 不在 (main) 内，无需登录
 * - 仅显示有限字段（无价格、无内部 notes）
 * - 客户可点「我喜欢这套」回写偏好
 */

import ShareViewer from "./share-viewer";

export const dynamic = "force-dynamic";

export default async function PublicVisualizerSharePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  return <ShareViewer token={token} />;
}
