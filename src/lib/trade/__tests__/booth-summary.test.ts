/**
 * 展会小结：展会日窗口 / 「展会」一行读回 / 正文格式 纯函数测试
 * 运行：npx tsx src/lib/trade/__tests__/booth-summary.test.ts
 */

import assert from "node:assert/strict";
import { buildBoothCardContext, parseBoothCardContext, type BoothCard } from "../booth-cards";
import { boothDayOf, boothDayWindow, formatBoothSummary, type BoothSummaryCard } from "../booth-summary";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const SH = "Asia/Shanghai";

function card(over: Partial<BoothSummaryCard> = {}): BoothSummaryCard {
  return {
    cardNo: "CF140-0001", company: "Maple Home Goods", contact: "Emma Brown", country: "Canada", grade: "A", sales: "Cathy",
    nextStep: "报价, 寄样", noteOriginal: "要自有品牌礼盒包装，圣诞季", hasEmail: true, draftStatus: "pending", unknownStyles: [], ...over,
  };
}

console.log("booth-summary");

ok("展会日：当地 07:00 到次日 07:00；夜里录到凌晨算前一天", () => {
  assert.equal(boothDayOf(new Date("2026-10-31T15:00:00Z"), SH), "2026-10-31"); // 当地 23:00
  assert.equal(boothDayOf(new Date("2026-10-31T22:59:00Z"), SH), "2026-10-31"); // 当地 11/1 06:59
  assert.equal(boothDayOf(new Date("2026-10-31T23:00:00Z"), SH), "2026-11-01"); // 当地 11/1 07:00
  const w = boothDayWindow("2026-10-31", SH);
  assert.equal(w.from.toISOString(), "2026-10-30T23:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(boothDayWindow("2026-10-31", "America/Toronto").from.toISOString(), "2026-10-31T11:00:00.000Z");
});

ok("「展会」一行读回：业务员、等级、下一步、备注原文；展会名和日期不误读", () => {
  const c = {
    row: 2, cardNo: "CF140-0001", date: "10/31", sales: "Cathy", company: "Maple", contactName: "Emma", title: "Buyer", email: "e@m.example",
    whatsapp: "", country: "Canada", buyerType: "零售/自有品牌", styles: "MX-BL-001", specs: "OEKO-TEX", volume: "1-5柜", timing: "3个月内",
    nextStep: "报价, 寄样", grade: "A", note: "", noteOriginal: "要礼盒包装 · 圣诞季", voiceNote: "",
  } satisfies BoothCard;
  const parsed = parseBoothCardContext(buildBoothCardContext(c, "the 140th Canton Fair (Booth 14.3E07)"));
  assert.equal(parsed.cardNo, "CF140-0001");
  assert.equal(parsed.sales, "Cathy");
  assert.equal(parsed.grade, "A");
  assert.equal(parsed.nextStep, "报价, 寄样");
  assert.equal(parsed.buyerType, "零售/自有品牌");
  assert.equal(parsed.noteOriginal, "要礼盒包装 · 圣诞季");
  assert.deepEqual(parseBoothCardContext("展会 · 卡号 CF140-0002"), { cardNo: "CF140-0002" });
});

ok("小结正文：等级分布、待审批、只有 WhatsApp、草稿未完成、A 级名单、未知款号", () => {
  const { title, text } = formatBoothSummary({
    day: "2026-10-31",
    event: "the 140th Canton Fair (Booth 14.3E07)",
    cards: [
      card(),
      card({ cardNo: "CF140-0002", company: "Gulf Trading", contact: "Omar", country: "UAE", sales: "Leo", nextStep: "报价", noteOriginal: "", hasEmail: false, draftStatus: null }),
      card({ cardNo: "CF140-0003", grade: "C", contact: "Liam Chen", draftStatus: null, unknownStyles: ["MX-ZZ-999"] }),
      card({ cardNo: "CF140-0004", grade: "B", draftStatus: "executed", unknownStyles: ["MX-ZZ-999"] }),
    ],
  });
  assert.equal(title, "展会小结 10/31：录入 4 张，A 级 2 张");
  const lines = text.split("\n");
  assert.equal(lines[0], "【展会小结】the 140th Canton Fair (Booth 14.3E07) · 10/31");
  assert.equal(lines[1], "录入 4 张：A 2 · B 1 · C 1");
  assert.equal(lines[2], "跟进邮件：待审批 1 封，已发出 1 封（青砚 → 审批中心）");
  assert.equal(lines[3], "只有 WhatsApp 1 张，请用 WhatsApp 跟进：CF140-0002 Gulf Trading");
  assert.equal(lines[4], "草稿未完成 1 张（重新上传当天的表格即可补齐）：CF140-0003");
  assert.ok(lines.includes("A 级 2 张，今天排报价 / 寄样："));
  assert.ok(lines.includes("1. Maple Home Goods（Canada） Emma Brown · 下一步：报价, 寄样 · 业务员 Cathy · CF140-0001"));
  assert.ok(lines.includes("   备注：要自有品牌礼盒包装，圣诞季"));
  assert.ok(lines.includes("2. Gulf Trading（UAE） Omar · 下一步：报价 · 业务员 Leo · CF140-0002"));
  assert.equal(lines.at(-1), "不在参考表的款号（请补进款号参考表）：MX-ZZ-999（2）");
});

ok("A 级超过 20 张：列前 20 张，其余提示去青砚看", () => {
  const cards = Array.from({ length: 23 }, (_, i) => card({ cardNo: `CF140-${String(i + 1).padStart(4, "0")}`, noteOriginal: "" }));
  const { text } = formatBoothSummary({ day: "2026-11-01", event: null, cards });
  assert.match(text, /^【展会小结】11\/1\n/);
  assert.match(text, /\n20\. Maple/);
  assert.doesNotMatch(text, /\n21\. /);
  assert.match(text, /…另 3 张见青砚「重点线索」/);
});

ok("当天没有卡：标题照常，正文说明没有录入", () => {
  const r = formatBoothSummary({ day: "2026-11-02", event: null, cards: [] });
  assert.equal(r.title, "展会小结 11/2：录入 0 张，A 级 0 张");
  assert.match(r.text, /当天没有录入速记卡/);
});

console.log(`\n${pass} passed`);
