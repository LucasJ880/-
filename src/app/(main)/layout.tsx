import { AppShell } from "@/components/app-shell";
import { WechatEntryProvider } from "@/components/wechat-entry/context";
import { isWechatBindingEnabled } from "@/lib/messaging/wechat-entry";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WechatEntryProvider enabled={isWechatBindingEnabled()}>
      <AppShell>{children}</AppShell>
    </WechatEntryProvider>
  );
}
