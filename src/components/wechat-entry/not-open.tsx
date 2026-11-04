import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";

/**
 * 微信入口开关关闭时 /settings/wechat 与 /wechat 的整页占位（openspec change hide-wechat-entry / COLLAB-1）。
 * 由同目录的服务端 layout 渲染；原页面组件不挂载，也就不请求绑定列表、二维码或消息记录。
 */
export function WechatNotOpen({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader title={title} />
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
        <MessageCircle size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">暂未开放</p>
          <p className="mt-1 text-sm text-muted">微信绑定与微信消息暂未开放。</p>
        </div>
      </div>
    </div>
  );
}
