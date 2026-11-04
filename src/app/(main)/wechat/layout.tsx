import { WechatNotOpen } from "@/components/wechat-entry/not-open";
import { isWechatBindingEnabled } from "@/lib/messaging/wechat-entry";

/** 微信入口开关关闭时整页显示"暂未开放"，页面组件不挂载（openspec change hide-wechat-entry）。 */
export default function WechatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isWechatBindingEnabled()) return <WechatNotOpen title="微信消息" />;
  return children;
}
