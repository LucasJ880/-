/**
 * 上线前检查（只读）：WhatsApp phoneNumberId / 微信公众号原始 ID（originalId / toUserName / ghId / wechatId）
 * 是否配在多个组织的启用通道上。
 *
 * 入站解析遇到这种重复会失败即关闭（WhatsApp 条目跳过且 Meta 不会重投、微信 403，日志
 * trade.inbound.<channel>_channel_ambiguous），保存通道时也会被拒绝（409）。部署前先跑：有重复就先与相关组织核对，
 * 改正或停用其中错误的通道，再部署。
 *
 * 运行：DATABASE_URL=… npx tsx scripts/check-duplicate-channel-ids.ts
 * 只读：只执行一条 SELECT。输出只含通道类型、撞上的字段名、组织 id 与通道 id——不打印标识值、凭证或任何 config 内容。
 * 退出码：0 无重复；1 有重复；2 运行出错。
 */

import { db } from "@/lib/db";
import { listCrossOrgInboundIdDuplicates } from "@/lib/trade/inbound-org";

async function main(): Promise<number> {
  const groups = await listCrossOrgInboundIdDuplicates();
  if (!groups.length) {
    console.log("OK  启用的 WhatsApp / 微信通道里没有跨组织重复的入站标识");
    return 0;
  }
  console.error(`FAIL 发现 ${groups.length} 组跨组织重复的入站标识（入站将失败即关闭，需先处理再部署）：`);
  groups.forEach((g, i) => {
    console.error(`  #${i + 1} ${g.channel} 字段 ${g.keys.join(" / ")}：`);
    for (const c of g.channels) console.error(`      org=${c.orgId} channel=${c.channelId}`);
  });
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("ERROR 检查失败：", err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
