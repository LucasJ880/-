/** Shared mini-harness for the runtime-architecture test suite (tsx scripts). */
export let pass = 0;
export let fail = 0;

export function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

export function finish(title: string) {
  console.log("");
  console.log(`${title} 结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}
