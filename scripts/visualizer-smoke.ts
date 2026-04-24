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
import {
  parseImageSize,
  parsePngDataUrl,
  VISUALIZER_MAX_EXPORT_BASE64,
} from "../src/lib/visualizer/upload";
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

  console.log("\n  parsePngDataUrl (导出 PNG 上传前端 payload 校验):");
  {
    const smallPngBuf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const okData = `data:image/png;base64,${smallPngBuf.toString("base64")}`;
    const r = parsePngDataUrl(okData);
    check("合法 PNG dataURL 通过", r !== null && r.buffer.length > 0);
  }
  {
    const jpegLike = `data:image/jpeg;base64,${Buffer.alloc(16).toString("base64")}`;
    check("非 PNG MIME 拒绝", parsePngDataUrl(jpegLike) === null);
  }
  {
    check("非 string 拒绝", parsePngDataUrl(null as unknown as string) === null);
    check("空串拒绝", parsePngDataUrl("") === null);
  }
  {
    const raw = Buffer.alloc(32).toString("base64");
    const bad = `data:image/png;base64,${raw}`;
    check("PNG 签名不对拒绝", parsePngDataUrl(bad) === null);
  }
  {
    // 构造 base64 超长（比上限多 100 字节即可触发）
    const oversize = "A".repeat(VISUALIZER_MAX_EXPORT_BASE64 + 100);
    const bad = `data:image/png;base64,${oversize}`;
    check("超出体积上限拒绝", parsePngDataUrl(bad) === null);
  }

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
  console.log(
    "\n[C] PR#3 能力覆盖（幂等打开 + 跨 session 照片复用 + agent 工具注册）",
  );

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

      // —— 跨 session 照片复用（方案 C） —— //
      // 给 s1 造两张图，s2 造一张**相同 fileUrl** 的图（模拟已被导入过一次）
      const imgA1 = await tx.visualizerSourceImage.create({
        data: {
          sessionId: s1.id,
          fileUrl: "https://example.com/living.jpg",
          fileName: "living.jpg",
          mimeType: "image/jpeg",
          roomLabel: "Living Room",
        },
      });
      const imgA2 = await tx.visualizerSourceImage.create({
        data: {
          sessionId: s1.id,
          fileUrl: "https://example.com/bedroom.jpg",
          fileName: "bedroom.jpg",
          mimeType: "image/jpeg",
          roomLabel: "Master Bedroom",
        },
      });
      await tx.visualizerSourceImage.create({
        data: {
          sessionId: s2.id,
          fileUrl: "https://example.com/living.jpg", // 与 imgA1 同 URL
          fileName: "living.jpg",
          mimeType: "image/jpeg",
          roomLabel: "Living Room (copied)",
        },
      });

      // 目标：从 s2 视角查候选，应看到 s1 的两张图
      const candidates = await tx.visualizerSession.findMany({
        where: {
          customerId: customer.id,
          id: { not: s2.id },
          status: { not: "archived" },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          sourceImages: {
            select: { id: true, fileUrl: true, fileName: true },
          },
        },
      });
      const flatImgs = candidates.flatMap((c) => c.sourceImages);
      check(
        "候选列表含 s1 的 2 张图",
        flatImgs.some((i) => i.id === imgA1.id) &&
          flatImgs.some((i) => i.id === imgA2.id),
      );

      // 模拟 clone 路由核心逻辑：把 imgA1+imgA2 克隆到 s2
      const requestedIds = [imgA1.id, imgA2.id];
      const srcRows = await tx.visualizerSourceImage.findMany({
        where: { id: { in: requestedIds } },
      });
      const existingUrls = new Set(
        (
          await tx.visualizerSourceImage.findMany({
            where: {
              sessionId: s2.id,
              fileUrl: { in: srcRows.map((r) => r.fileUrl) },
            },
            select: { fileUrl: true },
          })
        ).map((r) => r.fileUrl),
      );
      const toClone = srcRows.filter((r) => !existingUrls.has(r.fileUrl));
      check(
        "克隆去重：已有同 URL 的 living.jpg 被跳过",
        toClone.length === 1 && toClone[0].id === imgA2.id,
      );
      const cloned = await Promise.all(
        toClone.map((r) =>
          tx.visualizerSourceImage.create({
            data: {
              sessionId: s2.id,
              fileUrl: r.fileUrl,
              fileName: r.fileName,
              mimeType: r.mimeType,
              width: r.width,
              height: r.height,
              roomLabel: r.roomLabel,
              measurementPhotoId: r.measurementPhotoId,
            },
          }),
        ),
      );
      check("首次克隆：1 张被写入", cloned.length === 1);
      check(
        "克隆后 s2 的图数 = 2（原 1 + 新增 1）",
        (await tx.visualizerSourceImage.count({ where: { sessionId: s2.id } })) === 2,
      );

      // 再次克隆同一批：应全部被去重跳过
      const existingUrls2 = new Set(
        (
          await tx.visualizerSourceImage.findMany({
            where: {
              sessionId: s2.id,
              fileUrl: { in: srcRows.map((r) => r.fileUrl) },
            },
            select: { fileUrl: true },
          })
        ).map((r) => r.fileUrl),
      );
      const toClone2 = srcRows.filter((r) => !existingUrls2.has(r.fileUrl));
      check("二次克隆：无新增（fileUrl 去重）", toClone2.length === 0);

      // 跨客户防护：另一个客户下的 session 不应能被当作候选
      const otherCustomer = await tx.salesCustomer.create({
        data: {
          name: "__smoke_other_customer__",
          createdById: customer.createdById!,
        },
      });
      const sOther = await tx.visualizerSession.create({
        data: {
          customerId: otherCustomer.id,
          title: "__smoke_other_session__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });
      await tx.visualizerSourceImage.create({
        data: {
          sessionId: sOther.id,
          fileUrl: "https://example.com/other.jpg",
          fileName: "other.jpg",
          mimeType: "image/jpeg",
        },
      });
      const candidates2 = await tx.visualizerSession.findMany({
        where: {
          customerId: customer.id,
          id: { not: s2.id },
          status: { not: "archived" },
        },
        select: { id: true },
      });
      check(
        "跨客户防护：另一个客户的 session 不在候选列表",
        candidates2.every((c) => c.id !== sOther.id),
      );

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
  const leakedOtherCustomer = await db.salesCustomer.findFirst({
    where: { name: "__smoke_other_customer__" },
    select: { id: true },
  });
  check("无残留 __smoke_other_customer__", leakedOtherCustomer === null);
  const leakedCloneImg = await db.visualizerSourceImage.findFirst({
    where: { fileUrl: "https://example.com/living.jpg" },
    select: { id: true },
  });
  check("无残留克隆测试图片", leakedCloneImg === null);
}

// ---------- D) PR#4：导出 PNG + previewImages 序列化 ----------
async function testPr4() {
  console.log("\n[D] PR#4 能力覆盖（导出封面 + previewImages 序列化）");

  const customer = await db.salesCustomer.findFirst({
    where: { archivedAt: null },
    select: { id: true, createdById: true },
  });
  if (!customer || !customer.createdById) {
    console.log("  ⚠️  跳过：没有可用客户");
    return;
  }

  const ROLLBACK_TOKEN = "__visualizer_smoke_rollback_pr4__";
  try {
    await db.$transaction(async (tx) => {
      const s = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr4_session__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });

      // 造 4 个 variant：2 个有封面，1 个没封面，再 1 个有封面
      // 预期 previewImages 取前 3 个按 sortOrder 升序的非空 exportImageUrl
      const v1 = await tx.visualizerVariant.create({
        data: {
          sessionId: s.id,
          name: "方案 A",
          sortOrder: 0,
          exportImageUrl: "https://example.com/export/a.png",
        },
      });
      const v2 = await tx.visualizerVariant.create({
        data: {
          sessionId: s.id,
          name: "方案 B",
          sortOrder: 1,
          exportImageUrl: "https://example.com/export/b.png",
        },
      });
      await tx.visualizerVariant.create({
        data: {
          sessionId: s.id,
          name: "方案 C（无封面）",
          sortOrder: 2,
          exportImageUrl: null,
        },
      });
      await tx.visualizerVariant.create({
        data: {
          sessionId: s.id,
          name: "方案 D",
          sortOrder: 3,
          exportImageUrl: "https://example.com/export/d.png",
        },
      });

      // 模拟 sessions list API 的 include + 序列化
      const loaded = await tx.visualizerSession.findUnique({
        where: { id: s.id },
        include: {
          _count: { select: { sourceImages: true, variants: true } },
          variants: {
            where: { exportImageUrl: { not: null } },
            orderBy: { sortOrder: "asc" },
            take: 3,
            select: { exportImageUrl: true },
          },
        },
      });
      const preview = loaded!.variants
        .map((v) => v.exportImageUrl)
        .filter((u): u is string => !!u);
      check(
        "previewImages：取前 3 个非空 exportImageUrl",
        preview.length === 3 &&
          preview[0] === "https://example.com/export/a.png" &&
          preview[1] === "https://example.com/export/b.png" &&
          preview[2] === "https://example.com/export/d.png",
      );
      check(
        "previewImages：跳过 exportImageUrl 为 null 的方案 C",
        !preview.includes(null as unknown as string),
      );

      // 模拟 POST /variants/[id]/export 的核心回写
      const newUrl = "https://example.com/export/new.png";
      const updated = await tx.visualizerVariant.update({
        where: { id: v1.id },
        data: { exportImageUrl: newUrl },
        select: { exportImageUrl: true, updatedAt: true },
      });
      check(
        "variant.exportImageUrl 回写成功",
        updated.exportImageUrl === newUrl,
      );

      // 写回后，序列化结果应刷新
      const reloaded = await tx.visualizerSession.findUnique({
        where: { id: s.id },
        include: {
          variants: {
            where: { exportImageUrl: { not: null } },
            orderBy: { sortOrder: "asc" },
            take: 3,
            select: { exportImageUrl: true },
          },
        },
      });
      const preview2 = reloaded!.variants
        .map((v) => v.exportImageUrl)
        .filter((u): u is string => !!u);
      check(
        "回写后 previewImages[0] 变为新 URL",
        preview2[0] === newUrl,
      );

      // detail 路径里的 previewImages 取值逻辑也顺手验证一下（基于全量 variants）
      const full = await tx.visualizerSession.findUnique({
        where: { id: s.id },
        include: {
          variants: {
            orderBy: { sortOrder: "asc" },
            select: { exportImageUrl: true },
          },
        },
      });
      const detailPreview = full!.variants
        .map((v) => v.exportImageUrl)
        .filter((u): u is string => !!u)
        .slice(0, 3);
      check(
        "detail 路径 previewImages 至多 3 个",
        detailPreview.length === 3 &&
          detailPreview[0] === newUrl &&
          detailPreview[1] === "https://example.com/export/b.png" &&
          detailPreview[2] === "https://example.com/export/d.png",
      );

      // 保护 v2 引用未被意外更改（避免副作用）
      const v2After = await tx.visualizerVariant.findUnique({
        where: { id: v2.id },
        select: { exportImageUrl: true },
      });
      check(
        "方案 B 的 exportImageUrl 未被 A 的 PATCH 波及",
        v2After?.exportImageUrl === "https://example.com/export/b.png",
      );

      throw new Error(ROLLBACK_TOKEN);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ROLLBACK_TOKEN) {
      console.log("  ✓ PR#4 事务已主动回滚（无数据落库）");
    } else {
      failed++;
      failures.push(`PR#4 事务意外失败：${msg}`);
      console.log(`  ✗ PR#4 事务意外失败：${msg}`);
    }
  }

  const leakedPr4 = await db.visualizerSession.findFirst({
    where: { title: "__smoke_pr4_session__" },
    select: { id: true },
  });
  check("无残留 __smoke_pr4_session__", leakedPr4 === null);
}

// ---------- E) PR#5：opp/quote 挂封面 + list_covers 工具 ----------
async function testPr5() {
  console.log(
    "\n[E] PR#5 能力覆盖（opp/quote 挂封面 + sales_visualizer_list_covers）",
  );

  // E1) agent 工具 policy 已登记（同 PR#3，tsx 不跑 registry 副作用）
  const { TOOL_POLICY } = await import("../src/lib/agent-core/tools/_policy");
  check(
    "TOOL_POLICY 已登记 sales_visualizer_list_covers",
    !!TOOL_POLICY["sales_visualizer_list_covers"],
  );
  check(
    "list_covers 风险等级=l0_read（只读）",
    TOOL_POLICY["sales_visualizer_list_covers"]?.risk === "l0_read",
  );
  check(
    "list_covers 允许 sales",
    TOOL_POLICY["sales_visualizer_list_covers"]?.allowRoles.includes("sales"),
  );

  // E2) DB 层：模拟 list_covers 的查询逻辑 + opp/quote 挂封面的索引
  const customer = await db.salesCustomer.findFirst({
    where: { archivedAt: null },
    select: { id: true, createdById: true },
  });
  if (!customer || !customer.createdById) {
    console.log("  ⚠️  跳过 DB 段：没有可用客户");
    return;
  }

  const ROLLBACK_TOKEN = "__visualizer_smoke_rollback_pr5__";
  try {
    await db.$transaction(async (tx) => {
      // 建两个 opp，一个有方案封面一个没有
      const opp1 = await tx.salesOpportunity.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr5_opp_with_cover__",
          stage: "new_lead",
          createdById: customer.createdById!,
        },
      });
      const opp2 = await tx.salesOpportunity.create({
        data: {
          customerId: customer.id,
          title: "__smoke_pr5_opp_no_cover__",
          stage: "new_lead",
          createdById: customer.createdById!,
        },
      });

      // 给 opp1 建 2 个 session（都挂 opp1），较新的一个带封面
      const olderSession = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          opportunityId: opp1.id,
          title: "__smoke_pr5_opp1_older__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });
      // 确保 updatedAt 顺序可比
      await new Promise((r) => setTimeout(r, 5));
      const newerSession = await tx.visualizerSession.create({
        data: {
          customerId: customer.id,
          opportunityId: opp1.id,
          title: "__smoke_pr5_opp1_newer__",
          createdById: customer.createdById!,
          salesOwnerId: customer.createdById,
        },
      });
      await tx.visualizerVariant.create({
        data: {
          sessionId: newerSession.id,
          name: "封面 A",
          sortOrder: 0,
          exportImageUrl: "https://example.com/pr5/a.png",
        },
      });
      await tx.visualizerVariant.create({
        data: {
          sessionId: newerSession.id,
          name: "封面 B",
          sortOrder: 1,
          exportImageUrl: "https://example.com/pr5/b.png",
        },
      });
      // 较老 session 不带封面
      await tx.visualizerVariant.create({
        data: {
          sessionId: olderSession.id,
          name: "无封面",
          sortOrder: 0,
          exportImageUrl: null,
        },
      });

      // opp2 完全不建 session

      // ---- E2.1 客户页构建 oppIdToCover：同前端逻辑 ----
      // 前端拿 /api/visualizer/sessions?customerId=X（含 previewImages），按 updatedAt desc，
      // 遍历时 opp 去重保留首个（即最新）
      const sessions = await tx.visualizerSession.findMany({
        where: { customerId: customer.id, status: { not: "archived" } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          opportunityId: true,
          variants: {
            where: { exportImageUrl: { not: null } },
            orderBy: { sortOrder: "asc" },
            take: 3,
            select: { exportImageUrl: true },
          },
        },
      });
      const oppMap = new Map<string, { sessionId: string; cover: string | null }>();
      for (const s of sessions) {
        if (!s.opportunityId) continue;
        if (oppMap.has(s.opportunityId)) continue;
        const cover = s.variants[0]?.exportImageUrl ?? null;
        oppMap.set(s.opportunityId, { sessionId: s.id, cover });
      }
      check(
        "opp1 映射到最新 session（newer）",
        oppMap.get(opp1.id)?.sessionId === newerSession.id,
      );
      check(
        "opp1 封面 = newer session 的第一个非空 exportImageUrl",
        oppMap.get(opp1.id)?.cover === "https://example.com/pr5/a.png",
      );
      check(
        "opp2 在 map 中不出现（无 session）",
        !oppMap.has(opp2.id),
      );

      // ---- E2.2 模拟 sales_visualizer_list_covers 的查询 ----
      // onlyWithCover = true：只留有封面的 session，每个 session 返回所有非空 variant
      const listWithCover = await tx.visualizerSession.findMany({
        where: { customerId: customer.id, status: { not: "archived" } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          opportunity: { select: { id: true, title: true } },
          variants: {
            where: { exportImageUrl: { not: null } },
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true, exportImageUrl: true, sortOrder: true },
          },
        },
      });
      const filteredWithCover = listWithCover.filter((s) => s.variants.length > 0);
      const pr5Sessions = filteredWithCover.filter(
        (s) =>
          s.title === "__smoke_pr5_opp1_newer__" ||
          s.title === "__smoke_pr5_opp1_older__",
      );
      check(
        "list_covers（onlyWithCover=true）过滤掉无封面的较老 session",
        pr5Sessions.length === 1 &&
          pr5Sessions[0].title === "__smoke_pr5_opp1_newer__",
      );
      check(
        "list_covers 每个 session 内 variants 按 sortOrder 升序",
        pr5Sessions[0].variants.map((v) => v.sortOrder).join(",") === "0,1",
      );
      check(
        "list_covers variants 包含两个 URL（a + b）",
        pr5Sessions[0].variants.map((v) => v.exportImageUrl).join(",") ===
          "https://example.com/pr5/a.png,https://example.com/pr5/b.png",
      );

      // onlyWithCover = false：应能看到较老 session（带一个 null 的 variant，但此处 where 不过滤）
      const listAll = await tx.visualizerSession.findMany({
        where: { customerId: customer.id, status: { not: "archived" } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          variants: {
            orderBy: { sortOrder: "asc" },
            select: { exportImageUrl: true },
          },
        },
      });
      const allPr5 = listAll.filter(
        (s) =>
          s.title === "__smoke_pr5_opp1_newer__" ||
          s.title === "__smoke_pr5_opp1_older__",
      );
      check(
        "list_covers（onlyWithCover=false）包含较老 session",
        allPr5.some((s) => s.title === "__smoke_pr5_opp1_older__"),
      );

      // ---- E2.3 opportunityId 过滤 ----
      const listOpp2 = await tx.visualizerSession.findMany({
        where: {
          customerId: customer.id,
          opportunityId: opp2.id,
          status: { not: "archived" },
        },
        select: { id: true },
      });
      check(
        "list_covers 指定 opp2 时返回为空",
        listOpp2.length === 0,
      );

      throw new Error(ROLLBACK_TOKEN);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ROLLBACK_TOKEN) {
      console.log("  ✓ PR#5 事务已主动回滚（无数据落库）");
    } else {
      failed++;
      failures.push(`PR#5 事务意外失败：${msg}`);
      console.log(`  ✗ PR#5 事务意外失败：${msg}`);
    }
  }

  const leakedPr5Session = await db.visualizerSession.findFirst({
    where: {
      OR: [
        { title: "__smoke_pr5_opp1_newer__" },
        { title: "__smoke_pr5_opp1_older__" },
      ],
    },
    select: { id: true },
  });
  check("无残留 __smoke_pr5_opp1_*__ session", leakedPr5Session === null);
  const leakedPr5Opp = await db.salesOpportunity.findFirst({
    where: {
      OR: [
        { title: "__smoke_pr5_opp_with_cover__" },
        { title: "__smoke_pr5_opp_no_cover__" },
      ],
    },
    select: { id: true },
  });
  check("无残留 __smoke_pr5_opp_*__ opportunity", leakedPr5Opp === null);
}

async function main() {
  console.log("===== Visualizer 冒烟测试 =====");
  try {
    await testPureLogic();
    await testDbRoundtrip();
    await testPr3();
    await testPr4();
    await testPr5();
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
