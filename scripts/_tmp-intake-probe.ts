import crypto from "crypto";
import { WeComAdapter } from "@/lib/messaging/adapters/wecom";

const TOKEN = "9fii2rsEXaSes8quOd0er5A7";
const AESK = "take1F5LJH385LIujlDavYVNPj934eeCpedISRRMKFp";
const CORP = "ww706a5080815bdbec";

function enc(msg: string): string {
  const key = Buffer.from(AESK + "=", "base64");
  const iv = key.subarray(0, 16);
  const rnd = crypto.randomBytes(16);
  const m = Buffer.from(msg, "utf8");
  const l = Buffer.alloc(4);
  l.writeUInt32BE(m.length, 0);
  let raw = Buffer.concat([rnd, l, m, Buffer.from(CORP, "utf8")]);
  const bs = 32;
  const pad = bs - (raw.length % bs);
  raw = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const c = crypto.createCipheriv("aes-256-cbc", key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(raw), c.final()]).toString("base64");
}

const adapter = new WeComAdapter("org_test");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(adapter as any).config = {
  corpId: CORP,
  agentId: "1000002",
  secret: "x",
  callbackToken: TOKEN,
  encodingKey: AESK,
};

const inner = `<xml><ToUserName><![CDATA[${CORP}]]></ToUserName><FromUserName><![CDATA[SimUser1]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[做一张白底窗帘主图]]></Content><MsgId>123</MsgId></xml>`;
const e = enc(inner);
const ts = String(Math.floor(Date.now() / 1000));
const nonce = "n123";
const sig = crypto.createHash("sha1").update([TOKEN, ts, nonce, e].sort().join("")).digest("hex");
const body = `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`;

const plain = adapter.decryptCallback(body, sig, ts, nonce);
console.log("decryptCallback →", plain === null ? "NULL (失败)" : "OK, 还原 inner XML 长度=" + plain.length);
if (plain) console.log("content ok:", plain.includes("做一张白底窗帘主图"));
process.exit(0);
