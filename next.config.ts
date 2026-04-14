import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    skipWaiting: true,
    runtimeCaching: [
      {
        urlPattern: /^\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-assets",
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^\/icons\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "icon-assets",
          expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^\/sunny-quote\.html/i,
        handler: "CacheFirst",
        options: {
          cacheName: "quote-tool",
          expiration: { maxEntries: 5, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^\/api\/sales\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "sales-api",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^\/api\/ai\/.*/i,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^\/api\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-general",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 50, maxAgeSeconds: 12 * 60 * 60 },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
};

export default withPWA(nextConfig);
