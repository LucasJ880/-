/**
 * TREE-1 读公开网页测试用的假世界：假网络（按网址返回固定响应、记下每个请求）+ 虚拟时钟。
 * 虚拟时钟：sleep 登记一个到期时间，等所有微任务都跑完（setImmediate）才把时间拨到最早的到期点，
 * 这样并发的等待与请求的先后与真实时钟一致。不是测试文件本身（不注册）。
 */
import {
  NetError,
  createResearchReadSessionWithDeps,
  type NetRequest,
  type NetResponse,
  type ResearchJobRow,
  type WebReadAuditEntry,
} from "../read-page";

export const enc = new TextEncoder();
export const LONG_HTML = `<p>${"Award notice. ".repeat(300)}</p>`;

export function html(body: string, status = 200, extra: Record<string, string> = {}): NetResponse {
  return { status, headers: { "content-type": "text/html; charset=utf-8", ...extra }, body: enc.encode(body), truncated: false };
}
export function status(code: number, extra: Record<string, string> = {}): NetResponse {
  return { status: code, headers: { "content-type": "text/html", ...extra }, body: new Uint8Array(), truncated: false };
}
export function redirect(to: string, code = 302): NetResponse {
  return { status: code, headers: { location: to }, body: new Uint8Array(), truncated: false };
}
export function robots(text: string): NetResponse {
  return { status: 200, headers: { "content-type": "text/plain" }, body: enc.encode(text), truncated: false };
}

export type Handler = (attempt: number, req: NetRequest) => NetResponse | Error | Promise<NetResponse | Error>;

export function makeWorld(addresses: Record<string, string[]> = {}) {
  let time = Date.parse("2026-11-23T00:00:00Z");
  const handlers = new Map<string, Handler>();
  const counts = new Map<string, number>();
  const log: Array<{ url: string; at: number; timeoutMs: number; headers: Record<string, string> }> = [];
  const audits: WebReadAuditEntry[] = [];
  const timers: Array<{ at: number; resolve: () => void }> = [];
  let pumping = false;
  const pump = () => {
    if (pumping) return;
    pumping = true;
    const step = () => {
      if (timers.length === 0) {
        pumping = false;
        return;
      }
      timers.sort((a, b) => a.at - b.at);
      const t = timers.shift()!;
      time = Math.max(time, t.at);
      t.resolve();
      setImmediate(step);
    };
    setImmediate(step);
  };
  const world = {
    handlers,
    log,
    robotsRequestsCount: () => log.filter((l) => l.url.endsWith("/robots.txt")).length,
    audits,
    now: () => time,
    /** 这棵树过去的读页审计（建会话时读出） */
    history: [] as Array<{ branchKey: string; attempts: number; blockedSite: string | null }>,
    /** 审计写入方式：默认像真实写库一样走宏任务（setImmediate） */
    auditMode: "macrotask" as "macrotask" | "microtask",
    net: {
      async resolve(host: string) {
        const list = addresses[host] ?? ["93.184.216.34"];
        if (list.length === 1 && list[0] === "NXDOMAIN") throw new NetError("dns", "nx");
        return list.map((address) => ({ address, family: (address.includes(":") ? 6 : 4) as 4 | 6 }));
      },
      async request(req: NetRequest): Promise<NetResponse> {
        const url = req.url.toString();
        log.push({ url, at: time, timeoutMs: req.timeoutMs, headers: { ...req.headers } });
        const n = (counts.get(url) ?? 0) + 1;
        counts.set(url, n);
        const h = handlers.get(url);
        if (!h) return status(404);
        const out = await h(n, req);
        if (out instanceof Error) throw out;
        if (out.body.length > req.maxBytes) return { ...out, body: out.body.subarray(0, req.maxBytes), truncated: true };
        return out;
      },
    },
    clock: {
      now: () => time,
      sleep: (ms: number, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
        const timer = { at: time + ms, resolve };
        timers.push(timer);
        signal?.addEventListener("abort", () => {
          const i = timers.indexOf(timer);
          if (i >= 0) timers.splice(i, 1);
          resolve();
        }, { once: true });
          pump();
        }),
    },
  };
  return world;
}

export type World = ReturnType<typeof makeWorld>;

export const RESEARCH_META = {
  workDomain: "tender",
  initiatedByUserId: "u1",
  researchTree: true,
  researchTreeVersion: 1,
  researchTrigger: "human_start",
};
export const RESEARCH_JOB: ResearchJobRow = { id: "job1", orgId: "org1", status: "running", metadata: RESEARCH_META };

export async function openSession(
  w: World,
  over: { job?: ResearchJobRow; env?: Record<string, string | undefined>; settings?: unknown } = {},
) {
  return createResearchReadSessionWithDeps(
    { orgId: "org1", jobId: "job1" },
    {
      loadJob: async () => over.job ?? RESEARCH_JOB,
      loadOrgSettings: async () => over.settings ?? null,
      loadTreeHistory: async () => w.history,
      env: over.env ?? { TENDER_RESEARCH_TREE_ENABLED: "1" },
      reader: {
        net: w.net,
        clock: w.clock,
        audit: (e) =>
          w.auditMode === "microtask"
            ? Promise.resolve(void w.audits.push(e))
            : new Promise<void>((r) => setImmediate(() => r(void w.audits.push(e)))),
      },
    },
  );
}

/** 测试里放行所有网址的网址检查（生产里 TREE-2 必须给真正的检查） */
export const ALLOW_ALL = (): boolean => true;

export async function openSessionWithCache(w: World, cache: import("../read-page").TreePageCache) {
  return createResearchReadSessionWithDeps(
    { orgId: "org1", jobId: "job1", cache },
    {
      loadJob: async () => RESEARCH_JOB,
      loadOrgSettings: async () => null,
      loadTreeHistory: async () => w.history,
      env: { TENDER_RESEARCH_TREE_ENABLED: "1" },
      reader: { net: w.net, clock: w.clock, audit: async (e) => void w.audits.push(e) },
    },
  );
}

export function budget(n = 12) {
  return { remaining: n, used: 0 };
}
