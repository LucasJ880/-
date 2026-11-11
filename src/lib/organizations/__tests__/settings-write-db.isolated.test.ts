/**
 * FIX-3 组织设置的并发写入互不覆盖——真实 DB（隔离库），调用真实的写入方
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/organizations/__tests__/settings-write-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商）。不发任何邮件，不调任何外部接口。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-3 组织设置并发写入 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-3 org settings write DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { mutateOrgSettings, mutateOrgSettingsInTx, lockOrganizationRow } = await import("../settings-write");
  const { updateOnboardingSettings } = await import("../onboarding");
  const { saveDiscountsForOrg, readJsonDiscounts } = await import("@/lib/blinds/discount-settings");
  const { defaultInboundSyncDeps, readInboundCursor } = await import("@/lib/tender-rfq/inbound-sync");
  const { learnSupplierPreference, updateUserPrefs, saveUserPrefs, loadUserPrefs } = await import("@/lib/muse-bridge/prefs");
  const { applyPreference, readUserPrefs } = await import("@/lib/muse-bridge/prefs-pure");
  const { setMuseBinding } = await import("@/lib/muse-bridge/binding");
  const { readMuseBindings } = await import("@/lib/muse-bridge/binding-pure");
  const { saveTenderProfile, getTenderProfile } = await import("@/lib/tender-profile/store");
  const { setPlaybookEnforcementMode } = await import("@/lib/operations/playbook/enforcement");
  const { saveCalendarWatchSettings } = await import("@/lib/calendar-watch/settings");
  const { readCalendarWatch } = await import("@/lib/calendar-watch/pure");
  const { readTenderRfqSettings } = await import("@/lib/tender-rfq/round-pure");
  const rfqSettingsRoute = await import("@/app/api/organizations/[orgId]/tender-rfq-settings/route");

  console.log("FIX-3 org settings write — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `swowner_${stamp}`, OTHER = `swother_${stamp}`, ORG = `sworg_${stamp}`, PROJECT = `swproj_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const supplierIds: string[] = [];

  for (const id of [OWNER, OTHER]) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `sw-${stamp}`, ownerId: OWNER, settingsJson: { untouched: { keep: "me" } } } });
  for (const id of [OWNER, OTHER]) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_admin", status: "active" } });
  await db.project.create({ data: { id: PROJECT, name: `Fixture Tender ${stamp}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });
  for (let i = 0; i < 24; i++) {
    const s = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${i} ${stamp}`, contactEmail: `s${i}-${stamp}@supplier.test`, status: "active", createdById: OWNER } });
    supplierIds.push(s.id);
  }
  const settings = async (): Promise<Rec> => rec((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson);
  const cookie = `qy_session=${await createSession({ sub: OWNER, email: email(OWNER), role: "user" })}`;
  const putRfqSettings = async (body: unknown) => {
    const res = await rfqSettingsRoute.PUT(
      new NextRequest(`http://localhost/api/organizations/${ORG}/tender-rfq-settings`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    return { status: res.status, json: (await res.json().catch(() => null)) as Rec | null };
  };

  try {
    // —— 1. 对照：不加锁的「读出整块、改一个键、整块写回」并发时会丢 ——
    const naive = async (key: string) => {
      const org = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
      await db.organization.update({ where: { id: ORG }, data: { settingsJson: { ...rec(org?.settingsJson), [key]: 1 } } });
    };
    const KEYS = Array.from({ length: 12 }, (_, i) => `naive_${i}`);
    await Promise.all(KEYS.map(naive));
    const afterNaive = await settings();
    const naiveKept = KEYS.filter((k) => k in afterNaive).length;
    ok(naiveKept < KEYS.length, `对照：不加锁的写法并发写 12 个不同的键，只留下了 ${naiveKept} 个（这就是要修的问题）`, { naiveKept });

    // —— 2. 统一入口：12 个并发写入全部保留 ——
    const LOCKED = Array.from({ length: 12 }, (_, i) => `locked_${i}`);
    const results = await Promise.all(LOCKED.map((k) => mutateOrgSettings(ORG, (cur) => ({ next: { ...rec(cur), [k]: 1 }, result: k }))));
    const afterLocked = await settings();
    ok(LOCKED.every((k) => k in afterLocked) && results.every((r) => r.found && r.written), "统一入口：并发写 12 个不同的键，12 个都在", LOCKED.filter((k) => !(k in afterLocked)));
    ok(rec(afterLocked.untouched).keep === "me", "原有的、没人改的键原样保留");
    const noWrite = await mutateOrgSettings(ORG, () => ({ result: "skip" }));
    ok(noWrite.found && !noWrite.written && noWrite.result === "skip" && JSON.stringify(await settings()) === JSON.stringify(afterLocked), "不给新的内容 = 不写：设置逐字节不变");
    const missing = await mutateOrgSettings(`no_such_org_${stamp}`, (cur) => ({ next: cur, result: 1 }));
    ok(missing.found === false, "组织不存在：返回未找到，不抛错、不新建");
    const counter = await Promise.all(Array.from({ length: 20 }, () => mutateOrgSettings(ORG, (cur) => ({ next: { ...rec(cur), counter: (Number(rec(cur).counter) || 0) + 1 }, result: null }))));
    ok(counter.every((r) => r.found) && (await settings()).counter === 20, "同一个键的 20 次并发「在当前值上加一」：结果是 20（每一次都基于上一次的结果）", (await settings()).counter);

    // —— 3. 七种真实的写入方同时进行，重复多轮：每一项都是自己写入的值 ——
    const deps = await defaultInboundSyncDeps();
    const ROUNDS = 12;
    const lost: string[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const cursor = { historyId: `h${r}`, lastSyncAt: new Date(Date.UTC(2026, 10, 12, 0, r)).toISOString() };
      const mode = r % 2 === 0 ? ("enforce" as const) : ("warn" as const);
      const outcomes = await Promise.all([
        deps.saveCursor(ORG, cursor),
        learnSupplierPreference({ projectId: PROJECT, userId: OWNER, supplierId: supplierIds[r] }),
        setMuseBinding({ orgId: ORG, museUserRef: `muse_${r}`, userId: OTHER, actorUserId: OWNER }),
        putRfqSettings({ fromName: `Purchasing ${r}` }),
        saveTenderProfile(ORG, { positioning: `positioning ${r}` }),
        setPlaybookEnforcementMode(ORG, mode),
        saveCalendarWatchSettings({ orgId: ORG, actorUserId: OWNER, body: { websiteMarkers: [`Marker ${r}`] } }),
      ]);
      const s = await settings();
      const check: Array<[string, boolean]> = [
        ["收信游标", readInboundCursor(s)?.historyId === cursor.historyId],
        ["常用供应商（学习）", readUserPrefs(s, OWNER).defaultSupplierIds[0] === supplierIds[r]],
        ["Muse 绑定", readMuseBindings(s)[`muse_${r}`]?.userId === OTHER],
        ["询价设置", readTenderRfqSettings(s).fromName === `Purchasing ${r}` && (outcomes[3] as { status: number }).status === 200],
        ["投标资料", rec(s.tenderProfile).positioning === `positioning ${r}`],
        ["运营手册执行模式", s.playbookEnforcementMode === mode],
        ["日历监听设置", readCalendarWatch(s).websiteMarkers.join() === `Marker ${r}` && (outcomes[6] as { ok: boolean }).ok === true],
      ];
      for (const [name, good] of check) if (!good) lost.push(`第 ${r + 1} 轮：${name}`);
    }
    ok(lost.length === 0, `七种写入方同时进行 ${ROUNDS} 轮：每一轮七项都是各自写入的值，没有一项被别的写入冲掉`, lost.slice(0, 12));
    const sAfter = await settings();
    ok(Object.keys(readMuseBindings(sAfter)).filter((k) => k.startsWith("muse_")).length === ROUNDS && LOCKED.every((k) => k in sAfter) && rec(sAfter.untouched).keep === "me", `${ROUNDS} 轮下来：每一轮的 Muse 绑定都还在，更早写入的键也都在`);

    // —— 4. 同一项的并发修改：在最新内容上依次生效 ——
    await saveUserPrefs(ORG, OTHER, { defaultSupplierIds: [], defaultIncoterm: null, chaseAfterDays: null, lastUpdatedAt: null });
    const four = supplierIds.slice(12, 16);
    await Promise.all(four.map((supplierId) => learnSupplierPreference({ projectId: PROJECT, userId: OTHER, supplierId })));
    const learned = (await loadUserPrefs(ORG, OTHER)).defaultSupplierIds;
    ok(learned.length === 4 && four.every((id) => learned.includes(id)), "同一个人同时选定了 4 家供应商：4 家都进了他的常用供应商", learned);
    // Muse set_preference 走的就是这一步：在锁里对最新的偏好再应用这项修改
    const now = new Date();
    const newSupplier = supplierIds[20];
    await Promise.all([
      updateUserPrefs(ORG, OTHER, (fresh) => { const a = applyPreference(fresh, "defaultIncoterm", "DDP", now); return a.ok ? a.prefs : fresh; }),
      learnSupplierPreference({ projectId: PROJECT, userId: OTHER, supplierId: newSupplier }),
      updateUserPrefs(ORG, OTHER, (fresh) => { const a = applyPreference(fresh, "chaseAfterDays", 4, now); return a.ok ? a.prefs : fresh; }),
    ]);
    const both = await loadUserPrefs(ORG, OTHER);
    ok(both.defaultIncoterm === "DDP" && both.chaseAfterDays === 4 && both.defaultSupplierIds[0] === newSupplier && four.every((id) => both.defaultSupplierIds.includes(id)), "同一个人的「设置贸易条款」「设置催单天数」与「自动学习供应商」同时发生：三项都保留，先前学到的 4 家也在", both);
    ok(readUserPrefs(await settings(), OWNER).defaultSupplierIds.length > 0, "另一个人的偏好没有受影响");
    const unchanged = JSON.stringify(await settings());
    const same = await updateUserPrefs(ORG, OTHER, (fresh) => fresh);
    ok(same?.defaultIncoterm === "DDP" && JSON.stringify(await settings()) === unchanged, "修改函数原样返回 = 不写");
    ok((await updateUserPrefs(`no_such_org_${stamp}`, OTHER, (p) => ({ ...p, chaseAfterDays: 9 }))) === null, "组织不存在：返回空，不抛错");

    // —— 5. 询价设置接口：对外行为不变 ——
    const beforeBad = JSON.stringify(await settings());
    const bad = await putRfqSettings({ fromEmail: "not-an-email" });
    ok(bad.status === 400 && JSON.stringify(await settings()) === beforeBad, "询价设置内容不合规：400，设置没有被改", bad);
    const fxBad = await putRfqSettings({ landedCost: { fxRates: { CNY: 0.19 } } });
    ok(fxBad.status === 400 && JSON.stringify(await settings()) === beforeBad, "汇率不带日期与来源（在最新设置上校验不通过）：400，设置没有被改", fxBad);
    const good = await putRfqSettings({ fromName: "Final Purchasing", fromEmail: `Project_${stamp}@Fixture.Test` });
    const audit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "tender_rfq_settings:update" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const a = { before: rec(rec(JSON.parse(audit?.beforeData ?? "{}")).tenderRfq), after: rec(rec(JSON.parse(audit?.afterData ?? "{}")).tenderRfq) };
    ok(good.status === 200 && readTenderRfqSettings(await settings()).fromName === "Final Purchasing" && readTenderRfqSettings(await settings()).fromEmail === `project_${stamp}@fixture.test`, "询价设置内容合规：200，写入（邮箱照旧转小写）", good.json);
    ok(a.before.fromName === `Purchasing ${ROUNDS - 1}` && a.after.fromName === "Final Purchasing", "审计里记着保存前后的询价设置（保存前取的是锁里读到的最新内容）", a);
    ok((await getTenderProfile(ORG))?.positioning === `positioning ${ROUNDS - 1}` && readInboundCursor(await settings())?.historyId === `h${ROUNDS - 1}`, "保存询价设置没有动投标资料与收信游标");

    // —— 6. 组织不存在时各写入方的既有处理 ——
    const ghost = `no_such_org_${stamp}`;
    const bindGhost = await setMuseBinding({ orgId: ghost, museUserRef: "x", userId: null, actorUserId: OWNER });
    ok(!bindGhost.ok && bindGhost.error === "组织不存在", "绑定 Muse 账号：组织不存在 → 照旧返回「组织不存在」");
    let threw = 0;
    for (const f of [() => saveTenderProfile(ghost, { positioning: "x" }), () => setPlaybookEnforcementMode(ghost, "warn")]) {
      try { await f(); } catch { threw++; }
    }
    ok(threw === 2, "保存投标资料 / 切换执行模式：组织不存在 → 照旧抛错");
    let quiet = true;
    try { await saveUserPrefs(ghost, OWNER, await loadUserPrefs(ORG, OWNER)); } catch { quiet = false; }
    let cursorThrew = false;
    try { await deps.saveCursor(ghost, { historyId: "x", lastSyncAt: new Date().toISOString() }); } catch { cursorThrew = true; }
    ok(quiet && cursorThrew && (await db.organization.count({ where: { id: ghost } })) === 0, "组织不存在：保存偏好照旧不抛错，回写游标照旧抛错；都不会新建组织");
    const calGhost = await saveCalendarWatchSettings({ orgId: ghost, actorUserId: OWNER, body: { websiteMarkers: ["x"] } });
    ok(!calGhost.ok && calGhost.status === 404, "保存日历监听设置：组织不存在 → 照旧 404");

    // —— 7. 在自己事务里锁行的写入方（开户更新设置、门店折扣）与别的写入同时进行 ——
    const lost7: string[] = [];
    const ROUNDS7 = 10;
    for (let r = 0; r < ROUNDS7; r++) {
      const pct = (10 + r) / 100;
      await Promise.all([
        updateOnboardingSettings(ORG, { acknowledge: { [`step_${r}`]: true } }, OWNER),
        saveDiscountsForOrg({ orgId: ORG, userId: OWNER, patch: { fauxwood: pct } as never }),
        mutateOrgSettings(ORG, (cur) => ({ next: { ...rec(cur), [`mix_${r}`]: r }, result: null })),
        setMuseBinding({ orgId: ORG, museUserRef: `mix_muse_${r}`, userId: OTHER, actorUserId: OWNER }),
        saveTenderProfile(ORG, { positioning: `mix ${r}` }),
      ]);
      const s = await settings();
      const acks = rec(rec(s.onboarding).acknowledgements);
      const check: Array<[string, boolean]> = [
        ["开户确认", `step_${r}` in acks && Array.from({ length: r }, (_, i) => `step_${i}`).every((k) => k in acks)],
        ["门店折扣", readJsonDiscounts(s).fauxwood === pct],
        ["入口写的键", s[`mix_${r}`] === r],
        ["Muse 绑定", readMuseBindings(s)[`mix_muse_${r}`]?.userId === OTHER],
        ["投标资料", rec(s.tenderProfile).positioning === `mix ${r}`],
      ];
      for (const [name, good] of check) if (!good) lost7.push(`第 ${r + 1} 轮：${name}`);
    }
    ok(lost7.length === 0, `开户更新设置、门店折扣与另外三种写入同时进行 ${ROUNDS7} 轮：每一轮五项都在，之前各轮的开户确认也都在`, lost7.slice(0, 12));
    const obAudit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "onboarding.org.update" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const obBefore = rec(rec(JSON.parse(obAudit?.beforeData ?? "{}")).acknowledgements);
    const obAfter = rec(rec(JSON.parse(obAudit?.afterData ?? "{}")).acknowledgements);
    ok(Object.keys(obAfter).length === Object.keys(obBefore).length + 1, "开户更新设置的审计：「之前」与「之后」取自同一次读写，只差这一次确认的那一步", { before: Object.keys(obBefore).length, after: Object.keys(obAfter).length });

    // —— 8. 锁的强度：不与「插入一条本组织的记录」互相阻塞，也不因此死锁 ——
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const timed = async (f: () => Promise<unknown>) => { const t = Date.now(); await f(); return Date.now() - t; };
    let lockHeld!: () => void;
    const held = new Promise<void>((r) => { lockHeld = r; });
    const holder = db.$transaction(async (tx) => {
      await mutateOrgSettingsInTx(tx, ORG, (cur) => ({ next: { ...rec(cur), heldOnce: true }, result: null }));
      lockHeld();
      await sleep(900); // 拿着锁不放 0.9 秒
    });
    await held;
    const [insertMs, userMs, writerMs] = await Promise.all([
      timed(() => db.auditLog.create({ data: { userId: OWNER, orgId: ORG, action: "fixture.fk_probe", targetType: "fixture" } })),
      timed(() => db.user.update({ where: { id: OTHER }, data: { activeOrgId: ORG } })),
      timed(() => mutateOrgSettings(ORG, (cur) => ({ next: { ...rec(cur), afterHeld: true }, result: null }))),
    ]);
    await holder;
    ok(insertMs < 500 && userMs < 500, `有人拿着设置的锁时：往本组织插入一条记录、把用户的当前组织切到它，都不用等（${insertMs} ms / ${userMs} ms）`, { insertMs, userMs });
    ok(writerMs >= 500 && (await settings()).afterHeld === true && (await settings()).heldOnce === true, `而另一处设置写入要等它放锁（等了 ${writerMs} ms），之后两处的修改都在`, { writerMs });
    const crossed = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        db.$transaction(async (tx) => {
          await tx.auditLog.create({ data: { userId: OWNER, orgId: ORG, action: "fixture.fk_probe", targetType: "fixture" } });
          await sleep(20);
          await lockOrganizationRow(tx, ORG);
          const cur = await tx.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
          await tx.organization.update({ where: { id: ORG }, data: { settingsJson: { ...rec(cur?.settingsJson), [`crossed_${i}`]: true } } });
        }),
      ),
    );
    const sCrossed = await settings();
    ok(crossed.every((c) => c.status === "fulfilled") && Array.from({ length: 8 }, (_, i) => `crossed_${i}`).every((k) => k in sCrossed), "8 个事务各自先插入一条本组织的记录、再锁行写设置：没有死锁，8 处修改都在", crossed.filter((c) => c.status === "rejected").map((c) => String((c as PromiseRejectedResult).reason).slice(0, 160)));
  } finally {
    await db.user.updateMany({ where: { id: { in: [OWNER, OTHER] } }, data: { activeOrgId: null } });
    await db.quoteDiscountSettings.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: [OWNER, OTHER] } }] } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.project.deleteMany({ where: { id: PROJECT } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-3 org settings write DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
