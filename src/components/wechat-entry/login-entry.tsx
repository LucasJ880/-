/**
 * 登录页"或"分隔线 + "微信扫码登录"按钮（openspec change hide-wechat-entry / COLLAB-1）。
 * 从 src/app/(auth)/login/page.tsx 原样抽出；登录页只在 useWechatEntryEnabled() 为真时渲染，
 * 点击回调（跳 /api/auth/wechat）仍由登录页传入。
 */

function WeChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05a6.127 6.127 0 0 1-.253-1.726c0-3.573 3.27-6.47 7.3-6.47.258 0 .51.013.76.035C16.728 4.82 13.03 2.188 8.691 2.188zM5.785 6.24c.648 0 1.174.468 1.174 1.045 0 .578-.526 1.046-1.174 1.046-.649 0-1.175-.468-1.175-1.046 0-.577.526-1.045 1.175-1.045zm5.813 0c.648 0 1.175.468 1.175 1.045 0 .578-.527 1.046-1.175 1.046s-1.175-.468-1.175-1.046c0-.577.527-1.045 1.175-1.045zM16.95 9.57c-3.527 0-6.39 2.53-6.39 5.648 0 3.119 2.863 5.649 6.39 5.649a7.55 7.55 0 0 0 2.27-.35.652.652 0 0 1 .54.072l1.43.84a.242.242 0 0 0 .126.04.221.221 0 0 0 .218-.222c0-.054-.022-.108-.036-.16l-.294-1.115a.444.444 0 0 1 .16-.499C22.922 18.423 24 16.61 24 15.218c0-3.118-2.863-5.648-6.39-5.648h-.66zm-2.41 3.24c.494 0 .895.357.895.796 0 .44-.4.798-.896.798-.494 0-.894-.357-.894-.798 0-.44.4-.796.894-.796zm4.822 0c.494 0 .895.357.895.796 0 .44-.401.798-.895.798-.494 0-.895-.357-.895-.798 0-.44.4-.796.895-.796z" />
    </svg>
  );
}

export function WechatLoginEntry({ onClick }: { onClick: () => void }) {
  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-xs text-muted/70">或</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      <button
        type="button"
        onClick={onClick}
        className="flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-white/60 py-2.5 text-sm font-medium text-foreground/90 backdrop-blur-sm transition-all duration-200 hover:bg-white/80 hover:shadow-sm active:scale-[0.99]"
      >
        <WeChatIcon className="h-5 w-5 text-[#07C160]" />
        微信扫码登录
      </button>
    </>
  );
}
