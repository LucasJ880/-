/**
 * 企业微信回调加解密/验签测试：
 * - decryptCallback 对合法密文 + 正确签名 → 还原内层消息 XML
 * - 签名被篡改 → 返回 null（拒绝伪造）
 * - 密文非法 → 返回 null
 *
 * 运行：npx tsx src/lib/messaging/adapters/__tests__/wecom-crypto.test.ts
 */
import crypto from "crypto";
import { WeComAdapter, parseWeComMessageXml } from "../wecom";

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

const TOKEN = "qingyan_test_token";
const RECEIVE_ID = "ww_corp_test_id";
// encodingAESKey：43 字符 base64（去掉末尾补位 '='），解码后为 32 字节
const AES_KEY_RAW = crypto.randomBytes(32);
const ENCODING_AES_KEY = AES_KEY_RAW.toString("base64").slice(0, 43);

/** 模拟企业微信侧加密：random(16) + len(4 BE) + msg + receiveid，PKCS7 补位，AES-256-CBC。 */
function wecomEncrypt(msgXml: string): string {
  const key = Buffer.from(ENCODING_AES_KEY + "=", "base64");
  const iv = key.subarray(0, 16);
  const random = crypto.randomBytes(16);
  const msg = Buffer.from(msgXml, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  const receive = Buffer.from(RECEIVE_ID, "utf-8");
  let raw = Buffer.concat([random, lenBuf, msg, receive]);

  const blockSize = 32;
  const padLen = blockSize - (raw.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  raw = Buffer.concat([raw, pad]);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(raw), cipher.final()]);
  return enc.toString("base64");
}

function sign(timestamp: string, nonce: string, encrypt: string): string {
  const sorted = [TOKEN, timestamp, nonce, encrypt].sort().join("");
  return crypto.createHash("sha1").update(sorted).digest("hex");
}

function makeAdapter(): WeComAdapter {
  const adapter = new WeComAdapter("org_test");
  // 注入配置，避免依赖 DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (adapter as any).config = {
    corpId: RECEIVE_ID,
    agentId: "1000002",
    secret: "secret",
    callbackToken: TOKEN,
    encodingKey: ENCODING_AES_KEY,
  };
  return adapter;
}

const innerXml =
  "<xml><ToUserName><![CDATA[ww_corp]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName>" +
  "<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[窗帘白底图出一张]]></Content><MsgId>123456</MsgId></xml>";

// 合法：验签 + 解密还原
{
  const adapter = makeAdapter();
  const encrypt = wecomEncrypt(innerXml);
  const ts = "1700000000";
  const nonce = "rand123";
  const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
  const sig = sign(ts, nonce, encrypt);
  const plain = adapter.decryptCallback(body, sig, ts, nonce);
  ok(plain === innerXml, "合法密文+正确签名 → 还原内层 XML");
}

// 篡改签名 → null
{
  const adapter = makeAdapter();
  const encrypt = wecomEncrypt(innerXml);
  const ts = "1700000000";
  const nonce = "rand123";
  const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`;
  const badSig = sign(ts, nonce, encrypt).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  const plain = adapter.decryptCallback(body, badSig, ts, nonce);
  ok(plain === null, "篡改签名 → null（拒绝伪造）");
}

// 缺少 Encrypt 标签 → null
{
  const adapter = makeAdapter();
  const plain = adapter.decryptCallback("<xml></xml>", "sig", "1", "n");
  ok(plain === null, "无 Encrypt 标签 → null");
}

// echostr 验证（GET URL 验证）往返
{
  const adapter = makeAdapter();
  const echo = wecomEncrypt("<xml><Content><![CDATA[echo_test_str]]></Content></xml>");
  const ts = "1700000001";
  const nonce = "n2";
  const sig = sign(ts, nonce, echo);
  const plain = adapter.verifyCallback(sig, ts, nonce, echo);
  ok(
    plain === "<xml><Content><![CDATA[echo_test_str]]></Content></xml>",
    "verifyCallback 还原 echostr",
  );
}

// 内层消息 XML 解析：必须取到叶子标签（不能被最外层 <xml> 吞掉）
{
  const xml =
    "<xml><ToUserName><![CDATA[ww_corp]]></ToUserName>" +
    "<FromUserName><![CDATA[zhangsan]]></FromUserName>" +
    "<CreateTime>1700000000</CreateTime>" +
    "<MsgType><![CDATA[text]]></MsgType>" +
    "<Content><![CDATA[窗帘白底图出一张]]></Content>" +
    "<MsgId>1234567890</MsgId><AgentID>1000002</AgentID></xml>";
  const p = parseWeComMessageXml(xml);
  ok(p.FromUserName === "zhangsan", "parse: FromUserName");
  ok(p.Content === "窗帘白底图出一张", "parse: Content(CDATA)");
  ok(p.MsgType === "text", "parse: MsgType");
  ok(p.MsgId === "1234567890", "parse: MsgId(纯文本)");
  ok(p.xml === undefined, "parse: 不把最外层 <xml> 当作字段");
}

// 图片消息：取 MediaId/PicUrl
{
  const xml =
    "<xml><FromUserName><![CDATA[lisi]]></FromUserName><MsgType><![CDATA[image]]></MsgType>" +
    "<PicUrl><![CDATA[http://x/y.jpg]]></PicUrl><MediaId><![CDATA[MEDIA_abc]]></MediaId><MsgId>99</MsgId></xml>";
  const p = parseWeComMessageXml(xml);
  ok(p.MsgType === "image" && p.MediaId === "MEDIA_abc", "parse: 图片 MediaId");
}

console.log(`\nwecom-crypto: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
