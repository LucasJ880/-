/* 青砚 Service Worker — 最小离线缓存策略
 * 策略概览：
 *  - 静态资源（图片/字体/manifest/图标）：cache-first
 *  - 页面（HTML）：network-first，失败回退到离线页
 *  - API 请求（/api/*）：完全不拦截，交由网络处理
 *  - POST/PUT/DELETE 等非 GET 请求：一律不缓存
 * 目标：保障弱网进入应用不白屏；不影响实时业务数据正确性。
 */

const VERSION = "qingyan-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

const PRECACHE_URLS = [
  "/manifest.json",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname)
  );
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(PAGE_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title><body style="font-family:-apple-system,system-ui;padding:40px;text-align:center;color:#2b6055"><h2>当前离线</h2><p style="color:#6e7d76">网络恢复后请刷新页面</p></body>',
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
          );
        }
      })()
    );
  }
});
