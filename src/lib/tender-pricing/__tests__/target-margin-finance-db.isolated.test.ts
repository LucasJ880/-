/**
 * FIX-25 目标毛利只给有财务查看权的人——真实 DB（隔离库），调用真实路由
 *
 * 复现 CHAIN-2d 交叉验证 F4：房间存成本 87,654.32、目标毛利 23.7、报价引擎镜像的我方报价 114,881.15
 * （= 87,654.32 ÷ (1 − 0.237)，项目 ourBidPrice 同值）。改动前只读成员从调查室读取拿到 targetMarginPct 与 ourPriceCad，
 * 114,881.15 × (1 − 0.237) = 87,654.32。改动后：没有财务查看权的人在调查室、项目列表、报价表助手、项目详情四个接口
 * 都拿不到目标毛利，也改不了它；有财务查看权的人在报价表助手照旧。
 * 多审补强（T1–T6、T9、P7）：组织负责人、项目级 accounting / operator 角色；org_admin 与组织负责人的保存；与库里相同的目标毛利同样 403；
 * 响应键白名单；接口层不泄露填没填；读取在比价成本来源开关关、开下各跑一遍；负责人读两个房间 JSON 接口也搜一遍。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口，不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-25 目标毛利财务查看权 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-25 target margin finance DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

/** 复现数据（与交叉验证探针相同） */
const COST = 87654.32;
const MARGIN = 23.7;
const PRICE = Math.round((COST / (1 - MARGIN / 100)) * 100) / 100; // 114881.15，正好是「成本 + 目标毛利」底价
const DRAFT_NOTE = "FIXTURE内部注：按成本加二成报";
/** 已记成本来源里的落地价（少见数） */
const LANDED = 76543.21;
/** 在响应里搜的字样：目标毛利、成本、落地价、草稿内部注（不搜我方报价——它照旧对项目读者可见） */
const SECRET_STRINGS = ["23.7", "87654", "87,654", "76543", "76,543", "FIXTURE内部注"];
/** 403 那句（写字面量，不从源码取，免得自证） */
const EXPECTED_403 = "没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。";
/** 没有财务查看权的人读报价表助手时响应顶层只能有这些键（多审 T5） */
const HELPER_TOP_KEYS = ["runId", "model", "modelOrigin", "benchmark", "inputs", "result", "costHidden", "compareCostHidden", "note"];
/** 去掉时间戳再搜（时间戳里的数字与本测试无关） */
const stripTs = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "");
const noSecretIn = (text: string) => SECRET_STRINGS.every((s) => !stripTs(text).includes(s));

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { PRICING_MODEL_VERSION, buildScenarios } = await import("@/lib/tender-pricing/calc");
  const helperRoute = await import("@/app/api/projects/[id]/pricing-helper/route");
  const roomRoute = await import("@/app/api/projects/[id]/bid-intelligence/route");
  const listRoute = await import("@/app/api/projects/route");
  const detailRoute = await import("@/app/api/projects/[id]/route");

  console.log("FIX-25 target margin finance view — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `tm${k}_${stamp}`;
  const ORG_OWNER = id("orgowner"), OWNER = id("owner"), VIEWER = id("viewer"), EDITOR = id("editor"), ADMIN = id("admin");
  const BIDS = id("bids"), FINREAD = id("finread"), SUPER = id("super"), ORGMEM = id("orgmem"), PACC = id("pacc"), POPER = id("poper");
  const users = [ORG_OWNER, OWNER, VIEWER, EDITOR, ADMIN, BIDS, FINREAD, SUPER, ORGMEM, PACC, POPER];
  const ORG = id("org");
  const email = (u: string) => `${u}@fixture.test`;

  for (const u of users) {
    await db.user.create({ data: { id: u, email: email(u), name: `Fixture ${u}`, role: u === SUPER ? "super_admin" : "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `tm-${stamp}`, ownerId: ORG_OWNER, industryPackId: "window_covering_services_v1" } });
  for (const u of [ORG_OWNER, OWNER, VIEWER, EDITOR, BIDS, FINREAD, ORGMEM, PACC, POPER]) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: u === ORG_OWNER ? "org_owner" : "org_member", status: "active" } });
  }
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺少岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  await bind(BIDS, "bids"); // project.finance.read 只在 ASSIGNED 范围
  await bind(FINREAD, "accounting"); // project.finance.read 在 ORG 范围

  const projectIds: string[] = [];
  let seq = 0;
  const model = { version: PRICING_MODEL_VERSION, priceWeightPct: 60, costFormula: "lowest_over_bid" as const, otherCriteria: [], source: "HUMAN" as const, evidenceZh: [], derivedAt: "2026-11-23T00:00:00.000Z" };
  const costSource = { kind: "rfq_compare", inquiryId: "inq_fixture", inquiryItemId: "item_fixture", roundNumber: 2, supplierName: "Fixture Supplier", landedCadTotal: LANDED, quantityBasis: { kind: "first_tier", qty: 1500 }, recordedAt: "2026-11-23T00:00:00.000Z" };
  const pricingInputs: Rec = {
    competitorPriceCad: 100000, ourCostCad: COST, targetMarginPct: MARGIN, ourCostSource: costSource,
    ourPriceCad: PRICE, ourPrice: PRICE, ourPriceCurrency: "CAD", ourPriceSource: "quote:q_fixture:v1", ourPriceStatus: "AUTHORITATIVE",
  };
  async function mkProject(withRoom: boolean, pi: Rec = pricingInputs) {
    seq += 1;
    const pid = `tmproj_${stamp}_${seq}`;
    projectIds.push(pid);
    await db.project.create({ data: { id: pid, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active", ourBidPrice: PRICE, currency: "CAD" } as never });
    for (const [u, role] of [[VIEWER, "viewer"], [EDITOR, "project_admin"], [BIDS, "viewer"], [FINREAD, "project_admin"], [PACC, "accounting"], [POPER, "operator"]] as const) {
      await db.projectMember.create({ data: { projectId: pid, userId: u, role, status: "active" } });
    }
    if (withRoom) {
      await db.bidIntelligenceRoom.create({
        data: {
          orgId: ORG, projectId: pid,
          summaryJson: {
            pricingModel: model, pricingInputs: pi, otherFeature: { keep: true },
            bidDraft: { version: "fixture", generatedAt: "2026-11-23T00:00:00.000Z", toConfirm: 0, internalNotesZh: [DRAFT_NOTE] },
            bidStrategyMemo: { pricingStrategyZh: `按成本 ${COST} 加目标毛利 ${MARGIN}% 定价` },
            majorBlockers: ["fixture blocker"],
          } as never,
        },
      });
    }
    return pid;
  }

  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: userId === SUPER ? "super_admin" : "user" })}`;
  const call = async (res: Response) => { const text = await res.text(); return { status: res.status, text, body: rec(JSON.parse(text || "null")), raw: JSON.parse(text || "null") as unknown }; };
  const getHelper = async (pid: string, u: string) => call(await helperRoute.GET(new NextRequest(`http://localhost/api/projects/${pid}/pricing-helper`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({ id: pid }) }));
  const postHelper = async (pid: string, body: unknown, u: string) => call(await helperRoute.POST(new NextRequest(`http://localhost/api/projects/${pid}/pricing-helper`, { method: "POST", headers: { cookie: await cookieOf(u), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: pid }) }));
  const getRoom = async (pid: string, u: string) => call(await roomRoute.GET(new NextRequest(`http://localhost/api/projects/${pid}/bid-intelligence`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({ id: pid }) }));
  const getList = async (u: string) => call(await listRoute.GET(new NextRequest(`http://localhost/api/projects`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({}) } as never));
  const getDetail = async (pid: string, u: string) => call(await detailRoute.GET(new NextRequest(`http://localhost/api/projects/${pid}`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({ id: pid }) }));
  const roomSj = async (pid: string) => rec((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: pid }, select: { summaryJson: true } })).summaryJson);
  const listItem = (raw: unknown, pid: string) => (Array.isArray(raw) ? (raw as Rec[]).find((p) => p.id === pid) : undefined);

  const prevFlag = process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
  try {
    /* ---------- 0. 夹具 ---------- */
    ok(PRICE === 114881.15 && Math.round(PRICE * (1 - MARGIN / 100) * 100) / 100 === COST, "夹具：报价 114,881.15 × (1 − 0.237) 正好是成本 87,654.32（反推前提成立）");
    const noCostScenarios = JSON.stringify(buildScenarios(model, { competitorPriceCad: 100000, ourCostCad: null, targetMarginPct: null }));
    ok(noSecretIn(noCostScenarios), "夹具：评分模型与对手价算出的情景里本来就没有这几个字样（后面搜到就是漏）", noCostScenarios.slice(0, 300));
    const P = await mkProject(true);
    // 对照项目：成本、目标毛利、成本来源都没填（多审 T6：接口层不泄露填没填）
    const P0 = await mkProject(true, { competitorPriceCad: 100000 });
    const before = JSON.stringify(await roomSj(P));

    const nonFinance = [
      [VIEWER, "只读成员"], [EDITOR, "项目编辑者"], [ADMIN, "org_admin（无财务键、不是项目成员）"], [BIDS, "投标岗（ASSIGNED 范围的 finance.read）"],
      [ORG_OWNER, "组织负责人 org_owner（无财务键、不是项目成员）"], [PACC, "项目级 accounting 角色"], [POPER, "项目级 operator 角色"],
    ] as const;

    // 多审 T9：读取在比价成本来源开关关、开下各跑一遍
    for (const flag of ["0", "1"] as const) {
      process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = flag;
      const tag = `开关${flag === "1" ? "开" : "关"}`;

      /* ---------- 1. 没有财务查看权的项目读者：四个接口都拿不到目标毛利 ---------- */
      for (const [u, label] of nonFinance) {
        const h = await getHelper(P, u);
        const inputs = rec(h.body.inputs);
        ok(h.status === 200 && inputs.targetMarginPct === null && inputs.ourCostCad === null && inputs.competitorPriceCad === 100000 && h.body.costHidden === true && (flag === "1") === (h.body.compareCostHidden === true) && !("compareCost" in h.body), `${tag} ${label}读报价表助手：目标毛利与成本为 null、带 costHidden`, h.body.inputs);
        ok(Object.keys(h.body).every((k) => HELPER_TOP_KEYS.includes(k)) && Object.keys(inputs).sort().join() === "competitorPriceCad,ourCostCad,targetMarginPct", `${tag} ${label}读报价表助手：顶层键在白名单内、inputs 恰好三项`, Object.keys(h.body));
        const h0 = await getHelper(P0, u);
        ok(h0.status === 200 && h0.text === h.text, `${tag} ${label}读报价表助手：与成本、目标毛利都没填的项目逐字节相同（接口层不泄露填没填）`, [h0.text.slice(0, 200), h.text.slice(0, 200)]);
        const r = await getRoom(P, u);
        const rsj = rec(rec(r.body.room).summaryJson);
        ok(r.status === 200 && !("pricingInputs" in rsj) && !("bidDraft" in rsj) && !("bidStrategyMemo" in rsj) && Array.isArray(rsj.majorBlockers) && rec(rsj.pricingModel).priceWeightPct === 60 && rec(rsj.otherFeature).keep === true, `${tag} ${label}读调查室：summaryJson 没有 pricingInputs、bidDraft、备忘，其它键还在`, rsj);
        const l = await getList(u);
        const item = listItem(l.raw, P);
        const lsj = rec(rec(item?.intelligenceRoom).summaryJson);
        ok(l.status === 200 && !!item && item.ourBidPrice === PRICE && !("pricingInputs" in lsj) && !("bidDraft" in lsj) && !("bidStrategyMemo" in lsj) && Array.isArray(lsj.majorBlockers), `${tag} ${label}读项目列表：照旧带 ourBidPrice，summaryJson 没有 pricingInputs、bidDraft、备忘`, (item ?? l.text.slice(0, 300)));
        const d = await getDetail(P, u);
        ok(d.status === 200 && rec(d.body.project).ourBidPrice === PRICE, `${tag} ${label}读项目详情：照旧带 ourBidPrice`, d.text.slice(0, 300));
        const all = [h.text, r.text, JSON.stringify(item ?? {}), d.text].join("\n");
        ok(noSecretIn(all), `${tag} ${label}：四个响应里都搜不到目标毛利、成本、落地价与草稿内部注（由报价 × (1 − 目标毛利) 反推不成立）`, SECRET_STRINGS.filter((x) => stripTs(all).includes(x)));
      }

      /* ---------- 2. 本组织普通成员、不是项目成员：项目列表照样列出，另外三个 403 ---------- */
      {
        const l = await getList(ORGMEM);
        const item = listItem(l.raw, P);
        const lsj = rec(rec(item?.intelligenceRoom).summaryJson);
        ok(l.status === 200 && !!item && item.ourBidPrice === PRICE && !("pricingInputs" in lsj) && !("bidDraft" in lsj), `${tag} 本组织普通成员读项目列表：列出该项目、带 ourBidPrice、没有 pricingInputs 与 bidDraft`, (item ?? l.text.slice(0, 300)));
        const h = await getHelper(P, ORGMEM);
        const r = await getRoom(P, ORGMEM);
        const d = await getDetail(P, ORGMEM);
        ok(h.status === 403 && r.status === 403 && d.status === 403, `${tag} 本组织普通成员读报价表助手、调查室、项目详情：都 403`, [h.status, r.status, d.status]);
        ok(noSecretIn([l.text, h.text, r.text, d.text].join("\n")), `${tag} 本组织普通成员：整组响应里搜不到目标毛利、成本、落地价与草稿内部注`);
      }

      /* ---------- 3. 有财务查看权的三种人：报价表助手照旧给目标毛利，三人逐字节相同 ---------- */
      const seen: string[] = [];
      for (const [u, label] of [[OWNER, "项目负责人"], [FINREAD, "持 ORG 范围 finance.read 的成员"], [SUPER, "平台超级管理员"]] as const) {
        const h = await getHelper(P, u);
        seen.push(h.text);
        ok(h.status === 200 && rec(h.body.inputs).targetMarginPct === MARGIN && rec(h.body.inputs).ourCostCad === COST && !("costHidden" in h.body) && (((rec(h.body.result).scenarios as Rec[] | undefined) ?? []).some((x) => x.key === "floor")) && (flag === "1") === ("compareCost" in h.body), `${tag} ${label}读报价表助手：目标毛利 23.7、成本照旧、有底价情景、没有 costHidden`, h.body.inputs);
      }
      ok(seen.every((t) => t === seen[0]), `${tag} 三种有财务查看权的人拿到的报价表助手响应逐字节相同`);
      {
        const r = await getRoom(P, OWNER);
        const rsj = rec(rec(r.body.room).summaryJson);
        ok(r.status === 200 && !("pricingInputs" in rsj) && !("bidDraft" in rsj) && !("bidStrategyMemo" in rsj) && Array.isArray(rsj.majorBlockers) && rec(rsj.otherFeature).keep === true && noSecretIn(r.text), `${tag} 项目负责人读调查室：同样没有 pricingInputs、bidDraft、备忘（对所有人去掉），其它键还在，搜不到目标毛利与成本`, rsj);
        const l = await getList(OWNER);
        const item = listItem(l.raw, P);
        const lsj = rec(rec(item?.intelligenceRoom).summaryJson);
        ok(!!item && !("pricingInputs" in lsj) && !("bidDraft" in lsj) && !("bidStrategyMemo" in lsj) && Array.isArray(lsj.majorBlockers) && noSecretIn(JSON.stringify(item)), `${tag} 项目负责人读项目列表：同样没有 pricingInputs、bidDraft、备忘，其它键还在，搜不到目标毛利与成本`, (item ?? l.text.slice(0, 300)));
      }
    }
    if (prevFlag === undefined) delete process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
    else process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = prevFlag;
    ok(JSON.stringify(await roomSj(P)) === before, "以上读取都不改库");

    /* ---------- 4. 没有财务查看权的人保存 ---------- */
    const snap = JSON.stringify(await roomSj(P));
    const forbidden = [
      [{ action: "save", inputs: { competitorPriceCad: 100000, ourCostCad: 1 } }, "带 ourCostCad"],
      [{ action: "save", inputs: { competitorPriceCad: 100000 }, ourCostSource: null }, "带 ourCostSource: null"],
      [{ action: "save", ourCostSource: { kind: "rfq_compare", inquiryItemId: "item_fixture" } }, "只带顶层成本来源、不带 inputs（交叉验证 X09）"],
      [{ action: "save", inputs: { competitorPriceCad: 100000, targetMarginPct: 25 } }, "带目标毛利（上线前打开的旧卡片就是这样带的）"],
      [{ action: "save", inputs: { competitorPriceCad: 100000, targetMarginPct: null } }, "带目标毛利 null"],
      [{ action: "save", inputs: { competitorPriceCad: 100000, targetMarginPct: MARGIN } }, "带与库里相同的目标毛利 23.7（不能拿 200 / 403 当探针猜已存的值）"],
    ] as const;
    for (const [body, label] of forbidden) {
      const w = await postHelper(P, body, EDITOR);
      ok(w.status === 403 && w.body.error === EXPECTED_403 && JSON.stringify(await roomSj(P)) === snap, `编辑者${label}保存：403、那句话、库不变`, w.body);
    }
    // 多审 T3：org_admin 与组织负责人（都能写项目、都没有财务查看权）
    for (const [u, label] of [[ADMIN, "org_admin"], [ORG_OWNER, "组织负责人 org_owner"]] as const) {
      const pw = await postHelper(P, { action: "save", inputs: { competitorPriceCad: 100000, targetMarginPct: 30 } }, u);
      ok(pw.status === 403 && pw.body.error === EXPECTED_403 && rec((await roomSj(P)).pricingInputs).targetMarginPct === MARGIN, `${label}带目标毛利 30 保存：403、那句话、库里仍是 23.7`, [pw.status, pw.body]);
      const ps = await postHelper(P, { action: "save", inputs: { competitorPriceCad: 100000 } }, u);
      ok(ps.status === 200 && rec(ps.body.inputs).targetMarginPct === null && rec(ps.body.inputs).ourCostCad === null && ps.body.costHidden === true && !("ourCostSource" in ps.body) && noSecretIn(ps.text), `${label}只带对手价保存：200，返回目标毛利与成本为 null、costHidden、没有 ourCostSource、搜不到目标毛利与成本`, [ps.status, ps.body]);
    }
    const okSave = await postHelper(P, { action: "save", inputs: { competitorPriceCad: 105000 } }, EDITOR);
    const afterPi = rec((await roomSj(P)).pricingInputs);
    ok(okSave.status === 200 && afterPi.competitorPriceCad === 105000 && afterPi.targetMarginPct === MARGIN && afterPi.ourCostCad === COST && rec(afterPi.ourCostSource).landedCadTotal === LANDED && afterPi.ourPriceCad === PRICE, "编辑者只带对手价保存：成功；目标毛利、成本、成本来源与报价镜像保留", afterPi);
    ok(rec(okSave.body.inputs).targetMarginPct === null && rec(okSave.body.inputs).ourCostCad === null && okSave.body.costHidden === true && !("ourCostSource" in okSave.body) && noSecretIn(okSave.text), "编辑者保存的返回：目标毛利与成本为 null、costHidden、没有 ourCostSource、搜不到目标毛利与成本", okSave.body);

    /* ---------- 5. 判定顺序：409 → 403 → 400 ---------- */
    const PX = await mkProject(false);
    ok((await postHelper(PX, { action: "save", inputs: { targetMarginPct: 20 } }, EDITOR)).status === 409, "没有投标调查室时编辑者带目标毛利：409 先于财务 403");
    const snap2 = JSON.stringify(await roomSj(P));
    const w100 = await postHelper(P, { action: "save", inputs: { targetMarginPct: 100 } }, EDITOR);
    ok(w100.status === 403 && w100.body.error === EXPECTED_403 && JSON.stringify(await roomSj(P)) === snap2, "编辑者带目标毛利 100：403 先于 400、库不变", w100.body);
    const f100 = await postHelper(P, { action: "save", inputs: { targetMarginPct: 100 } }, FINREAD);
    ok(f100.status === 400 && JSON.stringify(await roomSj(P)) === snap2, "能编辑项目、持 ORG 范围 finance.read 的成员带目标毛利 100：400、库不变", f100.body);
    const f1 = await postHelper(P, { action: "save", inputs: { targetMarginPct: 18 } }, FINREAD);
    ok(f1.status === 200 && rec(f1.body.inputs).targetMarginPct === 18 && rec((await roomSj(P)).pricingInputs).targetMarginPct === 18, "持 ORG 范围 finance.read 的成员可以改目标毛利，返回带新值", f1.body);
  } finally {
    if (prevFlag === undefined) delete process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
    else process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = prevFlag;
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-25 target margin finance DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
