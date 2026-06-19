/**
 * iLink 出站报文构造测试：sendText / sendImage 信封结构、client_id 唯一、长文本分片。
 * 运行：npx tsx src/lib/messaging/adapters/__tests__/ilink-send-payload.test.ts
 */
import {
  buildSendTextPayload,
  buildSendImagePayload,
  splitMessage,
  encodeOutboundAesKey,
  MESSAGE_TYPE_BOT,
  MESSAGE_STATE_FINISH,
  ITEM_TYPE,
} from "../ilink-media";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// sendText 信封
{
  const p = buildSendTextPayload({ toUserId: "wxid_c", contextToken: "ctx-1", text: "你好" });
  ok(p.msg.from_user_id === "", "from_user_id 为空字符串");
  ok(p.msg.to_user_id === "wxid_c", "to_user_id 正确");
  ok(p.msg.message_type === MESSAGE_TYPE_BOT && p.msg.message_type === 2, "message_type=2");
  ok(p.msg.message_state === MESSAGE_STATE_FINISH && p.msg.message_state === 2, "message_state=2");
  ok(p.msg.context_token === "ctx-1", "回传 context_token");
  ok(typeof p.msg.client_id === "string" && p.msg.client_id.length > 0, "含 client_id");
  ok(p.msg.item_list.length === 1, "单 item");
  ok(p.msg.item_list[0].type === ITEM_TYPE.TEXT, "item type=文本");
  ok(p.msg.item_list[0].text_item.text === "你好", "文本内容");
  ok(p.base_info.channel_version.length > 0, "含 base_info.channel_version");
}

// client_id 唯一性
{
  const a = buildSendTextPayload({ toUserId: "u", contextToken: "c", text: "x" });
  const b = buildSendTextPayload({ toUserId: "u", contextToken: "c", text: "x" });
  ok(a.msg.client_id !== b.msg.client_id, "每条 client_id 唯一");
}

// 指定 client_id 透传
{
  const p = buildSendTextPayload({ toUserId: "u", contextToken: "c", text: "x", clientId: "fixed-id" });
  ok(p.msg.client_id === "fixed-id", "可指定 client_id");
}

// sendImage 信封
{
  const hex = "00112233445566778899aabbccddeeff";
  const p = buildSendImagePayload({
    toUserId: "wxid_c",
    contextToken: "ctx-2",
    encryptQueryParam: "EQP-abc",
    aesKeyHex: hex,
    midSize: 8192,
  });
  ok(p.msg.message_type === 2 && p.msg.message_state === 2, "图片 message_type/state");
  ok(p.msg.context_token === "ctx-2", "图片回传 context_token");
  const item = p.msg.item_list[0];
  ok(item.type === ITEM_TYPE.IMAGE, "item type=图片");
  ok(item.image_item.media.encrypt_query_param === "EQP-abc", "media.encrypt_query_param");
  ok(item.image_item.media.aes_key === encodeOutboundAesKey(hex), "media.aes_key=base64(hex)");
  ok(item.image_item.media.encrypt_type === 1, "media.encrypt_type=1");
  ok(item.image_item.mid_size === 8192, "mid_size 透传");
}

// 长文本分片
{
  ok(splitMessage("short", 2000).length === 1, "短文本不分片");
  const long = "a".repeat(5000);
  const segs = splitMessage(long, 2000);
  ok(segs.length === 3, "5000 字符按 2000 分 3 片");
  ok(segs.every((s) => s.length <= 2000), "每片不超长");
  ok(segs.join("") === long, "硬切分片可拼回原文");

  const paras = "段一".repeat(600) + "\n\n" + "段二".repeat(600);
  const segs2 = splitMessage(paras, 2000);
  ok(segs2.length >= 2, "按段落优先分片");
}

console.log(`ilink-send-payload: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
