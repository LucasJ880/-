import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ThemeProvider, UI_THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#0F766E",
};

export const metadata: Metadata = {
  title: "青砚",
  description: "青砚 — 智能工作平台",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "青砚",
    startupImage: "/icons/apple-touch-icon.png",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/icon-192x192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" data-theme="classic" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <link
          rel="icon"
          href="/icons/icon-192x192.png"
          type="image/png"
          sizes="192x192"
        />
        <link
          rel="apple-touch-icon"
          href="/icons/apple-touch-icon.png"
        />
        <script
          dangerouslySetInnerHTML={{ __html: UI_THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="h-full">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
