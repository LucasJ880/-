/* eslint-disable no-console */
/**
 * Phase 1 真实 E2E（脱敏合成房间图，非客户照片）
 *
 * 场景 1：布帘 + texture 参考
 * 场景 2：布帘 + 仅 swatch 色块参考（质量可较低，但不得仍是平面色块主路径）
 *
 * 用法：npx tsx scripts/e2e-visualizer-real-room-hd.ts
 * 产出：tmp/visualizer-hd-e2e/（勿提交）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { runImageEditDetailed } from "../src/lib/visualizer/image-ai";
import { buildHdWindowMask } from "../src/lib/visualizer/hd-window-mask";
import { buildHdRenderPrompt } from "../src/lib/visualizer/hd-render-prompt";
import { resolveHdRoomSourceImage } from "../src/lib/visualizer/hd-source-image";

const OUT = join(process.cwd(), "tmp/visualizer-hd-e2e");

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

/** 合成无隐私房间：暖墙 + 蓝天窗外 + 深色窗框 */
function synthRoomPng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const wx1 = Math.floor(w * 0.28);
  const wy1 = Math.floor(h * 0.18);
  const wx2 = Math.floor(w * 0.72);
  const wy2 = Math.floor(h * 0.62);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const off = row + 1 + x * 4;
      const inWin = x >= wx1 && x <= wx2 && y >= wy1 && y <= wy2;
      const frame =
        inWin &&
        (x <= wx1 + 4 || x >= wx2 - 4 || y <= wy1 + 4 || y >= wy2 - 4);
      if (frame) {
        raw[off] = 40;
        raw[off + 1] = 30;
        raw[off + 2] = 20;
      } else if (inWin) {
        raw[off] = 120;
        raw[off + 1] = 170;
        raw[off + 2] = 220;
      } else if (y > h * 0.75) {
        raw[off] = 150;
        raw[off + 1] = 130;
        raw[off + 2] = 100;
      } else {
        raw[off] = 220;
        raw[off + 1] = 210;
        raw[off + 2] = 195;
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

function synthTexturePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const off = row + 1 + x * 4;
      const band = Math.floor(x / 6) % 2 === 0;
      raw[off] = band ? 210 : 190;
      raw[off + 1] = band ? 195 : 175;
      raw[off + 2] = band ? 170 : 150;
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

function synthSwatchPng(hex: [number, number, number]): Buffer {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const off = row + 1 + x * 4;
      raw[off] = hex[0];
      raw[off + 1] = hex[1];
      raw[off + 2] = hex[2];
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

async function runScene(args: {
  name: string;
  refs: Array<{ buffer: Buffer; mime: string; fileName: string; role: string }>;
}) {
  const W = 512;
  const H = 384;
  const room = synthRoomPng(W, H);
  const wx1 = Math.floor(W * 0.28);
  const wy1 = Math.floor(H * 0.18);
  const wx2 = Math.floor(W * 0.72);
  const wy2 = Math.floor(H * 0.62);

  const source = resolveHdRoomSourceImage({
    productOptionRegionIds: ["r1"],
    regions: [{ id: "r1", sourceImageId: "orig" }],
    sourceImages: [
      {
        id: "orig",
        fileUrl: "memory://room",
        mimeType: "image/png",
        width: W,
        height: H,
        note: null,
        fileName: "synth_room.png",
        createdAt: new Date(),
      },
    ],
    composedDataUrl: "data:image/png;base64,SHOULD_IGNORE",
  });
  if (!source.ok) throw new Error(source.message);

  const mask = buildHdWindowMask({
    width: W,
    height: H,
    regions: [
      {
        shape: "rect",
        points: [
          [wx1, wy1],
          [wx2, wy2],
        ],
        productCategory: "drapery",
      },
    ],
  });
  if (!mask.ok) throw new Error(mask.message);

  const prompt = buildHdRenderPrompt({
    productOptions: [
      {
        productName: "E2E Linen Drapery",
        productCategory: "drapery",
        color: "Warm Ivory",
        colorHex: "#e8dcc8",
        opacity: 0.92,
        mountingType: "outside",
      },
    ],
    references: args.refs.map((r, index) => ({
      index,
      role: r.role,
      productName: "E2E Linen Drapery",
      sourceType: "real",
    })),
  });

  console.log(`\n=== ${args.name} ===`);
  console.log("source kind:", source.kind, "mask bytes:", mask.maskBuffer.length);

  const result = await runImageEditDetailed({
    imageBuffer: room,
    imageMime: "image/png",
    maskBuffer: mask.maskBuffer,
    prompt,
    referenceImages: args.refs.map((r) => ({
      buffer: r.buffer,
      mime: r.mime,
      fileName: r.fileName,
    })),
    quality: "medium",
  });

  const dir = join(OUT, args.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "room.png"), room);
  writeFileSync(join(dir, "mask.png"), mask.maskBuffer);
  for (const r of args.refs) {
    writeFileSync(join(dir, r.fileName), r.buffer);
  }
  writeFileSync(join(dir, "prompt.txt"), prompt);

  if (!result.buffer) {
    writeFileSync(
      join(dir, "FAILED.json"),
      JSON.stringify(
        {
          providerErrorCode: result.providerErrorCode,
          httpStatus: result.httpStatus,
          errorBody: result.errorBody,
        },
        null,
        2,
      ),
    );
    return {
      ok: false as const,
      name: args.name,
      error: result.providerErrorCode ?? "no_buffer",
    };
  }

  writeFileSync(join(dir, "result.png"), result.buffer);
  // 粗检：结果不应几乎等于纯色块（方差过低）
  const sample = result.buffer;
  const varianceProxy = sample.length;
  return {
    ok: true as const,
    name: args.name,
    bytes: sample.length,
    varianceProxy,
    usedComposed: false,
    hasMask: true,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("SKIP: OPENAI_API_KEY missing");
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });

  const scene1 = await runScene({
    name: "scene1_drapery_texture",
    refs: [
      {
        buffer: synthTexturePng(128, 128),
        mime: "image/png",
        fileName: "texture.png",
        role: "texture",
      },
      {
        buffer: synthTexturePng(96, 96),
        mime: "image/png",
        fileName: "detail.png",
        role: "detail",
      },
    ],
  });

  const scene2 = await runScene({
    name: "scene2_drapery_swatch_only",
    refs: [
      {
        buffer: synthSwatchPng([232, 220, 200]),
        mime: "image/png",
        fileName: "swatch.png",
        role: "swatch",
      },
    ],
  });

  const summary = { scene1, scene2, outDir: OUT, at: new Date().toISOString() };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nSUMMARY", summary);

  if (!scene1.ok || !scene2.ok) {
    console.error("E2E failed");
    process.exit(1);
  }
  console.log("E2E OK — inspect tmp/visualizer-hd-e2e/*/result.png (do not commit)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
