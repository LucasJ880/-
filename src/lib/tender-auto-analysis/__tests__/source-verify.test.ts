/**
 * 原文片段核验
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/source-verify.test.ts
 */

import {
  assertSourceSnippet,
  canMarkConfirmed,
  normalizeForSnippetMatch,
  snippetExistsOnPage,
} from "../source-verify";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis source-verify");

ok(
  normalizeForSnippetMatch("  Hello\n\tWorld  ") === "hello world",
  "normalize 折叠空白并小写",
);
ok(
  normalizeForSnippetMatch("A\u00a0B") === "a b",
  "normalize 处理 nbsp",
);

const page =
  "The Royal Canadian Mounted Police invites bids.\nClosing date: 2026-09-15.";

ok(
  snippetExistsOnPage("Royal Canadian Mounted Police", page),
  "精确片段命中",
);
ok(
  snippetExistsOnPage("royal\n  canadian   mounted", page),
  "空白差异仍命中",
);
ok(
  !snippetExistsOnPage("Department of Defense", page),
  "不存在片段不命中",
);
ok(!snippetExistsOnPage("   ", page), "空 snippet 不命中");

ok(
  canMarkConfirmed({
    snippet: "Closing date: 2026-09-15",
    pageText: page,
    statementKind: "CONFIRMED_FACT",
  }),
  "核验通过可 CONFIRMED",
);
ok(
  !canMarkConfirmed({
    snippet: "made up fact",
    pageText: page,
    statementKind: "CONFIRMED_FACT",
  }),
  "核验失败不可 CONFIRMED",
);
ok(
  !canMarkConfirmed({
    snippet: "Closing date: 2026-09-15",
    pageText: page,
    statementKind: "AI_INFERENCE",
  }),
  "非 CONFIRMED_FACT 不可 mark confirmed",
);
ok(
  !canMarkConfirmed({
    snippet: null,
    pageText: page,
    statementKind: "CONFIRMED_FACT",
  }),
  "缺 snippet 不可 confirmed",
);

const verified = assertSourceSnippet({
  snippet: "Royal Canadian Mounted Police",
  pageText: page,
  statementKind: "CONFIRMED_FACT",
});
ok(verified.verified === true, "assert verified=true");
ok(verified.statementKind === "CONFIRMED_FACT", "assert 保持 CONFIRMED_FACT");
ok(verified.confidence === "CONFIRMED", "assert confidence=CONFIRMED");

const downgraded = assertSourceSnippet({
  snippet: "quantity is exactly 100000 units",
  pageText: page,
  statementKind: "CONFIRMED_FACT",
  confidence: "CONFIRMED",
});
ok(downgraded.verified === false, "未核验 verified=false");
ok(
  downgraded.statementKind === "DOCUMENT_INTERPRETATION",
  "CONFIRMED_FACT 降级为 DOCUMENT_INTERPRETATION",
);
ok(
  downgraded.confidence === "HIGH_CONFIDENCE",
  "CONFIRMED 降级为 HIGH_CONFIDENCE",
);

console.log(`\nsource-verify: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
