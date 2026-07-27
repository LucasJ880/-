/* eslint-disable no-console */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { deflateSync } from "zlib";
import { putPrivateBlob } from "../src/lib/files/blob-access";

const db = new PrismaClient();

function png(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number],
) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const [r, g, b] = paint(x, y);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]!;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const tb = Buffer.from(t);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length, 0);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([tb, d])), 0);
    return Buffer.concat([len, tb, d, c]);
  };
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  const u = new URL(process.env.DATABASE_URL || "");
  if (u.hostname.includes("super-field") || !u.hostname.includes("raspy-credit")) {
    throw new Error("unsafe db " + u.hostname);
  }
  const email = "hd-mask-preview-qa@test.qingyan.ai";
  const password = `HdMaskQa!${randomBytes(4).toString("hex")}`;
  const hash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email },
    update: {
      passwordHash: hash,
      status: "active",
      role: "admin",
      name: "HD Mask Preview QA",
    },
    create: {
      email,
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

  const texture = png(128, 128, (x, y) =>
    Math.floor((x + y) / 7) % 2 ? [215, 200, 175] : [195, 180, 155],
  );
  const detail = png(96, 96, (x) =>
    Math.floor(x / 5) % 2 ? [200, 185, 160] : [180, 165, 145],
  );
  const swatch = png(64, 64, () => [232, 220, 200]);

  async function ensureProduct(
    name: string,
    assets: Array<{ role: string; buffer: Buffer; fileName: string }>,
  ) {
    let p = await db.visualizerCatalogProduct.findFirst({
      where: { orgId: org!.id, name, archived: false },
    });
    if (!p) {
      p = await db.visualizerCatalogProduct.create({
        data: {
          orgId: org!.id,
          name,
          category: "drapery",
          categoryLabel: "布帘",
          defaultOpacity: 0.9,
          colorsJson: [{ name: "Ivory", hex: "#e8dcc8" }],
          mountingsJson: ["outside", "inside"],
          createdById: user.id,
        },
      });
    }
    const n = await db.visualizerCatalogAsset.count({
      where: { productId: p.id },
    });
    if (n === 0) {
      for (const [i, a] of assets.entries()) {
        const up = await putPrivateBlob({
          pathname: `visualizer/preview-qa/${org!.id}/${p.id}/${a.fileName}`,
          body: a.buffer,
          contentType: "image/png",
        });
        await db.visualizerCatalogAsset.create({
          data: {
            productId: p.id,
            role: a.role,
            fileUrl: up.proxyUrl,
            fileName: a.fileName,
            mimeType: "image/png",
            bytes: a.buffer.length,
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
    return p;
  }

  const p1 = await ensureProduct("PREVIEW TEST - Ripple Fold Drapery", [
    { role: "texture", buffer: texture, fileName: "texture.png" },
    { role: "detail", buffer: detail, fileName: "detail.png" },
  ]);
  const p2 = await ensureProduct("PREVIEW TEST - Limited Reference Drapery", [
    { role: "swatch", buffer: swatch, fileName: "swatch.png" },
  ]);

  mkdirSync("tmp/visualizer-hd-e2e/preview-acceptance", { recursive: true });
  writeFileSync(
    "tmp/visualizer-hd-e2e/preview-acceptance/qa-login.local.json",
    JSON.stringify(
      {
        email,
        password,
        orgId: org.id,
        product1Id: p1.id,
        product2Id: p2.id,
        previewBase:
          "https://1fjstwfyh-bja2sulg3-lucas-9039s-projects.vercel.app",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { seeded: true, orgId: org.id, p1: p1.id, p2: p2.id, email },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
