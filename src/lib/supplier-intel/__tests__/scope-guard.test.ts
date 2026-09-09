/**
 * FR2 纯核：异步上下文隔离的判定逻辑（CI 可执行，无 DB、无浏览器）。
 *
 * 这里只锁「归属判定」这一层——真实组件里的表现由浏览器验收覆盖。
 * 之所以要单独锁：串台 bug 在人眼里表现为「点错了供应商」，
 * 而它的根因永远是这几个布尔判断写反了。
 */
import assert from "node:assert/strict";

async function main() {
  const { ScopeGuard } = await import("../../../components/supplier-intel/scope-guard");

  console.log("A1：同作用域内后发者胜——先发的响应不再落地");
  {
    const g = new ScopeGuard();
    g.setScope("orgA::projA");
    const first = g.begin("list");
    const second = g.begin("list");
    assert.equal(first.isCurrent(), false, "被后一次请求取代");
    assert.equal(second.isCurrent(), true);
    assert.equal(first.shouldSettle(), false, "FR2-E：旧请求的 finally 不许清新请求的忙碌态");
    assert.equal(second.shouldSettle(), true);
  }

  console.log("A2：不同槽位互不干扰（列表刷新不该取消身份核对）");
  {
    const g = new ScopeGuard();
    g.setScope("orgA::projA");
    const list = g.begin("list");
    const resolve = g.begin("resolve");
    assert.equal(list.isCurrent(), true);
    assert.equal(resolve.isCurrent(), true);
  }

  console.log("B1：切项目后，旧作用域的在途响应一律丢弃");
  {
    const g = new ScopeGuard();
    g.setScope("orgA::projA");
    const inflight = g.begin("list");
    g.setScope("orgA::projB");
    assert.equal(inflight.isCurrent(), false, "FR2-B：A 的轮询响应不能写进 B");
    assert.equal(inflight.isSameScope(), false);
    assert.equal(inflight.signal.aborted, true, "切走时应中止在途请求，而不只是忽略结果");
    const fresh = g.begin("list");
    assert.equal(fresh.isCurrent(), true);
  }

  console.log("B2：切组织同理（org 变了就是另一个世界）");
  {
    const g = new ScopeGuard();
    g.setScope("orgA::projA");
    const inflight = g.begin("list");
    g.setScope("orgB::projA");
    assert.equal(inflight.isCurrent(), false);
  }

  console.log("C1：切回原作用域不会让旧响应复活");
  {
    const g = new ScopeGuard();
    g.setScope("orgA::projA");
    const inflight = g.begin("list");
    g.setScope("orgA::projB");
    g.setScope("orgA::projA");
    assert.equal(
      inflight.isCurrent(),
      false,
      "A→B→A 之后，最早那次 A 的响应已经中止过，不能再落地",
    );
  }

  console.log("C2：抽屉场景——换线索后旧解析结果不得落到新线索");
  {
    const g = new ScopeGuard();
    g.setScope("signal-A");
    const resolveA = g.begin("resolve");
    g.setScope("signal-B");
    const resolveB = g.begin("resolve");
    assert.equal(resolveA.isCurrent(), false, "FR2-C：A 的候选供应商不能出现在 B 的抽屉里");
    assert.equal(resolveB.isCurrent(), true);
  }

  console.log("C3：关抽屉（scope=null）后，写后刷新的迟到响应不得把抽屉拉回来");
  {
    const g = new ScopeGuard();
    g.setScope("signal-A");
    const save = g.begin("write");
    g.setScope(null);
    assert.equal(save.isSameScope(), false, "FR2-D：抽屉已关，别再 setSelected");
  }

  console.log("D1：abortAll 中止全部在途，且 done() 幂等");
  {
    const g = new ScopeGuard();
    g.setScope("s");
    const a = g.begin("x");
    const b = g.begin("y");
    g.abortAll();
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, true);
    a.done();
    a.done();
  }

  console.log("D2：setScope 传入相同值不产生副作用（重渲染不该打断在途请求）");
  {
    const g = new ScopeGuard();
    g.setScope("same");
    const t = g.begin("list");
    assert.equal(g.setScope("same"), false);
    assert.equal(t.isCurrent(), true, "StrictMode / 普通重渲染都不能误伤在途请求");
  }

  console.log("\nFR2 作用域隔离纯核全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
