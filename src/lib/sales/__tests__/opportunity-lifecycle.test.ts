/**
 * 商机生命周期状态机单元测试
 *
 * 用法: npx tsx src/lib/sales/__tests__/opportunity-lifecycle.test.ts
 */

import { shouldAdvance, STAGE_ORDER } from '../opportunity-lifecycle';

let pass = 0;
let fail = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.error(`  ❌ ${msg}`);
  }
}

// ── Stage order integrity ──

console.log('\n── 阶段定义完整性 ──');

assert(STAGE_ORDER.length === 9, `阶段数 = 9 (got ${STAGE_ORDER.length})`);
assert(STAGE_ORDER[0] === 'new_lead', '起始阶段 = new_lead');
assert(STAGE_ORDER[STAGE_ORDER.length - 1] === 'completed', '终止阶段 = completed');
assert(STAGE_ORDER.indexOf('quoted') > STAGE_ORDER.indexOf('new_lead'), 'quoted > new_lead');
assert(STAGE_ORDER.indexOf('signed') > STAGE_ORDER.indexOf('negotiation'), 'signed > negotiation');

// ── Forward advance ──

console.log('\n── 正向推进 ──');

assert(shouldAdvance('new_lead', 'quoted'), 'new_lead → quoted 可推进');
assert(shouldAdvance('new_lead', 'measure_booked'), 'new_lead → measure_booked 可推进');
assert(shouldAdvance('quoted', 'negotiation'), 'quoted → negotiation 可推进');
assert(shouldAdvance('negotiation', 'signed'), 'negotiation → signed 可推进');
assert(shouldAdvance('signed', 'producing'), 'signed → producing 可推进');
assert(shouldAdvance('producing', 'installing'), 'producing → installing 可推进');
assert(shouldAdvance('installing', 'completed'), 'installing → completed 可推进');
assert(shouldAdvance('new_lead', 'completed'), 'new_lead → completed 可跳阶推进');

// ── No backward ──

console.log('\n── 禁止回退 ──');

assert(!shouldAdvance('quoted', 'new_lead'), 'quoted → new_lead 不可回退');
assert(!shouldAdvance('negotiation', 'quoted'), 'negotiation → quoted 不可回退');
assert(!shouldAdvance('signed', 'new_lead'), 'signed → new_lead 不可回退');
assert(!shouldAdvance('completed', 'new_lead'), 'completed → new_lead 不可回退');

// ── Same stage ──

console.log('\n── 同阶段不推进 ──');

assert(!shouldAdvance('quoted', 'quoted'), 'quoted → quoted 不推进');
assert(!shouldAdvance('new_lead', 'new_lead'), 'new_lead → new_lead 不推进');

// ── Terminal states ──

console.log('\n── 终态保护 ──');

assert(!shouldAdvance('lost', 'new_lead'), 'lost 状态不可推进到任何阶段');
assert(!shouldAdvance('lost', 'quoted'), 'lost → quoted 不可推进');
assert(!shouldAdvance('lost', 'completed'), 'lost → completed 不可推进');
assert(!shouldAdvance('on_hold', 'new_lead'), 'on_hold → new_lead 不可推进');
assert(!shouldAdvance('on_hold', 'signed'), 'on_hold → signed 不可推进');
assert(!shouldAdvance('completed', 'signed'), 'completed → signed 不可推进');

// ── Unknown stages ──

console.log('\n── 未知阶段 ──');

assert(!shouldAdvance('unknown', 'quoted'), '未知起始阶段返回 false');
assert(!shouldAdvance('new_lead', 'unknown'), '未知目标阶段返回 false');
assert(!shouldAdvance('unknown', 'unknown'), '双未知返回 false');
assert(!shouldAdvance('', ''), '空字符串返回 false');

// ── Every valid transition pair ──

console.log('\n── 全量正向邻接推进 ──');

for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
  const from = STAGE_ORDER[i];
  const to = STAGE_ORDER[i + 1];
  assert(shouldAdvance(from, to), `${from} → ${to} 相邻推进`);
}

// ── Summary ──

console.log('\n═══════════════════════════════════════');
console.log(`  商机状态机测试: ${pass}/${pass + fail} 通过, ${fail} 失败`);
console.log('═══════════════════════════════════════\n');

if (fail > 0) process.exit(1);
