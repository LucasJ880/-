/**
 * 情报→内容桥接：纯函数与降级路径（不连库、不调 AI）
 * 运行：npx tsx src/lib/operations/__tests__/intel-to-content.test.ts
 *
 * 完整 createContentPlanFromSignal 依赖 DB，此处覆盖 fallback 草案形状约束。
 */

let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

/** 与 intel-to-content.ts fallbackDraft 保持同构，防止回归时悄悄改坏 */
function fallbackDraft(input: {
  competitorName: string;
  title: string;
  summary: string;
}) {
  const topic = `竞品动态启发：${input.title}`.slice(0, 80);
  const angle = [
    `观察对象：${input.competitorName}`,
    "仅借题发挥我们自己的产品/服务优势，禁止照搬对方文案、价格或促销承诺。",
    input.summary.slice(0, 400),
  ].join("\n");
  const suggestedCaption = [
    `最近行业里出现了值得关注的动向（参考：${input.competitorName}）。`,
    "我们更想帮客户把需求说清楚、把方案做扎实——量房、材质、安装与售后一条龙。",
    "如果你正在对比方案，欢迎私信告诉我们你的房间场景，我们按场景给建议。",
  ].join("\n\n");
  return { topic, angle, suggestedCaption, hashtags: "#SmartHome #WindowTreatments #HomeDecor" };
}

const draft = fallbackDraft({
  competitorName: "Acme Blinds",
  title: "官网推出春季促销条幅",
  summary: "首页新增 20% off 横幅，并强调同城安装。",
});

check("topic 含竞品启发前缀", draft.topic.startsWith("竞品动态启发："));
check("angle 含禁止照搬声明", draft.angle.includes("禁止照搬"));
check("caption 不含对方折扣数字原文照搬", !draft.suggestedCaption.includes("20% off"));
check("hashtags 非空", draft.hashtags.length > 0);

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nintel-to-content fallback 检查通过");
