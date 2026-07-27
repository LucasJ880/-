import { inflateSync } from "node:zlib";

/** 解码本仓库自生成的 RGBA PNG（filter 0），用于 mask 单测 */
export function decodeSimpleRgbaPng(buf: Buffer): {
  width: number;
  height: number;
  rgba: Buffer;
} {
  if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not png");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString("ascii");
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const stride = width * 4 + 1;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error(`unsupported filter ${filter}`);
    raw.copy(rgba, y * width * 4, y * stride + 1, y * stride + 1 + width * 4);
  }
  return { width, height, rgba };
}

export function alphaAt(
  decoded: { width: number; rgba: Buffer },
  x: number,
  y: number,
): number {
  return decoded.rgba[(y * decoded.width + x) * 4 + 3]!;
}
