/**
 * iLink 媒体纯函数测试：AES-128-ECB 加解密、key 双编码、密文大小公式、出站 key 编码、图片嗅探。
 * 运行：npx tsx src/lib/messaging/adapters/__tests__/ilink-media.test.ts
 */
import crypto from "crypto";
import {
  aesEcbEncrypt,
  aesEcbDecrypt,
  decodeAesKey,
  encodeOutboundAesKey,
  cipherFileSize,
  sniffImageMime,
  extFromMime,
} from "../ilink-media";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
function eq(a: unknown, b: unknown, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// AES 往返
{
  const key = crypto.randomBytes(16);
  const plain = Buffer.from("青砚外贸窗帘需求图片字节" + "x".repeat(100), "utf8");
  const enc = aesEcbEncrypt(plain, key);
  ok(enc.length % 16 === 0, "密文长度为 16 倍数");
  const dec = aesEcbDecrypt(enc, key);
  ok(dec.equals(plain), "AES-128-ECB 加解密往返一致");
}

// 非 16 字节 key 抛错
{
  let threw = false;
  try {
    aesEcbEncrypt(Buffer.from("abc"), Buffer.alloc(15));
  } catch {
    threw = true;
  }
  ok(threw, "非 16 字节 key 抛错");
}

// decodeAesKey 编码 A：image_item.aeskey 32 位 hex
{
  const raw = crypto.randomBytes(16);
  const hex = raw.toString("hex");
  const decoded = decodeAesKey({ aesKeyHex: hex });
  ok(decoded.equals(raw), "decodeAesKey: 32位hex → 16字节");
}

// decodeAesKey 编码 B1：media.aes_key base64 of 16 raw bytes
{
  const raw = crypto.randomBytes(16);
  const b64 = raw.toString("base64");
  const decoded = decodeAesKey({ aesKeyB64: b64 });
  ok(decoded.equals(raw), "decodeAesKey: base64(16字节) → 16字节");
}

// decodeAesKey 编码 B2：media.aes_key base64 of 32-char ascii-hex
{
  const raw = crypto.randomBytes(16);
  const hex = raw.toString("hex"); // 32 chars
  const b64 = Buffer.from(hex, "utf8").toString("base64");
  const decoded = decodeAesKey({ aesKeyB64: b64 });
  ok(decoded.equals(raw), "decodeAesKey: base64(32位hex字符串) → 16字节");
}

// decodeAesKey 优先 hex
{
  const raw = crypto.randomBytes(16);
  const hex = raw.toString("hex");
  const decoded = decodeAesKey({ aesKeyHex: hex, aesKeyB64: "garbage" });
  ok(decoded.equals(raw), "decodeAesKey: 优先用 aesKeyHex");
}

// 无效 key 抛错
{
  let threw = false;
  try {
    decodeAesKey({ aesKeyB64: "" });
  } catch {
    threw = true;
  }
  ok(threw, "decodeAesKey: 无有效来源时抛错");
}

// 出站 aes_key 编码：base64(hex string)
{
  const hex = "00112233445566778899aabbccddeeff";
  const out = encodeOutboundAesKey(hex);
  eq(out, Buffer.from(hex, "utf8").toString("base64"), "encodeOutboundAesKey = base64(hex)");
  eq(Buffer.from(out, "base64").toString("utf8"), hex, "出站 key 可被解回原 hex");
}

// cipherFileSize 公式：ceil((rawsize+1)/16)*16
{
  eq(cipherFileSize(0), 16, "cipherFileSize(0)=16");
  eq(cipherFileSize(15), 16, "cipherFileSize(15)=16");
  eq(cipherFileSize(16), 32, "cipherFileSize(16)=32 (因 +1)");
  eq(cipherFileSize(31), 32, "cipherFileSize(31)=32");
  eq(cipherFileSize(32), 48, "cipherFileSize(32)=48");
  // 与实际加密长度一致（PKCS7：rawsize+1..rawsize+16）
  const raw = crypto.randomBytes(20);
  const enc = aesEcbEncrypt(raw, crypto.randomBytes(16));
  eq(enc.length, cipherFileSize(20), "cipherFileSize 与实际密文长度一致");
}

// 图片嗅探
{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  eq(sniffImageMime(png), "image/png", "嗅探 PNG");
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  eq(sniffImageMime(jpg), "image/jpeg", "嗅探 JPEG");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
  eq(sniffImageMime(webp), "image/webp", "嗅探 WEBP");
  const gif = Buffer.from("GIF89a\x00\x00", "binary");
  eq(sniffImageMime(gif), "image/gif", "嗅探 GIF");
  eq(sniffImageMime(Buffer.from("hello world")), null, "非图片返回 null");
  eq(extFromMime("image/jpeg"), "jpg", "extFromMime jpeg");
  eq(extFromMime("image/webp"), "webp", "extFromMime webp");
  eq(extFromMime("image/png"), "png", "extFromMime png 默认");
}

console.log(`ilink-media: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
