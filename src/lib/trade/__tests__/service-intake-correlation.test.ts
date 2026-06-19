/**
 * 外贸受理路由 / 关联 / 幂等测试（依赖注入，无 DB / 无网络）。
 * 验证：文本→文本受理、图片→图片受理、空文本不处理、未知类型不处理、message_id 幂等去重。
 * 运行：npx tsx src/lib/trade/__tests__/service-intake-correlation.test.ts
 */
import { createTradeIntakeMessageHandler } from "../service-intake";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function makeHarness() {
  const calls: { kind: "text" | "image"; externalUserId: string }[] = [];
  const replies: { to: string; content: string }[] = [];

  const handler = createTradeIntakeMessageHandler(
    "org_client_cn",
    async (to, content) => {
      replies.push({ to, content });
    },
    {
      autoFulfillmentOrgId: "org_canada",
      deps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handleText: (async (input: any) => {
          calls.push({ kind: "text", externalUserId: input.externalUserId });
          return { reply: "文本已受理", created: true, requestId: "r-text" };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handleImage: (async (input: any) => {
          calls.push({ kind: "image", externalUserId: input.externalUserId });
          return { reply: "图片已受理", created: false, requestId: "r-img" };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      },
    },
  );

  return { handler, calls, replies };
}

async function run() {
  // 工厂参数校验：拒绝 default / 空 org
  {
    let threw = false;
    try {
      createTradeIntakeMessageHandler("default", async () => {});
    } catch {
      threw = true;
    }
    ok(threw, "拒绝 default org");
    let threw2 = false;
    try {
      createTradeIntakeMessageHandler("  ", async () => {});
    } catch {
      threw2 = true;
    }
    ok(threw2, "拒绝空 org");
  }

  // 文本路由
  {
    const h = makeHarness();
    await h.handler({
      channel: "personal_wechat",
      externalUserId: "u1",
      content: "我要窗帘白底主图",
      messageType: "text",
      externalMsgId: "msg-1",
    });
    ok(h.calls.length === 1 && h.calls[0].kind === "text", "文本→文本受理");
    ok(h.replies.length === 1 && h.replies[0].content === "文本已受理", "文本回复回传");
    ok(h.replies[0].to === "u1", "回复发给来源用户");
  }

  // 图片路由
  {
    const h = makeHarness();
    await h.handler({
      channel: "personal_wechat",
      externalUserId: "u2",
      content: "",
      messageType: "image",
      externalMsgId: "msg-2",
      media: { bytes: Buffer.from([1, 2, 3]), mimeType: "image/png" },
    });
    ok(h.calls.length === 1 && h.calls[0].kind === "image", "图片→图片受理");
    ok(h.replies.length === 1 && h.replies[0].content === "图片已受理", "图片回复回传");
  }

  // 空文本不处理
  {
    const h = makeHarness();
    await h.handler({
      channel: "personal_wechat",
      externalUserId: "u3",
      content: "   ",
      messageType: "text",
      externalMsgId: "msg-3",
    });
    ok(h.calls.length === 0 && h.replies.length === 0, "空文本不建单不回复");
  }

  // 未知类型不处理
  {
    const h = makeHarness();
    await h.handler({
      channel: "personal_wechat",
      externalUserId: "u4",
      content: "voice",
      messageType: "voice",
      externalMsgId: "msg-4",
    });
    ok(h.calls.length === 0, "语音类型不受理");
  }

  // 图片类型但缺 media → 不当作图片，也不当文本（无内容）
  {
    const h = makeHarness();
    await h.handler({
      channel: "personal_wechat",
      externalUserId: "u5",
      content: "",
      messageType: "image",
      externalMsgId: "msg-5",
    });
    ok(h.calls.length === 0, "图片缺 media 时跳过");
  }

  // message_id 幂等：同 id 重投只处理一次
  {
    const h = makeHarness();
    const msg = {
      channel: "personal_wechat",
      externalUserId: "u6",
      content: "重复消息",
      messageType: "text",
      externalMsgId: "dup-1",
    };
    await h.handler(msg);
    await h.handler(msg);
    await h.handler(msg);
    ok(h.calls.length === 1, "相同 message_id 仅处理一次（幂等）");
  }

  // 无 message_id 不去重（不同消息都处理）
  {
    const h = makeHarness();
    await h.handler({ channel: "personal_wechat", externalUserId: "u7", content: "a", messageType: "text" });
    await h.handler({ channel: "personal_wechat", externalUserId: "u7", content: "b", messageType: "text" });
    ok(h.calls.length === 2, "无 message_id 时不误去重");
  }

  console.log(`service-intake-correlation: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
