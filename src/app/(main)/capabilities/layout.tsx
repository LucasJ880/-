/**
 * 中台页面统一容器：最大宽度与间距，不改主导航。
 */
export default function CapabilitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-1 pb-10 sm:px-0">
      {children}
    </div>
  );
}
