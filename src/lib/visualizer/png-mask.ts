import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
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

function pointInPolygon(x: number, y: number, points: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function bounds(points: Array<[number, number]>) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function isInsideMask(
  x: number,
  y: number,
  shape: "rect" | "polygon",
  points: Array<[number, number]>,
): boolean {
  if (shape === "rect") {
    const b = bounds(points);
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
  }
  return pointInPolygon(x, y, points);
}

/** OpenAI image edit mask：透明区域允许编辑，不透明区域保持原图。 */
export function createTransparentEditMaskPng(args: {
  width: number;
  height: number;
  shape: "rect" | "polygon";
  points: Array<[number, number]>;
}): Buffer {
  const { width, height, shape, points } = args;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid image size");
  }
  if (points.length < 2) throw new Error("Mask points missing");

  const raw = Buffer.alloc((width * 4 + 1) * height);
  const b = bounds(points);
  const bx1 = Math.max(0, Math.floor(b.x1));
  const by1 = Math.max(0, Math.floor(b.y1));
  const bx2 = Math.min(width - 1, Math.ceil(b.x2));
  const by2 = Math.min(height - 1, Math.ceil(b.y2));

  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const off = row + 1 + x * 4;
      const maybeInside = x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
      const editable = maybeInside && isInsideMask(x + 0.5, y + 0.5, shape, points);
      raw[off] = 0;
      raw[off + 1] = 0;
      raw[off + 2] = 0;
      raw[off + 3] = editable ? 0 : 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
