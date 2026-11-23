/**
 * 读公开网页（TREE-1）的真实传输层：Node 自带的 http / https。
 *
 * - 连接时再校验地址：`lookup` 换成「解析全部地址 → 有一个不是公网地址就报错」，挡住 DNS 重绑定；
 *   主机名是 IP 字面量时 Node 不走 lookup，这里先自己判断。
 * - 只发 GET、不跟跳转、不带 cookie（没有 cookie 罐；请求头只有调用方给的几项）、不复用连接。
 * - 单次请求总计时（连接 + 收头 + 收正文）到时即中断。
 * - 按 Content-Encoding 解压（gzip / deflate / br），解压后计数，超过上限截断（防压缩炸弹）。
 * 测试一律注入假网络，不用本文件。
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";
import type { Readable, Transform } from "node:stream";
import { isBlockedAddress } from "./pure";
import { NetError, type NetRequest, type NetResponse, type ResolvedAddress, type WebReaderNet } from "./read-page";

/** 域名解析超时（对方的权威 DNS 不应答时不让读页卡在系统解析器上） */
const DNS_TIMEOUT_MS = 5_000;

async function resolveAll(host: string): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const list = await Promise.race([
      dns.promises.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS);
      }),
    ]);
    return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
  } catch {
    throw new NetError("dns", "域名解析失败");
  } finally {
    clearTimeout(timer);
  }
}

type AddressGuard = (ip: string) => boolean;

const makeGuardedLookup = (blocked: AddressGuard): LookupFunction => (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new NetError("dns", "域名解析失败") as NodeJS.ErrnoException, "", 4);
    if (list.some((a) => blocked(a.address))) {
      return callback(new NetError("private_address", "地址不是公网地址") as NodeJS.ErrnoException, "", 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

function decoderFor(encoding: string | undefined): Transform | null {
  const e = (encoding ?? "").trim().toLowerCase();
  if (e === "gzip" || e === "x-gzip") return zlib.createGunzip();
  if (e === "deflate") return zlib.createInflate();
  if (e === "br") return zlib.createBrotliDecompress();
  return null;
}

function flattenHeaders(h: http.IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}

function requestOnce(req: NetRequest, blocked: AddressGuard, guardedLookup: LookupFunction): Promise<NetResponse> {
  const literal = isIP(req.url.hostname.replace(/^\[|\]$/g, "")) ? req.url.hostname.replace(/^\[|\]$/g, "") : null;
  if (literal && blocked(literal)) return Promise.reject(new NetError("private_address", "地址不是公网地址"));
  const mod = req.url.protocol === "https:" ? https : http;
  return new Promise<NetResponse>((resolve, reject) => {
    let settled = false;
    // 截断、超时、出错时把响应与解压流一起销毁：只销毁响应的话，已收到的压缩数据还会在后台继续解压占 CPU
    let teardown: () => void = () => undefined;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      teardown();
    };
    const r = mod.request(
      req.url,
      { method: "GET", headers: { ...req.headers }, lookup: guardedLookup, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = flattenHeaders(res.headers);
        const decoder = decoderFor(headers["content-encoding"]);
        const stream: Readable = decoder ? (res.pipe(decoder) as unknown as Readable) : res;
        teardown = () => {
          if (decoder) {
            res.unpipe(decoder);
            decoder.destroy();
          }
          res.destroy();
        };
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        stream.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = req.maxBytes - total;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            total += room;
            truncated = true;
            done(() => resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)), truncated }));
            return;
          }
          chunks.push(chunk);
          total += chunk.length;
        });
        stream.on("end", () => done(() => resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)), truncated })));
        stream.on("error", () => done(() => reject(new NetError("network", "正文读取中断"))));
        res.on("error", () => done(() => reject(new NetError("network", "正文读取中断"))));
      },
    );
    const timer = setTimeout(() => {
      done(() => reject(new NetError("timeout", "超时")));
      r.destroy();
    }, req.timeoutMs);
    r.on("error", (e: unknown) => {
      if (e instanceof NetError) return done(() => reject(e));
      done(() => reject(new NetError("network", "连接失败")));
    });
    r.end();
  });
}

/**
 * 真实传输。`isBlockedAddress` 只给测试换（在本机起服务测正常路径）；生产一律用默认的内网判断。
 */
export function createNodeNet(opts: { isBlockedAddress?: AddressGuard } = {}): WebReaderNet {
  const blocked = opts.isBlockedAddress ?? isBlockedAddress;
  const lookup = makeGuardedLookup(blocked);
  return { resolve: resolveAll, request: (req) => requestOnce(req, blocked, lookup) };
}
