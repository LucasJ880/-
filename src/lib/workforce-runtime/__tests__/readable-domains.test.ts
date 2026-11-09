/**
 * VIS-1b workforce 作业可读域（spec agents/workforce-job-scope、navigation/position-based-visibility「AI 任务只对有可读工作域的人出现」）
 * 对照表 + 「AI 任务」入口与可读域等价（含已知例外）+ 列表补扫与游标（注入读取器）+ 源码断言
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canReadWorkDomain,
  createWorkforceJobReadFilter,
  readableWorkDomains,
  readsEveryWorkDomain,
  type ReadableWorkDomain,
} from "../readable-domains";
import { listWorkforceJobViews, WORKFORCE_LIST_MAX_SCAN_BATCHES, type WorkforceListReader } from "../read-model/list-service";
import type { WorkforceRunSnapshot } from "../read-model/types";
import { WORKFORCE_JOB_RUN_TYPE } from "../constants";
import { normalizeWorkDomain } from "../work-domain";
import { navEntryVisible } from "@/lib/navigation/route-gate-core";
import type { RouteGateContext } from "@/lib/navigation/filter-context";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  mergedProfileBindings,
  profileKeysForIndustryPack,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES } from "@/lib/tenancy/modules";
import { getDefaultWorkspace, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ─────────────────────────── 身份 ───────────────────────────

const keysOf = (pack: string, ...positions: string[]) => [
  ...new Set(positions.flatMap((p) => mergedProfileBindings(pack, p).filter((b) => (b.effect ?? "ALLOW") === "ALLOW").map((b) => b.permissionKey))),
];
const SUNNY_MODS = { enabled: [...DEFAULT_SUNNY_MODULES] };
const MX_MODS = { enabled: [...DEFAULT_MENGXIN_MODULES] };
function ctx(partial: Partial<RouteGateContext>): RouteGateContext {
  return {
    platformRole: "user",
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: [],
    modules: SUNNY_MODS,
    isPlatformAdmin: false,
    permissionKeys: [],
    positionMode: true,
    hasBidCapability: false,
    autopilotAllowed: false,
    wechatEntryEnabled: false,
    ...partial,
  };
}
const sunny = (...p: string[]) => ctx({ permissionKeys: keysOf(WINDOW_COVERING_INDUSTRY_PACK, ...p), orgRole: p.includes("owner") ? "org_admin" : "org_member" });
const mx = (...p: string[]) => ctx({ modules: MX_MODS, permissionKeys: keysOf(HOME_TEXTILE_TRADE_INDUSTRY_PACK, ...p) });
const SUPER_ADMIN = ctx({ platformRole: "super_admin", isPlatformAdmin: true });
const ALL: ReadableWorkDomain[] = ["tender", "delivery", "sales", "general", "unresolved"];
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const aiJobsVisible = (c: RouteGateContext) => navEntryVisible("work-ai-jobs", { ...c, pathname: "/workforce" });

async function main() {
  console.log("readable-domains（VIS-1b）");

  // ── 对照表 ──
  {
    const TABLE: Array<[string, RouteGateContext, ReadableWorkDomain[]]> = [
      ["只持 bids", sunny("bids"), ["tender", "delivery"]],
      ["只持 ops_staff", sunny("ops_staff"), ["delivery"]],
      ["只持 ops_lead", sunny("ops_lead"), ["delivery"]],
      ["只持 sales_rep", sunny("sales_rep"), ["sales"]],
      ["梦馨只持 trade_rep", mx("trade_rep"), ["sales"]],
      ["Sunny 持 owner", sunny("owner"), ALL],
      ["只持 accounting", sunny("accounting"), []],
      ["只持 installer", sunny("installer"), []],
      ["只持 fulfillment_vinyl", sunny("fulfillment_vinyl"), []],
      ["无岗位", sunny(), []],
      ["平台 super_admin", SUPER_ADMIN, ALL],
    ];
    for (const [name, c, want] of TABLE) {
      const got = readableWorkDomains(c);
      ok(same(got, want), `${name}：可读 ${want.join("、") || "（无）"}`, got);
    }
    ok(!canReadWorkDomain("general", sunny("ops_staff")) && canReadWorkDomain("general", sunny("owner")), "通用域不对一线可读，只对管理层（Q8）");
    ok(!canReadWorkDomain(null, sunny("bids")) && canReadWorkDomain(null, sunny("owner")) && canReadWorkDomain(null, SUPER_ADMIN), "解析不出工作域：只对管理层与平台 super_admin");
  }

  // ── 「AI 任务」入口与可读域不漂移（行业包岗位 + 系统岗位 + 无岗位；纯销售与旧模式 sales 除外）──
  {
    const KNOWN_EXCEPTIONS = new Set(["window_covering_services_v1:trade_rep", "home_textile_trade_v1:project_manager"]);
    const drift: string[] = [];
    const exceptionsSeen: string[] = [];
    for (const [pack, mods] of [
      [WINDOW_COVERING_INDUSTRY_PACK, SUNNY_MODS],
      [HOME_TEXTILE_TRADE_INDUSTRY_PACK, MX_MODS],
    ] as const) {
      for (const key of [...profileKeysForIndustryPack(pack), "__none__"]) {
        const c = ctx({ modules: mods, permissionKeys: key === "__none__" ? [] : keysOf(pack, key) });
        const pureSales = getDefaultWorkspace(workspaceContextFromNav(c)) === "/sales/home";
        const entry = aiJobsVisible(c);
        const readable = readableWorkDomains(c).length > 0;
        if (pureSales) continue;
        const id = `${pack}:${key}`;
        if (KNOWN_EXCEPTIONS.has(id)) {
          if (entry && !readable) exceptionsSeen.push(id);
          continue;
        }
        if (entry !== readable) drift.push(`${id}（入口 ${entry}，可读 ${readable}）`);
      }
    }
    ok(drift.length === 0, "每个行业包与系统岗位、无岗位成员：「AI 任务」可见 ⇔ 可读工作域非空", drift);
    ok(exceptionsSeen.length === 2, "已知例外：Sunny 系统岗位 trade_rep、梦馨 project_manager——入口出现、列表为空（企业未启用对应模块）", exceptionsSeen);
    const mxTradeNoPosition = ctx({ modules: MX_MODS, platformRole: "trade", permissionKeys: [] });
    ok(!aiJobsVisible(mxTradeNoPosition) && same(readableWorkDomains(mxTradeNoPosition), ["sales"]), "已知例外：梦馨平台角色 trade、未绑岗位——可读销售域但入口不出现");
    ok(aiJobsVisible(mx("trade_rep")), "绑上 trade_rep 后入口出现");
    const legacySales = ctx({ positionMode: false, platformRole: "sales", modules: { enabled: ["sales", "trade", "marketing", "operations"] }, permissionKeys: keysOf(WINDOW_COVERING_INDUSTRY_PACK, "sales_rep") });
    ok(readableWorkDomains(legacySales).includes("sales"), "旧模式 sales：可读销售域（入口另由「纯销售侧栏不含 AI 任务」决定，不在等价断言里）");
  }

  // ── 列表补扫与游标（注入读取器）──
  {
    const base = Date.parse("2026-11-09T12:00:00Z");
    const mkRun = (i: number, workDomain: string): WorkforceRunSnapshot => ({
      id: `run-${String(i).padStart(4, "0")}`,
      orgId: "org1",
      runType: WORKFORCE_JOB_RUN_TYPE,
      status: "SUCCEEDED",
      attempts: 1,
      errorCode: null,
      errorMessage: null,
      planJson: null,
      metadata: { workDomain },
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date(base - i * 60_000),
      updatedAt: new Date(base - i * 60_000),
    });
    const makeReader = (runs: WorkforceRunSnapshot[]) => {
      let runQueries = 0;
      const reader: WorkforceListReader = {
        agentRun: {
          findMany: async (args) => {
            runQueries++;
            let rows = runs.filter((r) => r.orgId === args.where.orgId && r.runType === args.where.runType);
            const or = args.where.OR;
            if (or) {
              rows = rows.filter((r) =>
                or.some((cond) =>
                  "AND" in cond
                    ? r.updatedAt.getTime() === cond.AND[0].updatedAt.getTime() && r.id < cond.AND[1].id.lt
                    : r.updatedAt.getTime() < cond.updatedAt.lt.getTime(),
                ),
              );
            }
            rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1));
            return rows.slice(0, args.take);
          },
        },
        agentRunStep: { findMany: async () => [] },
        agentRunEvent: { findMany: async () => [] },
        pendingAction: { findMany: async () => [] },
      };
      return { reader, queries: () => runQueries };
    };
    // 注入的解析器：按显式标记解析（真实解析器另有项目 / 工具证据，规则不在本 change 内）
    const resolver = async (run: { metadata: unknown }) => normalizeWorkDomain((run.metadata as { workDomain?: unknown } | null)?.workDomain);
    const opsCanRead = createWorkforceJobReadFilter(sunny("ops_staff"), resolver);

    {
      const { reader } = makeReader([mkRun(1, "tender"), mkRun(2, "delivery")]);
      const res = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead }, reader);
      ok(res.items.length === 1 && res.items[0].jobId === "run-0002" && res.nextCursor === null, "运营看不到投标作业：只返回交付域那一条", res.items.map((i) => i.jobId));
    }
    {
      const runs = [...Array.from({ length: 21 }, (_, i) => mkRun(i + 1, "tender")), ...[22, 23, 24].map((i) => mkRun(i, "delivery"))];
      const { reader, queries } = makeReader(runs);
      const res = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead }, reader);
      ok(JSON.stringify(res.items.map((i) => i.jobId)) === '["run-0022","run-0023","run-0024"]' && res.nextCursor === null && queries() === 2, "跳过一整批不可读作业：一次请求返回后面 3 条交付域，游标为空（扫 2 批）", { ids: res.items.map((i) => i.jobId), q: queries() });
    }
    {
      const { reader, queries } = makeReader(Array.from({ length: 300 }, (_, i) => mkRun(i + 1, "tender")));
      const res = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead }, reader);
      ok(res.items.length === 0 && res.nextCursor?.id === "run-0105" && queries() === WORKFORCE_LIST_MAX_SCAN_BATCHES, "扫描到上限：返回空列表，游标指向第 105 条（5 批 × 21 行）", { cursor: res.nextCursor?.id, q: queries() });
      const again = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead, cursor: res.nextCursor }, reader);
      ok(again.nextCursor?.id === "run-0210", "用游标继续：从第 106 条往后再扫 5 批");
    }
    {
      const runs = [mkRun(1, "tender"), ...Array.from({ length: 20 }, (_, i) => mkRun(i + 2, "delivery"))];
      const { reader } = makeReader(runs);
      const res = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead }, reader);
      const okCursor = res.nextCursor === null || res.nextCursor.id === "run-0021";
      ok(res.items.length === 20 && okCursor, "恰好在批尾凑满：返回 20 条，游标为空或指向第 21 行", res.nextCursor);
      if (res.nextCursor) {
        const next = await listWorkforceJobViews({ orgId: "org1", limit: 20, canRead: opsCanRead, cursor: res.nextCursor }, reader);
        ok(next.items.length === 0 && next.nextCursor === null, "用该游标再请求：空列表与空游标");
      }
    }
    {
      const runs = Array.from({ length: 25 }, (_, i) => mkRun(i + 1, i % 2 ? "delivery" : "tender"));
      const { reader } = makeReader(runs);
      const res = await listWorkforceJobViews({ orgId: "org1", limit: 5, canRead: opsCanRead }, reader);
      ok(res.items.length === 5 && res.items.every((i) => Number(i.jobId.slice(4)) % 2 === 0) && res.nextCursor?.id === res.items[4].jobId, "凑满一页：游标指向本页最后一条", { ids: res.items.map((i) => i.jobId), c: res.nextCursor?.id });
    }
    {
      const superRead = createWorkforceJobReadFilter(SUPER_ADMIN, async () => {
        throw new Error("不应解析");
      });
      ok(await superRead({ id: "x", orgId: "org1", metadata: null }), "平台 super_admin：不解析直接可读");
      const ownerRead = createWorkforceJobReadFilter(sunny("owner"), async () => {
        throw new Error("db down");
      });
      const opsRead = createWorkforceJobReadFilter(sunny("ops_staff"), async () => {
        throw new Error("db down");
      });
      ok((await ownerRead({ id: "x", orgId: "org1", metadata: null })) && !(await opsRead({ id: "x", orgId: "org1", metadata: null })), "解析抛错按「解析不出」：只对管理层可读（fail-closed）");
    }
  }

  // ── 源码断言 ──
  {
    const list = read("src/app/api/workforce/jobs/route.ts");
    ok(/loadWorkforceJobReadFilter\(\{ id: user\.id, role: user\.role \}, resolution\.orgId\)/.test(list) && /canRead,/.test(list), "列表接口：判定输入取接口已解析的企业，并传入服务层");
    const detail = read("src/app/api/workforce/jobs/[id]/route.ts");
    ok(
      /loadWorkforceJobReadFilter\(\{ id: user\.id, role: user\.role \}, resolution\.orgId\)/.test(detail) &&
        /if \(!run \|\| \(canRead && !\(await canRead\(run\)\)\)\) \{\s*return NextResponse\.json\(\{ error: "任务不存在" \}, \{ status: 404 \}\);/.test(detail),
      "详情接口：与列表同一判定函数；不可读返回与不存在相同的 404",
    );
    ok(readsEveryWorkDomain(sunny("owner")) && readsEveryWorkDomain(SUPER_ADMIN) && !readsEveryWorkDomain(sunny("ops_staff")) && !readsEveryWorkDomain(mx("owner", "trade_rep")), "可读全部工作域（Sunny 老板、平台 super_admin）→ 列表不逐条解析；梦馨老板（无投标域）照常逐条");
    const server = read("src/lib/workforce-runtime/job-scope-server.ts");
    ok(/resolveEffectiveWorkDomain\(/.test(server) && /readsEveryWorkDomain\(ctx\) \? undefined : createWorkforceJobReadFilter\(ctx, resolveRunWorkDomain\)/.test(server), "服务端解析沿用既有 resolveEffectiveWorkDomain");
    const page = read("src/app/(main)/workforce/page.tsx");
    ok(/jobs\.length === 0 && !nextCursor \? \(/.test(page), "/workforce 页面只在 nextCursor 为空时渲染空态");
    const pure = read("src/lib/workforce-runtime/readable-domains.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const runtimeImports = pure.split("\n").filter((l) => /^import (?!type )/.test(l));
    ok(!/next\/server|@\/lib\/db/.test(pure) && !runtimeImports.some((l) => l.includes("./work-domain")), "readable-domains.ts 是纯模块（不连库；work-domain 只类型导入）", runtimeImports);
    const reg = read("src/lib/navigation/registry.ts");
    ok(/key: "work-ai-jobs",[\s\S]{0,200}positionPermissions: \[\.\.\.POSITION_WORKFORCE\]/.test(reg), "「AI 任务」岗位键 = POSITION_WORKFORCE");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
