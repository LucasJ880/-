/**
 * TREE-1 读公开网页：真实传输层（Node http）的行为。只连本机起的服务，不连外网。
 *   - 默认的内网判断：127.0.0.1 / localhost / [::1] 在连接前被拒，服务端收到 0 次请求（localhost 走的是换掉的 lookup）。
 *   - 用测试接缝放行回环地址后测正常路径：gzip 解开、压缩炸弹解压后截断、超时（不回头 / 慢慢吐正文）、不跟跳转、
 *     只发 GET 且只带给定的请求头（没有 cookie / authorization）、坏的 gzip 报连接错误。
 *
 * 运行：npx tsx src/lib/web-reader/__tests__/web-reader-transport.test.ts
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import zlib from "node:zlib";
import { NetError, type NetRequest } from "../read-page";
import { createNodeNet } from "../transport";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders };

/** 4 GiB 全零经 brotli 压缩后的 3233 字节（生成方式见 design D13；以 base64 存放） */
const BR_BOMB = Buffer.from(readFileSync(join(process.cwd(), "src/lib/web-reader/__tests__/fixtures/br-zeros-4gib.b64"), "utf8"), "base64");

async function main() {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    const path = req.url ?? "/";
    if (path === "/plain") {
      res.writeHead(200, { "content-type": "text/plain", "set-cookie": "sid=1" });
      res.end("hello");
    } else if (path === "/gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(Buffer.from("<p>gzipped award</p>")));
    } else if (path === "/bomb") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61)));
    } else if (path === "/brbomb") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" });
      res.end(BR_BOMB);
    } else if (path === "/badgzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(Buffer.from("this is not gzip at all"));
    } else if (path === "/redirect") {
      res.writeHead(302, { location: "/plain" });
      res.end();
    } else if (path === "/hang") {
      // 不回头
    } else if (path === "/drip") {
      res.writeHead(200, { "content-type": "text/plain" });
      const t = setInterval(() => res.write("x"), 50);
      res.on("close", () => clearInterval(t));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const req = (url: string, over: Partial<NetRequest> = {}): NetRequest => ({
    url: new URL(url),
    headers: { "user-agent": "QingyanResearchBot/1.0 (+https://qingyan.ca)", accept: "*/*", "accept-encoding": "gzip, deflate, br" },
    timeoutMs: 3000,
    maxBytes: 1024 * 1024,
    ...over,
  });
  const expectNetError = async (name: string, p: Promise<unknown>, kind: NetError["kind"]) => {
    try {
      await p;
      ok(name, false, "没有抛错");
    } catch (e) {
      ok(name, e instanceof NetError && e.kind === kind, e instanceof Error ? `${e.name}:${e.message}` : e);
    }
  };

  try {
    console.log("默认的内网判断：连接前就拒");
    const real = createNodeNet();
    await expectNetError("127.0.0.1 被拒", real.request(req(`${base}/plain`)), "private_address");
    await expectNetError("localhost 被拒（走换掉的 lookup）", real.request(req(`http://localhost:${port}/plain`)), "private_address");
    await expectNetError("[::1] 被拒", real.request(req(`http://[::1]:${port}/plain`)), "private_address");
    await expectNetError("0x7f.1 被拒", real.request(req(`http://0x7f.1:${port}/plain`)), "private_address");
    ok("服务端收到 0 次请求", seen.length === 0, seen);

    console.log("测试接缝放行回环后的正常路径");
    const net = createNodeNet({ isBlockedAddress: () => false });
    const plain = await net.request(req(`${base}/plain`));
    ok("读到正文", plain.status === 200 && new TextDecoder().decode(plain.body) === "hello" && !plain.truncated);
    const last = seen[seen.length - 1];
    ok("只发 GET", last.method === "GET");
    ok("只带给定的请求头：没有 cookie / authorization，连接不复用", !last.headers.cookie && !last.headers.authorization && !last.headers["proxy-authorization"] && last.headers.connection === "close", last.headers);
    await net.request(req(`${base}/plain`));
    ok("对方给了 set-cookie，下一次请求也不带 cookie", !seen[seen.length - 1].headers.cookie);
    const gz = await net.request(req(`${base}/gzip`));
    ok("gzip 解开", new TextDecoder().decode(gz.body) === "<p>gzipped award</p>");
    const bomb = await net.request(req(`${base}/bomb`));
    ok("压缩炸弹：解压后按上限截断并标截断", bomb.body.length === 1024 * 1024 && bomb.truncated === true, bomb.body.length);
    {
      const t1 = Date.now();
      const br = await net.request(req(`${base}/brbomb`, { maxBytes: 2 * 1024 * 1024 }));
      ok("brotli 炸弹（3 KB → 4 GiB）：很快按上限截断", br.truncated === true && br.body.length === 2 * 1024 * 1024 && Date.now() - t1 < 5000, [br.body.length, Date.now() - t1]);
      // 截断后解压流必须一起销毁：之后 1.5 秒里本进程几乎不占 CPU（修之前每 2 秒约 1.8 秒 CPU）
      await new Promise((r) => setTimeout(r, 100));
      const c0 = process.cpuUsage();
      await new Promise((r) => setTimeout(r, 1500));
      const c1 = process.cpuUsage(c0);
      const cpuMs = Math.round((c1.user + c1.system) / 1000);
      ok("截断后不在后台继续解压（1.5 秒内 CPU < 300 ms）", cpuMs < 300, cpuMs);
    }
    await expectNetError("坏的 gzip：连接错误", net.request(req(`${base}/badgzip`)), "network");
    const red = await net.request(req(`${base}/redirect`));
    ok("不跟跳转：原样返回 302 与 location", red.status === 302 && red.headers.location === "/plain");
    const t0 = Date.now();
    await expectNetError("不回头：按单次超时中断", net.request(req(`${base}/hang`, { timeoutMs: 300 })), "timeout");
    await expectNetError("慢慢吐正文：总计时覆盖收正文", net.request(req(`${base}/drip`, { timeoutMs: 400 })), "timeout");
    ok("两次超时都在时限附近结束（< 3 秒）", Date.now() - t0 < 3000, Date.now() - t0);
    await expectNetError("连不上：连接错误", net.request(req(`http://127.0.0.1:1/x`, { timeoutMs: 1000 })), "network");
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\nweb-reader-transport: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
