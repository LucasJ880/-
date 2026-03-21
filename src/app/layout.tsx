import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "青砚 - AI 工作助理",
  description: "智能中文 AI 工作助理，助力高效办公",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
