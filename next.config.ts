import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: /\/api\/sales\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "sales-api",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\/api\/ai\/.*/i,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /\/api\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-general",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 50, maxAgeSeconds: 12 * 60 * 60 },
        },
      },
      {
        urlPattern: /\/sunny-quote\.html/i,
        handler: "CacheFirst",
        options: {
          cacheName: "quote-tool",
          expiration: { maxEntries: 5, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
};

export default withPWA(nextConfig);
