/**
 * iLink getupdates 报文解析测试：文本/图片 item、context_token、游标、-14 会话失效。
 * 运行：npx tsx src/lib/messaging/adapters/__tests__/ilink-parse.test.ts
 */
import { parseGetUpdates } from "../ilink-media";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// 文本 + 图片混合
{
  const data = {
    get_updates_buf: "cursor-2",
    longpolling_timeout_ms: 35000,
    msgs: [
      {
        message_id: "m1",
        from_user_id: "wxid_client_a",
        context_token: "ctx-aaa",
        create_time_ms: 1718000000000,
        item_list: [{ type: 1, text_item: { text: "我要窗帘白底主图" } }],
      },
      {
        message_id: "m2",
        from_user_id: "wxid_client_a",
        context_token: "ctx-bbb",
        item_list: [
          {
            type: 2,
            image_item: {
              aeskey: "00112233445566778899aabbccddeeff",
              mid_size: 4096,
              media: {
                encrypt_query_param: "EQP-xyz",
                aes_key: "QUJD",
                encrypt_type: 1,
              },
            },
          },
        ],
      },
    ],
  };
  const parsed = parseGetUpdates(data);
  ok(!parsed.sessionExpired, "未失效");
  ok(parsed.nextBuf === "cursor-2", "解析 get_updates_buf 游标");
  ok(parsed.longPollTimeoutMs === 35000, "解析长轮询超时");
  ok(parsed.msgs.length === 2, "解析 2 条消息");

  const text = parsed.msgs[0];
  ok(text.messageId === "m1", "msg1 id");
  ok(text.fromUserId === "wxid_client_a", "msg1 from");
  ok(text.contextToken === "ctx-aaa", "msg1 context_token");
  ok(text.createTimeMs === 1718000000000, "msg1 create_time_ms");
  ok(text.items.length === 1 && text.items[0].type === 1, "msg1 单个文本 item");
  ok(text.items[0].text === "我要窗帘白底主图", "msg1 文本内容");

  const img = parsed.msgs[1];
  ok(img.items.length === 1 && img.items[0].type === 2, "msg2 图片 item");
  const ref = img.items[0].image!;
  ok(ref.encryptQueryParam === "EQP-xyz", "图片 encrypt_query_param");
  ok(ref.aesKeyHex === "00112233445566778899aabbccddeeff", "图片 aeskey(hex)");
  ok(ref.aesKeyB64 === "QUJD", "图片 media.aes_key(base64)");
  ok(ref.encryptType === 1, "图片 encrypt_type");
  ok(ref.midSize === 4096, "图片 mid_size");
}

// -14 会话失效
{
  const parsed = parseGetUpdates({ ret: -14 });
  ok(parsed.sessionExpired, "ret=-14 → sessionExpired");
  ok(parsed.msgs.length === 0, "失效无消息");
  const parsed2 = parseGetUpdates({ errcode: -14 });
  ok(parsed2.sessionExpired, "errcode=-14 → sessionExpired");
}

// 空 / 异常输入容错
{
  ok(parseGetUpdates(null).msgs.length === 0, "null 输入安全");
  ok(parseGetUpdates({}).msgs.length === 0, "空对象安全");
  ok(parseGetUpdates({ msgs: [{ item_list: [] }] }).msgs.length === 0, "无 from_user_id 丢弃");
}

// 文本为空的 item 跳过
{
  const parsed = parseGetUpdates({
    msgs: [{ from_user_id: "u", item_list: [{ type: 1, text_item: { text: "" } }] }],
  });
  ok(parsed.msgs[0].items.length === 0, "空文本 item 被跳过");
}

console.log(`ilink-parse: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
