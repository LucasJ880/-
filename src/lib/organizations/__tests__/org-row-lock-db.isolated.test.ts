/**
 * FIX-4 三处旧的组织行锁换成 FOR NO KEY UPDATE——真实 DB（隔离库），调用真实的接口与函数
 *（斑马帘比例接口、质保设置接口、能力配额策略的新建与修改）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/organizations/__tests__/org-row-lock-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户）。不发任何邮件，不调任何外部接口。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-4 组织行锁 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-4 org row lock DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 有人拿着锁不放的时间；「不用等」的上限；「等了」的下限 */
const HOLD_MS = 900;
const FAST_MS = 500;

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { lockOrganizationRow, mutateOrgSettings } = await import("../settings-write");
  const { createQuotaPolicy, patchQuotaPolicy } = await import("@/lib/capabilities/governance");
  const { readZebraRatios } = await import("@/lib/sunny-process/zebra-ratios");
  const { readWarrantySettings } = await import("@/lib/install/warranty");
  const zebraRoute = await import("@/app/api/sunny-process/zebra-ratios/route");
  const warrantyRoute = await import("@/app/api/install/warranty-settings/route");

  console.log("FIX-4 org row lock — isolated DB");
  const stamp = Date.now().toString(36);
  const BOSS = `rlboss_${stamp}`, ORG = `rlorg_${stamp}`;
  await db.user.create({ data: { id: BOSS, email: `${BOSS}@fixture.test`, name: "Fixture Boss", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Blinds Co.", code: `rl-${stamp}`, ownerId: BOSS, industryPackId: "window_covering_services_v1", settingsJson: { untouched: { keep: "me" } } } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: BOSS, role: "org_admin", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const ownerProfile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "owner" } } });
  if (!ownerProfile) throw new Error("缺岗位模板 owner");
  await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: BOSS, roleProfileId: ownerProfile.id, status: "active" } });

  const cookie = `qy_session=${await createSession({ sub: BOSS, email: `${BOSS}@fixture.test`, role: "user" })}`;
  type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const call = async (handler: unknown, url: string, method: string, body?: unknown) => {
    const res = await (handler as Handler)(new NextRequest(`http://localhost${url}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json().catch(() => null)) as Rec | null };
  };
  const zebraEntry = (tag: string) => ({ codes: [`ZB-${tag}`], fabric: "3 4/16", silk: "2 3/16", noteZh: tag });
  const putZebra = (tag: string) => call(zebraRoute.PUT, "/api/sunny-process/zebra-ratios", "PUT", { orgId: ORG, entries: [zebraEntry(tag)] });
  const seed = rec((await call(warrantyRoute.GET, `/api/install/warranty-settings?orgId=${ORG}`, "GET")).body?.settings);
  const putWarranty = (tag: string) => call(warrantyRoute.PUT, "/api/install/warranty-settings", "PUT", { orgId: ORG, settings: { ...seed, contact: { ...rec(seed.contact), phone: `416-555-${tag}` } } });
  const settings = async () => rec((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson);
  const zebraNote = async () => readZebraRatios(await settings()).entries[0]?.noteZh ?? null;
  const warrantyPhone = async () => String(rec(readWarrantySettings(await settings()).settings.contact).phone ?? "");
  const timed = async <T,>(f: () => Promise<T>) => { const t = Date.now(); const value = await f(); return { ms: Date.now() - t, value }; };
  const AI = "MONTHLY_AI_COST" as const, RUNS = "DAILY_AGENT_RUNS" as const, IMAGES = "DAILY_IMAGE_GENERATIONS" as const;
  const mkPolicy = (metric: typeof AI | typeof RUNS | typeof IMAGES, hardLimit: number) => createQuotaPolicy({ orgId: ORG, userId: BOSS, metric, period: metric === AI ? "MONTHLY" : "DAILY", hardLimit });

  try {
    // —— 0. 先各调一次：接口能用（也让模块与连接热起来，后面量时间才准） ——
    const z0 = await putZebra("warm"), w0 = await putWarranty("0100");
    const p0 = await mkPolicy(AI, 100);
    ok(z0.status === 200 && w0.status === 200 && (await zebraNote()) === "warm" && (await warrantyPhone()) === "416-555-0100" && p0.version === 1, "三处各保存一次：都成功，内容在库里", { z0, w0, version: p0.version });
    ok(rec((await settings()).untouched).keep === "me", "原有的别的设置项没有被动过");

    // —— 1. 有人刚往本组织插入了一条记录还没提交：这三处不用等 ——
    {
      let started!: () => void;
      const ready = new Promise<void>((r) => { started = r; });
      const holder = db.$transaction(async (tx) => {
        await tx.auditLog.create({ data: { userId: BOSS, orgId: ORG, action: "fixture.fk_probe", targetType: "fixture" } });
        started();
        await sleep(HOLD_MS);
      }, { timeout: 15_000 });
      await ready;
      const [z, w, c, p] = await Promise.all([
        timed(() => putZebra("fk")),
        timed(() => putWarranty("0101")),
        timed(() => mkPolicy(RUNS, 50)),
        timed(() => patchQuotaPolicy({ orgId: ORG, userId: BOSS, id: p0.id, expectedVersion: 1, hardLimit: 90 })),
      ]);
      await holder;
      ok(z.value.status === 200 && z.ms < FAST_MS, `有人往本组织插入了一条审计还没提交：保存斑马帘比例不用等（${z.ms} ms）`, { ms: z.ms, status: z.value.status });
      ok(w.value.status === 200 && w.ms < FAST_MS, `同上：保存质保设置不用等（${w.ms} ms）`, { ms: w.ms, status: w.value.status });
      ok(c.value.version === 1 && c.ms < FAST_MS, `同上：新建一条配额策略不用等（${c.ms} ms）`, { ms: c.ms });
      ok(p.value.version === 2 && p.ms < FAST_MS, `同上：修改一条配额策略不用等（${p.ms} ms）`, { ms: p.ms });
      ok((await zebraNote()) === "fk" && (await warrantyPhone()) === "416-555-0101", "两处保存的内容都在");
    }

    // —— 2. 有人拿着组织行的锁：这三处要等它放开（写入方之间仍然互斥） ——
    {
      let started!: () => void;
      const ready = new Promise<void>((r) => { started = r; });
      const holder = db.$transaction(async (tx) => {
        await lockOrganizationRow(tx, ORG);
        const cur = await tx.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
        await tx.organization.update({ where: { id: ORG }, data: { settingsJson: { ...rec(cur?.settingsJson), heldOnce: true } } });
        started();
        await sleep(HOLD_MS);
      }, { timeout: 15_000 });
      await ready;
      const [z, w, c] = await Promise.all([timed(() => putZebra("held")), timed(() => putWarranty("0102")), timed(() => mkPolicy(IMAGES, 1000))]);
      await holder;
      const s = await settings();
      // 两个保存即使没锁行，也会在自己 UPDATE 组织行时被对方挡住——等待时间只对「新建配额策略」有区分力；
      // 两个保存有没有在读之前锁行，看下一条：拿锁那一方写的键还在不在（没锁行的话，它是在对方提交之前读的，会把对方写的冲掉）
      ok(z.ms >= FAST_MS && w.ms >= FAST_MS && c.ms >= FAST_MS, `有人拿着组织行的锁 0.9 秒：三处都等到它放开（${z.ms} / ${w.ms} / ${c.ms} ms）`, { z: z.ms, w: w.ms, c: c.ms });
      ok(z.value.status === 200 && w.value.status === 200 && s.heldOnce === true && (await zebraNote()) === "held" && (await warrantyPhone()) === "416-555-0102", "等完之后都成功，拿锁那一方写的、这两处写的都在（没有互相覆盖）", Object.keys(s));
    }

    // —— 3. 这两处与别的设置写入同时进行：互不覆盖 ——
    {
      const ROUNDS = 10;
      const lost: string[] = [];
      for (let r = 0; r < ROUNDS; r++) {
        const phone = String(2000 + r);
        const results = await Promise.all([putZebra(`r${r}`), putWarranty(phone), mutateOrgSettings(ORG, (cur) => ({ next: { ...rec(cur), [`other_${r}`]: r }, result: null }))]);
        const s = await settings();
        if (results[0].status !== 200 || results[1].status !== 200) lost.push(`round ${r}: status ${results[0].status}/${results[1].status}`);
        if ((await zebraNote()) !== `r${r}`) lost.push(`round ${r}: zebra`);
        if ((await warrantyPhone()) !== `416-555-${phone}`) lost.push(`round ${r}: warranty`);
        for (let k = 0; k <= r; k++) if (s[`other_${k}`] !== k) lost.push(`round ${r}: other_${k}`);
      }
      ok(lost.length === 0, `保存斑马帘比例、保存质保设置、另一处写入一个新的键同时进行 ${ROUNDS} 轮：每一轮三项都在，之前各轮写的键也都在`, lost.slice(0, 12));
      ok(rec((await settings()).untouched).keep === "me", "原有的别的设置项始终没有被动过");
    }

    // —— 4. 与「先插入一条本组织的记录、再锁行写设置」的事务同时进行：没有请求失败 ——
    // 回归检查：这一段在改动之前（三处还是 FOR UPDATE 时）同样通过——这三处锁行之后只再插入审计或写策略行，
    // 与这类事务没有拿锁顺序上的颠倒，造不出死锁。留着是防以后有人在锁行之后再去动别的会被对方先锁住的行。
    {
      const ROUNDS = 6, CROSSERS = 6;
      const failures: string[] = [];
      for (let r = 0; r < ROUNDS; r++) {
        const crossers = Array.from({ length: CROSSERS }, (_, i) =>
          db.$transaction(async (tx) => {
            await tx.auditLog.create({ data: { userId: BOSS, orgId: ORG, action: "fixture.fk_probe", targetType: "fixture" } });
            await sleep(20);
            await lockOrganizationRow(tx, ORG);
            const cur = await tx.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
            await tx.organization.update({ where: { id: ORG }, data: { settingsJson: { ...rec(cur?.settingsJson), [`crossed_${r}_${i}`]: true } } });
          }, { timeout: 15_000 }),
        );
        const settled = await Promise.allSettled([...crossers, putZebra(`x${r}`), putWarranty(String(3000 + r)), mkPolicy(AI, 200 + r)]);
        settled.forEach((x, i) => {
          if (x.status === "rejected") failures.push(`round ${r} #${i}: ${String(x.reason).slice(0, 160)}`);
          else if (i >= CROSSERS && i < CROSSERS + 2 && (x.value as { status: number }).status !== 200) failures.push(`round ${r} #${i}: status ${(x.value as { status: number }).status}`);
        });
        const s = await settings();
        for (let i = 0; i < CROSSERS; i++) if (s[`crossed_${r}_${i}`] !== true) failures.push(`round ${r}: crossed_${i} lost`);
        if ((await zebraNote()) !== `x${r}`) failures.push(`round ${r}: zebra lost`);
        if ((await warrantyPhone()) !== `416-555-${3000 + r}`) failures.push(`round ${r}: warranty lost`);
      }
      ok(failures.length === 0, `${CROSSERS} 个「先插入、再锁行写设置」的事务与三处保存同时进行 ${ROUNDS} 轮：没有请求失败（没有死锁）、每一轮的修改都在`, failures.slice(0, 10));
    }

    // —— 5. 配额策略的写入仍然串行 ——
    {
      const metric = RUNS; // 目前只有第 1 步建的那一条（version 1）
      const created = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => mkPolicy(metric, 60 + i)));
      const rows = await db.capabilityQuotaPolicy.findMany({ where: { orgId: ORG, workspaceId: null, metric }, orderBy: { version: "asc" }, select: { id: true, version: true, enabled: true } });
      ok(created.every((c) => c.status === "fulfilled") && rows.map((x) => x.version).join() === "1,2,3,4,5,6" && rows.filter((x) => x.enabled).length === 1 && rows[rows.length - 1].enabled, "同一项指标同时新建 5 条（加上已有的 1 条）：版本号是连续的 1 到 6，只有最新的一条生效", rows);
      const latest = rows[rows.length - 1];
      const patched = await Promise.allSettled([
        patchQuotaPolicy({ orgId: ORG, userId: BOSS, id: latest.id, expectedVersion: latest.version, hardLimit: 71 }),
        patchQuotaPolicy({ orgId: ORG, userId: BOSS, id: latest.id, expectedVersion: latest.version, hardLimit: 72 }),
      ]);
      const won = patched.filter((x) => x.status === "fulfilled").length;
      const conflicts = patched.filter((x) => x.status === "rejected" && (x.reason as { code?: string })?.code === "version_conflict").length;
      const after = await db.capabilityQuotaPolicy.findMany({ where: { orgId: ORG, workspaceId: null, metric }, orderBy: { version: "asc" }, select: { version: true, enabled: true } });
      ok(won === 1 && conflicts === 1 && after.map((x) => x.version).join() === "1,2,3,4,5,6,7" && after.filter((x) => x.enabled).length === 1, "同时对同一条策略提交两次修改：一成一败（版本冲突），只多出一个版本", { won, conflicts, after });
    }
  } finally {
    await db.capabilityQuotaPolicy.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: BOSS }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: BOSS } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nFIX-4 org row lock DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
