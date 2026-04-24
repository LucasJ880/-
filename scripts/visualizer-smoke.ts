/* eslint-disable no-console */
/**
 * Visualizer 冒烟测试
 *
 * 跑两部分：
 * A) 纯逻辑：validators / image size parser
 * B) DB 事务冒烟：在一个 prisma transaction 里 create 完整链路 → GET 复现 →
 *    最后主动 throw 让事务回滚，确保不落库任何数据
 *
 * 使用：npx tsx scripts/visualizer-smoke.ts
 */

import { db } from "../src/lib/db";
import {
  VISUALIZER_REGION_SHAPES,
  validateOpacity,
  validateRegionPoints,
  validateTransform,
} from "../src/lib/visualizer/validators";
import { parseImageSize } from "../src/lib/visualizer/upload";
import { VISUALIZER_MOCK_PRODUCTS } from "../src/lib/visualizer/mock-products";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

// ---------- A) 纯逻辑 ----------
async function testPureLogic() {
  console.log("\n[A] 纯逻辑测试");

  console.log("\n  validateRegionPoints:");
  {
    const r = validateRegionPoints("rect", [[0, 0], [100, 50]]);
    check("rect 2 点通过", r.ok);
  }
  {
    const r = validateRegionPoints("rect", [[0, 0]]);
    check("rect 1 点拒绝", !r.ok);
  }
  {
    const r = validateRegionPoints("polygon", [[0, 0], [10, 0], [5, 8]]);
    check("polygon 3 点通过", r.ok);
  }
  {
    const r = validateRegionPoints("polygon", [[0, 0], [10, 0]]);
    check("polygon 2 点拒绝", !r.ok);
  }
  {
    const r = validateRegionPoints("rect", [["x", 0], [10, 20]] as unknown);
    check("非数字点拒绝", !r.ok);
  }
  {
    const r = validateRegionPoints("rect", "not array" as unknown);
    check("非数组拒绝", !r.ok);
  }
  check(
    "VISUALIZER_REGION_SHAPES 恰好两种",
    VISUALIZER_REGION_SHAPES.length === 2 &&
      VISUALIZER_REGION_SHAPES.includes("rect") &&
      VISUALIZER_REGION_SHAPES.includes("polygon"),
  );

  console.log("\n  validateOpacity:");
  check("0.5 通过", validateOpacity(0.5).ok);
  check("0 通过（边界）", validateOpacity(0).ok);
  check("1 通过（边界）", validateOpacity(1).ok);
  check("1.1 拒绝", !validateOpacity(1.1).ok);
  check("-0.1 拒绝", !validateOpacity(-0.1).ok);
  check("NaN 拒绝", !validateOpacity(NaN).ok);
  check("string 拒绝", !validateOpacity("0.5").ok);

  console.log("\n  validateTransform:");
  check(
    "合法 transform",
    validateTransform({
      offsetX: 10,
      offsetY: -5,
      scaleX: 1.2,
      scaleY: 0.9,
      rotation: 15,
    }).ok,
  );
  check("null 通过（= 清空）", validateTransform(null).ok);
  check(
    "scaleX=0 拒绝",
    !validateTransform({
      offsetX: 0,
      offsetY: 0,
      scaleX: 0,
      scaleY: 1,
      rotation: 0,
    }).ok,
  );
  check(
    "scaleX=30 拒绝（超出合理范围）",
    !validateTransform({
      offsetX: 0,
      offsetY: 0,
      scaleX: 30,
      scaleY: 1,
      rotation: 0,
    }).ok,
  );
  check(
    "缺字段拒绝",
    !validateTransform({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }).ok,
  );

  console.log("\n  parseImageSize (PNG):");
  // 最小合法 PNG：signature + IHDR(13 字节: 8+4 len + 4 "IHDR" + 4 w + 4 h + 5 byte + 4 crc)
  // 我们只需要前 24 字节正确
  const pngBuf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), // length of IHDR data
    Buffer.from("IHDR", "ascii"),
    Buffer.from([0, 0, 0x04, 0x00]), // width = 1024
    Buffer.from([0, 0, 0x02, 0x00]), // height = 512
    Buffer.alloc(16), // rest of IHDR + CRC (不需要真实值)
  ]);
  const pngSize = parseImageSize(pngBuf, "png");
  check("PNG 1024x512 解析", pngSize?.width === 1024 && pngSize?.height === 512);

  console.log("\n  parseImageSize (JPEG):");
  // 最小 JPEG：SOI + SOF0 segment
  // SOI: FFD8
  // SOF0: FF C0, length 17 (00 11), precision 8 (08), Y 0x0200=512, X 0x0400=1024, 3 components, then 9 bytes
  const jpegBuf = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x02, 0x00, // height = 512
    0x04, 0x00, // width = 1024
    0x03, // components
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const jpegSize = parseImageSize(jpegBuf, "jpeg");
  check("JPEG 1024x512 解析", jpegSize?.width === 1024 && jpegSize?.height === 512);

  console.log("\n  mock products:");
  check("恰好 10 款产品", VISUALIZER_MOCK_PRODUCTS.length === 10);
  check(
    "所有产品 id 唯一",
    new Set(VISUALIZER_MOCK_PRODUCTS.map((p) => p.id)).size ===
      VISUALIZER_MOCK_PRODUCTS.length,
  );
  check(
    "所有产品 defaultOpacity 在 0~1",
    VISUALIZER_MOCK_PRODUCTS.every(
      (p) => p.defaultOpacity > 0 && p.defaultOpacity <= 1,
    ),
  );
  check(
    "所有产品至少有一种颜色",
    VISUALIZER_MOCK_PRODUCTS.every((p) => p.supportedColors.length > 0),
  );
}

// ---------- B) DB 事务冒烟 ----------
async function testDbRoundtrip() {
  console.log("\n[B] DB 事务冒烟（全部在事务内，最终回滚不落库）");

  // 1) 找到任何一个有效的客户与用户（不修改现有数据）
  const customer = await db.salesCustomer.findFirst({
    where: { archivedAt: null },
    select: { id: true, name: true, createdById: true },
  });
  if (!customer || !customer.createdById) {
    console.log("  ⚠️  跳过：数据库里没有可用客户或客户无 createdById");
    return;
  }
  const user = await db.user.findUnique({
    where: { id: customer.createdById },
    select: { id: true },
  });
  if (!user) {
    console.log("  ⚠️  跳过：customer.createdById 指向的用户不存在");
    return;
  }
  console.log(`  使用现有客户 id=${customer.id} name="${customer.name}"`);

  const ROLLBACK_TOKEN = "__visualizer_smoke_rollback__";

  try {
    await db.$transaction(async (tx) => {
      // 2) Create session
      const session = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          title: "__smoke_test__",
          createdById: user.id,
          salesOwnerId: user.id,
        },
      });
      check("创建 session", !!session.id);

      // 3) Create source image
      const img = await tx.visualizerSourceImage.create({
        data: {
          sessionId: session.id,
          fileUrl: "https://example.com/smoke.png",
          fileName: "smoke.png",
          mimeType: "image/png",
          width: 1600,
          height: 1200,
        },
      });
      check("创建 source image", !!img.id);

      // 4) Create 2 regions (rect + polygon)
      const rectRegion = await tx.visualizerWindowRegion.create({
        data: {
          sourceImageId: img.id,
          shape: "rect",
          pointsJson: [[100, 100], [500, 400]],
          label: "W1",
          widthIn: 48,
          heightIn: 36,
        },
      });
      const polyRegion = await tx.visualizerWindowRegion.create({
        data: {
          sourceImageId: img.id,
          shape: "polygon",
          pointsJson: [[600, 100], [900, 150], [950, 500], [620, 480]],
          label: "W2",
        },
      });
      check("创建 rect region", !!rectRegion.id);
      check("创建 polygon region", !!polyRegion.id);

      // 5) Create variant
      const variant = await tx.visualizerVariant.create({
        data: {
          sessionId: session.id,
          name: "Option A",
          sortOrder: 0,
        },
      });
      check("创建 variant", !!variant.id);

      // 6) Create product option on rect region
      const product = VISUALIZER_MOCK_PRODUCTS[0];
      const po = await tx.visualizerProductOption.create({
        data: {
          variantId: variant.id,
          regionId: rectRegion.id,
          productCatalogId: product.id,
          productName: product.name,
          productCategory: product.category,
          color: product.supportedColors[0].name,
          colorHex: product.supportedColors[0].hex,
          opacity: product.defaultOpacity,
          transformJson: {
            offsetX: 5,
            offsetY: -3,
            scaleX: 1.1,
            scaleY: 1,
            rotation: 4,
          },
        },
      });
      check("创建 product option", !!po.id);

      // 7) GET-模拟：按 schema [id]/route.ts 的 include 查回整棵树
      const full = await tx.visualizerSession.findUnique({
        where: { id: session.id },
        include: {
          sourceImages: {
            include: {
              regions: true,
              _count: { select: { regions: true } },
            },
          },
          variants: {
            include: {
              productOptions: true,
              _count: { select: { productOptions: true } },
              selections: { select: { selectedBy: true } },
            },
          },
        },
      });
      check("GET 返回 session", !!full);
      check("session.sourceImages 长度=1", full?.sourceImages.length === 1);
      check(
        "sourceImages[0].regions 长度=2",
        full?.sourceImages[0].regions.length === 2,
      );
      check(
        "sourceImages[0]._count.regions=2",
        full?.sourceImages[0]._count.regions === 2,
      );
      check("variants 长度=1", full?.variants.length === 1);
      check(
        "variants[0].productOptions 长度=1",
        full?.variants[0].productOptions.length === 1,
      );
      check(
        "transform 往返保留",
        (() => {
          const t = full?.variants[0].productOptions[0].transformJson as {
            offsetX?: number;
            rotation?: number;
          } | null;
          return t?.offsetX === 5 && t?.rotation === 4;
        })(),
      );

      // 8) FK 级联：删 region 应连带删该 region 上的 productOption
      await tx.visualizerWindowRegion.delete({ where: { id: rectRegion.id } });
      const poAfter = await tx.visualizerProductOption.findUnique({
        where: { id: po.id },
      });
      check("删 region → 级联删 product option", poAfter === null);

      // 9) 事务主动 throw 回滚（所有创建都不落库）
      throw new Error(ROLLBACK_TOKEN);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ROLLBACK_TOKEN) {
      console.log("  ✓ 事务已主动回滚（无数据落库）");
    } else {
      failed++;
      failures.push(`事务意外失败：${msg}`);
      console.log(`  ✗ 事务意外失败：${msg}`);
    }
  }

  // 10) 二次验证：确实没有落库
  const leaked = await db.visualizerSession.findFirst({
    where: { title: "__smoke_test__" },
    select: { id: true },
  });
  check("无残留 __smoke_test__ session", leaked === null);
}

// ---------- C) PR #3 能力覆盖 ----------
async function testPr3() {
  console.log("\n[C] PR#3 能力覆盖（幂等打开 + 量房导入 + agent 工具注册）");

  // C1) agent 工具 policy 已登记（tsx 不解析 @/* 别名，直接跑 registry 会拿不到工具；
  // 这里退化为检查 TOOL_POLICY 纯导出 + sales.ts barrel 是否 import 了 sales-visualizer）
  const { TOOL_POLICY } = await import("../src/lib/agent-core/tools/_policy");
  check(
    "TOOL_POLICY 已登记 sales_visualizer_open",
    !!TOOL_POLICY["sales_visualizer_open"],
  );
  check(
    "sales_visualizer_open 风险等级=l2_soft",
    TOOL_POLICY["sales_visualizer_open"]?.risk === "l2_soft",
  );
  check(
    "sales_visualizer_open 允许 sales",
    TOOL_POLICY["sales_visualizer_open"]?.allowRoles.includes("sales"),
  );
  // 验证 sales barrel 已挂上 sales-visualizer（防止漏注册）
  const { readFileSync } = await import("node:fs");
  const salesBarrel = readFileSync("src/lib/agent-core/tools/sales.ts", "utf8");
  check(
    "sales.ts barrel import 了 sales-visualizer",
    /import\s+["']\.\/sales-visualizer["']/.test(salesBarrel),
  );

  // C2) 幂等匹配 & 量房导入 DB 逻辑（事务回滚，不落库）
  const customer = await db.salesCustomer.findFirst({
    where: { archivedAt: null },
    select: { id: true, createdById: true },
  });
  if (!customer || !customer.createdById) {
    console.log("  ⚠️  跳过：没有可用客户");
    return;
  }

  const ROLLBACK_TOKEN = "__visualizer_smoke_rollback_pr3__";
  try {
    await db.$transaction(async (tx) => {
      // —— 幂等匹配 —— //
      // 1a) 同 customer + opp=null 先后建两个 session
      const s1 = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr3_s1__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });
      await new Promise((r) => setTimeout(r, 5));
      const s2 = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr3_s2__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });

      // findFirst with opportunityId=null 应返回 s2（最新）
      const hit = await tx.visualizerSession.findFirst({
        where: {
          customerId: customer.id,
          status: { not: "archived" },
          opportunityId: null,
        },
        orderBy: { updatedAt: "desc" },
      });
      check("幂等匹配：findFirst 返回最新 session", hit?.id === s2.id);
      check("幂等匹配：不会命中到 s1", hit?.id !== s1.id);

      // 1b) 造 opportunity 并绑到一个 session；查 null 时不应命中这个带 opp 的
      const opp = await tx.salesOpportunity.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr3_opp__",
          stage: "new_lead",
          createdById: customer.createdById!,
        },
      });
      const sOpp = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          opportunityId: opp.id,
          title: "__smoke_pr3_sOpp__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });
      const hitWithOpp = await tx.visualizerSession.findFirst({
        where: {
          customerId: customer.id,
          status: { not: "archived" },
          opportunityId: opp.id,
        },
        orderBy: { updatedAt: "desc" },
      });
      check("按 opp 查询 → 命中 sOpp", hitWithOpp?.id === sOpp.id);
      const hitNullAgain = await tx.visualizerSession.findFirst({
        where: {
          customerId: customer.id,
          status: { not: "archived" },
          opportunityId: null,
        },
        orderBy: { updatedAt: "desc" },
      });
      check(
        "opp=null 查询不会误命中带 opp 的 session",
        hitNullAgain?.id !== sOpp.id,
      );

      // —— 量房导入 —— //
      const rec = await tx.measurementRecord.create({
        data: {
          customerId: customer.id,
          measuredById: customer.createdById!,
          windows: {
            create: [
              {
                roomName: "__smoke_room__",
                windowLabel: "W1",
                widthIn: 48,
                heightIn: 36,
                sortOrder: 0,
                photos: {
                  create: [
                    { fileName: "a.jpg", fileUrl: "https://ex.com/a.jpg" },
                    { fileName: "b.jpg", fileUrl: "https://ex.com/b.jpg" },
                  ],
                },
              },
              {
                roomName: "__smoke_room_empty__",
                widthIn: 24,
                heightIn: 24,
                sortOrder: 1,
                // 这一窗没照片，不应被拉进来
              },
            ],
          },
        },
        include: { windows: { include: { photos: true } } },
      });
      check(
        "造量房记录：2 窗 / 2 照片",
        rec.windows.length === 2 &&
          rec.windows[0].photos.length === 2 &&
          rec.windows[1].photos.length === 0,
      );

      // 造一个 session 挂到这个 record
      const sImport = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          measurementRecordId: rec.id,
          title: "__smoke_pr3_sImport__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });

      // 模拟 import-from-measurement 路由的核心写入
      const allPhotos = rec.windows.flatMap((w) =>
        w.photos.map((p) => ({
          id: p.id,
          fileName: p.fileName,
          fileUrl: p.fileUrl,
          roomLabel: w.windowLabel
            ? `${w.roomName} · ${w.windowLabel}`
            : w.roomName,
        })),
      );
      const existing = await tx.visualizerSourceImage.findMany({
        where: {
          sessionId: sImport.id,
          measurementPhotoId: { in: allPhotos.map((p) => p.id) },
        },
        select: { measurementPhotoId: true },
      });
      const existingSet = new Set(
        existing.map((e) => e.measurementPhotoId).filter(Boolean) as string[],
      );
      const toCreate = allPhotos.filter((p) => !existingSet.has(p.id));
      const created = await Promise.all(
        toCreate.map((p) =>
          tx.visualizerSourceImage.create({
            data: {
              sessionId: sImport.id,
              measurementPhotoId: p.id,
              fileUrl: p.fileUrl,
              fileName: p.fileName,
              mimeType: "image/jpeg",
              roomLabel: p.roomLabel,
            },
          }),
        ),
      );
      check("首次导入：2 张照片被写入", created.length === 2);
      check(
        "首次导入：两张都挂了 measurementPhotoId",
        created.every((c) => !!c.measurementPhotoId),
      );

      // 第二次导入：应全部跳过（去重）
      const existing2 = await tx.visualizerSourceImage.findMany({
        where: {
          sessionId: sImport.id,
          measurementPhotoId: { in: allPhotos.map((p) => p.id) },
        },
        select: { measurementPhotoId: true },
      });
      const set2 = new Set(
        existing2.map((e) => e.measurementPhotoId).filter(Boolean) as string[],
      );
      const toCreate2 = allPhotos.filter((p) => !set2.has(p.id));
      check("二次导入：无新增（measurementPhotoId 去重）", toCreate2.length === 0);

      // 强制回滚
      throw new Error(ROLLBACK_TOKEN);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ROLLBACK_TOKEN) {
      console.log("  ✓ PR#3 事务已主动回滚（无数据落库）");
    } else {
      failed++;
      failures.push(`PR#3 事务意外失败：${msg}`);
      console.log(`  ✗ PR#3 事务意外失败：${msg}`);
    }
  }

  const leakedOpp = await db.salesOpportunity.findFirst({
    where: { title: "__smoke_pr3_opp__" },
    select: { id: true },
  });
  check("无残留 __smoke_pr3_opp__", leakedOpp === null);
  const leakedRec = await db.measurementRecord.findFirst({
    where: { windows: { some: { roomName: "__smoke_room__" } } },
    select: { id: true },
  });
  check("无残留 __smoke_room__ 量房记录", leakedRec === null);
}

async function main() {
  console.log("===== Visualizer 冒烟测试 =====");
  try {
    await testPureLogic();
    await testDbRoundtrip();
    await testPr3();
  } catch (err) {
    failed++;
    failures.push(String(err));
    console.error("FATAL:", err);
  } finally {
    await db.$disconnect();
  }

  console.log("\n================================");
  console.log(`结果: ${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.log("失败项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("全部通过 ✅");
}

main();
