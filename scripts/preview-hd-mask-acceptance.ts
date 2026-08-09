/* eslint-disable no-console */
/**
 * PR #27 Preview 验收（隔离 Neon only）
 *
 * 安全：
 * - 要求 E2E_NEON_ENDPOINT_HOST 含 raspy-credit，禁止 super-field
 * - 密码/Cookie 不写入报告
 * - 房间图仅本地 tmp，不提交 Git
 *
 * 用法：
 *   PREVIEW_BASE=https://... \
 *   E2E_NEON_ENDPOINT_HOST=ep-raspy-credit-anx2k4wx-pooler... \
 *   DATABASE_URL=... DIRECT_URL=... \
 *   npx tsx scripts/preview-hd-mask-acceptance.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabase } from "../src/lib/testing/assert-safe-test-database";

// Fail-closed：禁止对生产/未识别数据库执行 destructive 测试
assertSafeTestDatabase({ scriptName: "scripts/preview-hd-mask-acceptance.ts" });

const PREVIEW_BASE = (process.env.PREVIEW_BASE || "").replace(/\/$/, "");
const ENDPOINT_HOST = process.env.E2E_NEON_ENDPOINT_HOST || "";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
const OUT = join(process.cwd(), "tmp/visualizer-hd-e2e/preview-acceptance");
const QA_EMAIL = "hd-mask-preview-qa@test.qingyan.ai";
const QA_PASSWORD = process.env.HD_MASK_QA_PASSWORD || `HdMaskQa!${randomBytes(4).toString("hex")}`;
const MARKER = `hd-mask-preview-${Date.now()}`;

function bypassHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  if (BYPASS) {
    h["x-vercel-protection-bypass"] = BYPASS;
    h["x-vercel-set-bypass-cookie"] = "true";
  }
  return h;
}

function abort(msg: string): never {
  console.error("ABORT:", msg);
  process.exit(2);
}

function assertSafeDb() {
  if (!ENDPOINT_HOST.includes("raspy-credit")) {
    abort("E2E_NEON_ENDPOINT_HOST must be isolated raspy-credit host");
  }
  if (ENDPOINT_HOST.includes("super-field")) {
    abort("refusing production-like super-field host");
  }
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl.includes("raspy-credit") || dbUrl.includes("super-field")) {
    abort("DATABASE_URL is not the isolated preview branch");
  }
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 隐私安全合成「真实感」房间：有家具色块轮廓但无人脸/无文字 */
function synthRealisticRoom(w: number, h: number, seed: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const wx1 = Math.floor(w * 0.3);
  const wy1 = Math.floor(h * 0.16);
  const wx2 = Math.floor(w * 0.7);
  const wy2 = Math.floor(h * 0.58);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const off = row + 1 + x * 4;
      const inWin = x >= wx1 && x <= wx2 && y >= wy1 && y <= wy2;
      const frame =
        inWin &&
        (x <= wx1 + 5 || x >= wx2 - 5 || y <= wy1 + 5 || y >= wy2 - 5);
      const sofa =
        y > h * 0.72 &&
        x > w * 0.15 &&
        x < w * 0.85 &&
        !(x > w * 0.4 && x < w * 0.6 && y < h * 0.85);
      const tv = y > h * 0.35 && y < h * 0.55 && x > w * 0.05 && x < w * 0.18;
      if (frame) {
        raw[off] = 55; raw[off + 1] = 42; raw[off + 2] = 30;
      } else if (inWin) {
        raw[off] = 140 + (seed % 20);
        raw[off + 1] = 180;
        raw[off + 2] = 220;
      } else if (sofa) {
        raw[off] = 90; raw[off + 1] = 70; raw[off + 2] = 55;
      } else if (tv) {
        raw[off] = 30; raw[off + 1] = 30; raw[off + 2] = 35;
      } else if (y > h * 0.7) {
        raw[off] = 160; raw[off + 1] = 140; raw[off + 2] = 110;
      } else {
        raw[off] = 225; raw[off + 1] = 218; raw[off + 2] = 205;
      }
      raw[off + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function synthTexture(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const off = row + 1 + x * 4;
      const band = Math.floor((x + y) / 7) % 2 === 0;
      raw[off] = band ? 215 : 195;
      raw[off + 1] = band ? 200 : 180;
      raw[off + 2] = band ? 175 : 155;
      raw[off + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function synthSwatch(): Buffer {
  return synthTexture(64, 64);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${PREVIEW_BASE}/api/auth/login`, {
    method: "POST",
    headers: bypassHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    abort(`login failed ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie =
    setCookie.map((c) => c.split(";")[0]).join("; ") ||
    res.headers
      .get("set-cookie")
      ?.split(",")
      .map((c) => c.split(";")[0]!.trim())
      .join("; ");
  if (!cookie) abort("login missing cookie");
  return cookie;
}

async function api(
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${PREVIEW_BASE}${path}`, {
    ...init,
    headers: bypassHeaders({
      ...((init?.headers as Record<string, string>) || {}),
      Cookie: cookie,
    }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json, headers: res.headers };
}

async function seedIsolated(db: PrismaClient) {
  const hash = await bcrypt.hash(QA_PASSWORD, 12);
  const user = await db.user.upsert({
    where: { email: QA_EMAIL },
    update: {
      passwordHash: hash,
      status: "active",
      role: "admin",
      name: "HD Mask Preview QA",
    },
    create: {
      email: QA_EMAIL,
      passwordHash: hash,
      status: "active",
      role: "admin",
      name: "HD Mask Preview QA",
    },
  });

  let org = await db.organization.findFirst({
    where: { code: "hd-mask-preview-qa-org" },
  });
  if (!org) {
    org = await db.organization.create({
      data: {
        name: "PREVIEW TEST - Visualizer HD Mask Org",
        code: "hd-mask-preview-qa-org",
        ownerId: user.id,
        status: "active",
        planType: "pro",
        modulesJson: { enabled: ["sales", "visualizer"] },
        industryPackId: "window_covering_services_v1",
      },
    });
  }
  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: { role: "org_owner", status: "active" },
    create: {
      orgId: org.id,
      userId: user.id,
      role: "org_owner",
      status: "active",
    },
  });
  await db.user.update({
    where: { id: user.id },
    data: { activeOrgId: org.id },
  });

  async function ensureProduct(args: {
    name: string;
    category: string;
    assets: Array<{ role: string; buffer: Buffer; fileName: string }>;
  }) {
    let product = await db.visualizerCatalogProduct.findFirst({
      where: { orgId: org!.id, name: args.name, archived: false },
    });
    if (!product) {
      product = await db.visualizerCatalogProduct.create({
        data: {
          orgId: org!.id,
          name: args.name,
          category: args.category,
          categoryLabel: args.category,
          defaultOpacity: 0.9,
          colorsJson: [{ name: "Ivory", hex: "#e8dcc8" }],
          mountingsJson: ["outside", "inside"],
          createdById: user.id,
        },
      });
    }
    const existing = await db.visualizerCatalogAsset.count({
      where: { productId: product.id },
    });
    if (existing === 0) {
      const { putPrivateBlob, toProxyUrl } = await import(
        "../src/lib/files/blob-access"
      );
      for (const [i, asset] of args.assets.entries()) {
        const uploaded = await putPrivateBlob({
          pathname: `visualizer/preview-qa/${org!.id}/${product.id}/${asset.fileName}`,
          body: asset.buffer,
          contentType: "image/png",
        });
        const fileUrl = uploaded.proxyUrl || toProxyUrl(uploaded.pathname);
        await db.visualizerCatalogAsset.create({
          data: {
            productId: product.id,
            role: asset.role,
            fileUrl,
            fileName: asset.fileName,
            mimeType: "image/png",
            bytes: asset.buffer.length,
            width: 128,
            height: 128,
            sortOrder: i,
            isPrimary: i === 0,
            sourceType: "real",
            verificationStatus: "real_unverified",
          },
        });
      }
    }
    return product;
  }

  const p1 = await ensureProduct({
    name: "PREVIEW TEST - Ripple Fold Drapery",
    category: "drapery",
    assets: [
      { role: "texture", buffer: synthTexture(128, 128), fileName: "texture.png" },
      { role: "detail", buffer: synthTexture(96, 96), fileName: "detail.png" },
    ],
  });
  const p2 = await ensureProduct({
    name: "PREVIEW TEST - Limited Reference Drapery",
    category: "drapery",
    assets: [
      { role: "swatch", buffer: synthSwatch(), fileName: "swatch.png" },
    ],
  });

  return { user, org, p1, p2 };
}

async function downloadResult(cookie: string, exportImageUrl: string, dest: string) {
  const url = exportImageUrl.startsWith("http")
    ? exportImageUrl
    : `${PREVIEW_BASE}${exportImageUrl}`;
  const res = await fetch(url, {
    headers: bypassHeaders({ Cookie: cookie }),
  });
  if (!res.ok) throw new Error(`download export failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf;
}

function approxNotFlatColor(buf: Buffer): boolean {
  // PNG with structure should be much larger than a solid swatch; also check byte entropy proxy
  if (buf.length < 80_000) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 50_000));
  const hist = new Map<number, number>();
  for (let i = 0; i < sample.length; i += 17) {
    const b = sample[i]!;
    hist.set(b, (hist.get(b) || 0) + 1);
  }
  return hist.size > 40;
}

async function runSample(args: {
  cookie: string;
  orgId: string;
  productId: string;
  sampleName: string;
  roomSeed: number;
  expectLimitedWarning?: boolean;
}) {
  mkdirSync(OUT, { recursive: true });
  const room = synthRealisticRoom(768, 512, args.roomSeed);
  const roomPath = join(OUT, `${args.sampleName}-room.png`);
  writeFileSync(roomPath, room);

  // create customer + session via Preview API
  const customerRes = await api(args.cookie, "/api/sales/customers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": args.orgId,
    },
    body: JSON.stringify({
      name: `PREVIEW TEST - Visualizer HD Mask ${args.sampleName}`,
      email: null,
      phone: null,
      notes: MARKER,
      orgId: args.orgId,
    }),
  });
  if (customerRes.status >= 400) {
    // fallback: some installs use /api/customers
    console.log("customer create status", customerRes.status, customerRes.json?.error);
  }
  let customerId = customerRes.json?.customer?.id || customerRes.json?.id;
  if (!customerId) {
    // create via prisma on isolated only (still safe) then open session
    const db = new PrismaClient();
    const c = await db.salesCustomer.create({
      data: {
        name: `PREVIEW TEST - Visualizer HD Mask ${args.sampleName}`,
        createdById: (
          await db.user.findUniqueOrThrow({ where: { email: QA_EMAIL } })
        ).id,
        orgId: args.orgId,
        notes: MARKER,
      },
    });
    customerId = c.id;
    await db.$disconnect();
  }

  const sessionRes = await api(args.cookie, "/api/visualizer/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": args.orgId,
    },
    body: JSON.stringify({
      customerId,
      title: `PREVIEW TEST - Real Room HD ${args.sampleName}`,
    }),
  });
  if (sessionRes.status >= 400) {
    abort(`session create failed ${sessionRes.status} ${JSON.stringify(sessionRes.json)}`);
  }
  const sessionId = sessionRes.json.session?.id || sessionRes.json.id;
  if (!sessionId) abort("no sessionId");

  const form = new FormData();
  form.append(
    "file",
    new File([room], `${args.sampleName}-room.png`, { type: "image/png" }),
  );
  form.append("roomLabel", "Living");
  const imgRes = await fetch(
    `${PREVIEW_BASE}/api/visualizer/sessions/${sessionId}/images`,
    {
      method: "POST",
      headers: bypassHeaders({
        Cookie: args.cookie,
        "x-org-id": args.orgId,
      }),
      body: form,
    },
  );
  const imgJson = await imgRes.json();
  if (!imgRes.ok) abort(`image upload failed ${imgRes.status} ${JSON.stringify(imgJson)}`);
  const imageId = imgJson.image?.id || imgJson.id;
  const width = imgJson.image?.width || 768;
  const height = imgJson.image?.height || 512;

  const regionRes = await api(
    args.cookie,
    `/api/visualizer/images/${imageId}/regions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": args.orgId,
      },
      body: JSON.stringify({
        shape: "rect",
        points: [
          [Math.floor(width * 0.3), Math.floor(height * 0.16)],
          [Math.floor(width * 0.7), Math.floor(height * 0.58)],
        ],
        label: "W1",
      }),
    },
  );
  if (regionRes.status >= 400) {
    abort(`region create failed ${regionRes.status} ${JSON.stringify(regionRes.json)}`);
  }
  const regionId = regionRes.json.region?.id || regionRes.json.id;

  const variantRes = await api(
    args.cookie,
    `/api/visualizer/sessions/${sessionId}/variants`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": args.orgId,
      },
      body: JSON.stringify({ name: `Option ${args.sampleName}` }),
    },
  );
  if (variantRes.status >= 400) {
    abort(`variant create failed ${variantRes.status} ${JSON.stringify(variantRes.json)}`);
  }
  const variantId = variantRes.json.variant?.id || variantRes.json.id;

  const poRes = await api(
    args.cookie,
    `/api/visualizer/variants/${variantId}/product-options`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": args.orgId,
      },
      body: JSON.stringify({
        regionId,
        productCatalogId: args.productId,
        color: "Ivory",
        colorHex: "#e8dcc8",
        opacity: 0.9,
        mountingType: "outside",
      }),
    },
  );
  if (poRes.status >= 400) {
    abort(`product option failed ${poRes.status} ${JSON.stringify(poRes.json)}`);
  }

  const t0 = Date.now();
  const hdRes = await api(
    args.cookie,
    `/api/visualizer/variants/${variantId}/render-hd`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": args.orgId,
      },
      body: JSON.stringify({ sourceImageId: imageId }),
    },
  );
  const durationMs = Date.now() - t0;
  if (hdRes.status >= 400 || !hdRes.json?.exportImageUrl) {
    abort(
      `render-hd failed ${hdRes.status} ${JSON.stringify({
        error: hdRes.json?.error,
        code: hdRes.json?.code,
      })}`,
    );
  }

  const resultPath = join(OUT, `${args.sampleName}-result.png`);
  const resultBuf = await downloadResult(
    args.cookie,
    hdRes.json.exportImageUrl,
    resultPath,
  );
  const notFlat = approxNotFlatColor(resultBuf);
  const warningCode = hdRes.json.warningCode || null;
  const warning = hdRes.json.warning || null;

  // prove write landed on isolated DB
  const db = new PrismaClient();
  const v = await db.visualizerVariant.findUnique({
    where: { id: variantId },
    select: { exportImageUrl: true },
  });
  await db.$disconnect();
  if (!v?.exportImageUrl) abort("exportImageUrl missing in isolated DB");

  return {
    sampleName: args.sampleName,
    sessionId,
    variantId,
    imageId,
    durationMs,
    exportImageUrl: hdRes.json.exportImageUrl,
    warningCode,
    warning,
    notFlat,
    resultBytes: resultBuf.length,
    resultPath,
    sourceKind: hdRes.json.sourceImage?.kind || null,
    limitedWarningOk: args.expectLimitedWarning
      ? warningCode === "PRODUCT_REFERENCE_LIMITED" || !!warning
      : true,
  };
}

async function failurePath(args: {
  cookie: string;
  orgId: string;
  variantId: string;
  previousExport: string;
}) {
  // Call with fake sourceImageId to trigger SOURCE_ROOM / region failures without breaking keys
  const bad = await api(
    args.cookie,
    `/api/visualizer/variants/${args.variantId}/render-hd`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-org-id": args.orgId,
      },
      body: JSON.stringify({ sourceImageId: "nonexistent_source_image" }),
    },
  );
  const db = new PrismaClient();
  const v = await db.visualizerVariant.findUnique({
    where: { id: args.variantId },
    select: { exportImageUrl: true },
  });
  await db.$disconnect();
  const preserved = v?.exportImageUrl === args.previousExport;
  const failed = bad.status >= 400;
  const msg = String(bad.json?.error || "");
  const explicit =
    msg.includes("编辑预览") ||
    msg.includes("无法") ||
    !!bad.json?.code;
  return {
    failed,
    status: bad.status,
    code: bad.json?.code || null,
    error: msg.slice(0, 200),
    preservedPreviousExport: preserved,
    noFakeSuccess: failed && !bad.json?.exportImageUrl?.includes?.("new"),
    explicitError: explicit,
  };
}

async function main() {
  if (!PREVIEW_BASE) abort("PREVIEW_BASE required");
  assertSafeDb();
  mkdirSync(OUT, { recursive: true });

  // Prefer already-seeded QA credentials (scripts/seed-hd-mask-preview-qa.ts)
  let email = QA_EMAIL;
  let password = QA_PASSWORD;
  let orgId: string | null = null;
  let product1Id: string | null = null;
  let product2Id: string | null = null;
  const qaPath = join(OUT, "qa-login.local.json");
  if (existsSync(qaPath)) {
    const qa = JSON.parse(readFileSync(qaPath, "utf8")) as {
      email: string;
      password: string;
      orgId: string;
      product1Id: string;
      product2Id: string;
    };
    email = qa.email;
    password = qa.password;
    orgId = qa.orgId;
    product1Id = qa.product1Id;
    product2Id = qa.product2Id;
  }

  let seeded: Awaited<ReturnType<typeof seedIsolated>> | null = null;
  if (!orgId || !product1Id || !product2Id) {
    const db = new PrismaClient();
    seeded = await seedIsolated(db);
    await db.$disconnect();
    orgId = seeded.org.id;
    product1Id = seeded.p1.id;
    product2Id = seeded.p2.id;
    writeFileSync(
      qaPath,
      JSON.stringify(
        {
          email: QA_EMAIL,
          password: QA_PASSWORD,
          orgId,
          product1Id,
          product2Id,
          previewBase: PREVIEW_BASE,
          marker: MARKER,
        },
        null,
        2,
      ),
    );
    email = QA_EMAIL;
    password = QA_PASSWORD;
  }

  const cookie = await login(email, password);

  // isolation proof: create unique note via Preview session list after sample
  const sample1 = await runSample({
    cookie,
    orgId: orgId!,
    productId: product1Id!,
    sampleName: "sample1",
    roomSeed: 1,
  });
  const sample2 = await runSample({
    cookie,
    orgId: orgId!,
    productId: product2Id!,
    sampleName: "sample2",
    roomSeed: 2,
    expectLimitedWarning: true,
  });

  const fail = await failurePath({
    cookie,
    orgId: orgId!,
    variantId: sample1.variantId,
    previousExport: sample1.exportImageUrl,
  });

  // prove marker only on isolated DB
  const iso = new PrismaClient();
  const onIso = await iso.salesCustomer.count({
    where: { notes: MARKER },
  });
  await iso.$disconnect();

  const summary = {
    at: new Date().toISOString(),
    previewBase: PREVIEW_BASE,
    neonHost: ENDPOINT_HOST.replace(/[a-z0-9]{6}\./i, "….."),
    marker: MARKER,
    customersOnIsolated: onIso,
    sample1: {
      ...sample1,
      exportImageUrl: createHash("sha256")
        .update(sample1.exportImageUrl)
        .digest("hex")
        .slice(0, 12),
    },
    sample2: {
      ...sample2,
      exportImageUrl: createHash("sha256")
        .update(sample2.exportImageUrl)
        .digest("hex")
        .slice(0, 12),
    },
    failurePath: fail,
    gates: {
      sample1NotFlat: sample1.notFlat,
      sample2NotFlat: sample2.notFlat,
      exportWritten: !!sample1.exportImageUrl && !!sample2.exportImageUrl,
      failurePreserved: fail.preservedPreviousExport && fail.failed,
      isolationWrites: onIso >= 1,
    },
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  const ok =
    sample1.notFlat &&
    sample2.notFlat &&
    fail.preservedPreviousExport &&
    fail.failed &&
    onIso >= 1;
  if (!ok) process.exit(1);
  console.log("PREVIEW_ACCEPTANCE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
